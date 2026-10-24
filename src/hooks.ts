import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { basename } from 'node:path';
import type { HookDefinition, HookEvent, PlatformConfig } from './types.js';
import { audit } from './audit.js';
import { modelCredentialNames, sanitizedEnvironment } from './environment.js';
import { networkRequest } from './network.js';
import { callModel } from './model.js';
import { assertExecutionActive, controlProcess } from './executionControl.js';
import { HOOK_EVENTS } from './hookContracts.js';
import { runHookOnce } from './hookOnce.js';
import {isolatedCommand} from './osSandbox.js';

export interface HookExecutionResult {
  additionalContext: string[];
  updatedInput?: Record<string, unknown>;
  displayContent?: string;
}

// Recursion belongs to a call chain, not the entire process. A process-global
// set silently skipped quality gates when two teammates finished together.
const activeHooks = new AsyncLocalStorage<ReadonlySet<string>>();

export class HookDecisionError extends Error {
  constructor(public readonly event: HookEvent, message: string, public readonly retry: boolean) {
    super(message); this.name = 'HookDecisionError';
  }
}

/** Informational Stop feedback still asks for another bounded turn. */
export class HookFeedbackError extends HookDecisionError {
  constructor(event: HookEvent, message: string) { super(event, message, true); this.name = 'HookFeedbackError'; }
}

function redactPayload(value: unknown, key = ''): unknown {
  if (/(?:content|secret|token|password|credential|auth|cookie|key)/i.test(key)) return '[redacted]';
  if (typeof value === 'string') return value.slice(0, 4_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactPayload(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redactPayload(item, name)]));
  return value;
}

function hookIdentity(event: HookEvent, hook: HookDefinition): string {
  const target = hook.type === 'http' ? hook.url : hook.type === 'prompt' || hook.type === 'agent' ? hook.prompt : hook.command;
  return `${event}:${hook.type ?? 'command'}:${target}`;
}

function wildcard(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function matches(hook: HookDefinition, payload: Record<string, unknown>): boolean {
  const candidate = String((hook.event === 'StopFailure' ? payload.error : hook.event === 'FileChanged' || hook.event === 'DirectoryAdded' ? payload.path : hook.event === 'InstructionsLoaded' ? payload.source : undefined) ?? payload.tool ?? payload.tool_name ?? payload.action ?? payload.agentId ?? '');
  if (hook.event!=='MessageDisplay'&&hook.event!=='CwdChanged'&&hook.matcher && !(hook.event==='FileChanged'
    ? hook.matcher.split('|').some(pattern=>wildcard(pattern,candidate)||wildcard(pattern,basename(candidate))||typeof payload.relative_path==='string'&&wildcard(pattern,payload.relative_path))
    : wildcard(hook.matcher, candidate))) return false;
  if (!hook.if) return true;
  const condition = hook.if.match(/^([A-Za-z0-9_.:-]+)\((.*)\)$/);
  if (!condition) return wildcard(hook.if, candidate);
  const [, tool, argumentPattern] = condition;
  if (!tool || !wildcard(tool, String(payload.tool ?? ''))) return false;
  return wildcard(argumentPattern ?? '*', JSON.stringify(payload.input ?? payload));
}

function timeoutMs(hook: HookDefinition): number {
  return hook.timeoutMs ?? (hook.timeout ? hook.timeout * 1_000 : hook.event==='MessageDisplay'?10000:30_000);
}

interface HookResponse {
  displayContent?:string;
  continue?: boolean;
  decision?: 'approve' | 'block';
  reason?: string;
  stopReason?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
}

function parseHookResponse(text: string): HookResponse {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const output = value.hookSpecificOutput && typeof value.hookSpecificOutput === 'object' ? value.hookSpecificOutput as Record<string, unknown> : {};
    return {
      ...(typeof (output.displayContent ?? value.displayContent)==='string'?{displayContent:String(output.displayContent ?? value.displayContent).slice(0,100000)}:{}),
      ...(typeof value.continue === 'boolean' ? { continue: value.continue } : {}),
      ...(value.ok === false ? { decision: 'block' as const } : value.decision === 'approve' || value.decision === 'block' ? { decision: value.decision } : {}),
      ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
      ...(typeof value.stopReason === 'string' ? { stopReason: value.stopReason } : {}),
      ...(typeof (output.additionalContext ?? value.additionalContext) === 'string' ? { additionalContext: (output.additionalContext ?? value.additionalContext) as string } : {}),
      ...((output.updatedInput ?? value.updatedInput) && typeof (output.updatedInput ?? value.updatedInput) === 'object' ? { updatedInput: (output.updatedInput ?? value.updatedInput) as Record<string, unknown> } : {}),
      ...(output.permissionDecision === 'deny' ? { decision: 'block' as const, reason: typeof output.permissionDecisionReason === 'string' ? output.permissionDecisionReason : 'Hook denied the tool' } : {}),
    };
  } catch { return { additionalContext: text.trim().slice(0, 20_000) }; }
}

function enforceResponse(response: HookResponse, event: HookEvent): void {
  if (response.continue === false) throw new HookDecisionError(event, response.stopReason ?? response.reason ?? 'Hook stopped continuation', false);
  if (response.decision === 'block') throw new HookDecisionError(event, response.reason ?? 'Hook blocked continuation', true);
}

function commandParts(command: string): string[] {
  if (/[;&|`<>\r\n]/.test(command)) throw new Error(`Unsafe shell operator in hook command: ${command}`);
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^(['"])(.*)\1$/, '$2')) ?? [];
}

async function executeCommandHook(hook: Extract<HookDefinition, { type?: 'command' }>, payload: Record<string, unknown>, cwd: string, config: PlatformConfig): Promise<string> {
  const parts = commandParts(hook.command);
  const command = parts.shift();
  if (!command) throw new Error(`Empty hook command for ${hook.event}`);
  const normalized = basename(command).toLowerCase().replace(/\.exe$/, '');
  if (config.policy.deniedCommands.some((item) => item.toLowerCase() === normalized)) throw new Error(`Hook command is denied: ${command}`);
  if (config.policy.mode !== 'bypass' && !config.policy.allowedCommands.some((item) => item.toLowerCase() === normalized)) throw new Error(`Hook command is not allowlisted: ${command}`);
  if(hook.async&&config.policy.osSandbox)throw new Error('OS sandbox does not permit detached asynchronous Hooks');
  const isolated=await isolatedCommand(command,parts,cwd,config);
  const executable = isolated.command;
  const args = isolated.args;
  const environment = sanitizedEnvironment(config.policy.mode, { CCPT_HOOK_EVENT: hook.event, CCPT_HOOK_PAYLOAD: JSON.stringify(redactPayload(payload)) }, config.policy.allowedEnvironmentVariables, modelCredentialNames(config));
  assertExecutionActive();
  if (hook.async) {
    const child = spawn(executable, args, { cwd, env: environment, shell: false, detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    child.stdin.on('error', () => {});
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.stdin.end(JSON.stringify(payload));
    child.unref();
    return '';
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: environment, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdin.on('error', () => { /* The owned command may exit before consuming its input. */ });
    child.stdin.end(JSON.stringify(payload));
    let stdout = '';
    let stderr = '';
    const control = controlProcess(child, timeoutMs(hook));
    child.stdout.on('data', (chunk) => { if (stdout.length < 2_000_000) stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 2_000_000) stderr += String(chunk); });
    child.on('error', (error) => { control.dispose(); reject(error); });
    child.on('close', (code) => {
      control.dispose();
      if (control.error()) { reject(control.error()); return; }
      if (code === 0) resolve(stdout);
      else if (code === 2) reject(new HookDecisionError(hook.event, (stderr.trim() || stdout.trim() || `Hook ${hook.event} blocked completion`).slice(0, 20_000), true));
      else reject(new Error(`Hook ${hook.event} failed (${code ?? 'signal'}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = -1, b = -1] = address.split('.').map(Number);
    if (a === 127) return false;
    return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
  }
  const lower = address.toLowerCase();
  if (lower === '::1') return false;
  return lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower);
}

async function guardHttpTarget(url: URL): Promise<void> {
  if (isIP(url.hostname)) {
    if (isBlockedAddress(url.hostname)) throw new Error(`HTTP hook blocked private or link-local target: ${url.hostname}`);
    return;
  }
  if (url.hostname === 'localhost') return;
  for (const address of await lookup(url.hostname, { all: true })) if (isBlockedAddress(address.address)) throw new Error(`HTTP hook blocked: ${url.hostname} resolves to ${address.address}`);
}

function interpolateHeaders(headers: Record<string, string> | undefined, allowed: string[] | undefined): Record<string, string> {
  const allow = new Set(allowed ?? []);
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name, value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (_match, braced: string | undefined, plain: string | undefined) => {
    const variable = braced ?? plain ?? '';
    return allow.has(variable) ? process.env[variable] ?? '' : '';
  })]));
}

async function executeHttpHook(hook: Extract<HookDefinition, { type: 'http' }>, payload: Record<string, unknown>, config: PlatformConfig): Promise<string> {
  const target = new URL(hook.url);
  if (!config.policy.allowNetwork && !['localhost', '127.0.0.1', '::1'].includes(target.hostname)) throw new Error('HTTP hooks are blocked because network access is disabled');
  await guardHttpTarget(target);
  const network = { ...config.network, timeoutMs: timeoutMs(hook) };
  const response = await networkRequest(target.href, { method: 'POST', headers: { 'content-type': 'application/json', ...interpolateHeaders(hook.headers, hook.allowedEnvVars) }, body: JSON.stringify(payload) }, network);
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP hook failed with status ${response.status}: ${response.text.slice(0, 2_000)}`);
  return response.text;
}

function modelText(content: Awaited<ReturnType<typeof callModel>>['content']): string {
  return content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n').trim();
}

async function executePromptHook(hook: Extract<HookDefinition, { type: 'prompt' }>, payload: Record<string, unknown>, config: PlatformConfig): Promise<string> {
  const modelConfig = structuredClone(config);
  if (hook.model) modelConfig.model.name = hook.model;
  modelConfig.network.timeoutMs = timeoutMs(hook);
  const prompt = hook.prompt.replaceAll('$ARGUMENTS', JSON.stringify(payload));
  return modelText((await callModel(modelConfig, 'Evaluate this lifecycle hook. Return JSON with continue, decision, reason, and optional additionalContext.', [{ role: 'user', content: prompt }], [])).content);
}

async function executeAgentHook(hook: Extract<HookDefinition, { type: 'agent' }>, payload: Record<string, unknown>, cwd: string, config: PlatformConfig): Promise<string> {
  const verifierConfig = structuredClone(config);
  verifierConfig.hooks = [];
  verifierConfig.agents.maxTurns = Math.min(verifierConfig.agents.maxTurns, 8);
  if (hook.model) verifierConfig.model.name = hook.model;
  const { spawnAgent } = await import('./agent.js');
  const goal = `${hook.prompt.replaceAll('$ARGUMENTS', JSON.stringify(payload))}\n\nReturn a final JSON object: {"continue":true|false,"decision":"approve"|"block","reason":"..."}.`;
  const agent = await spawnAgent({ goal, cwd, config: verifierConfig, role: 'hook-verifier', isolation: 'none', background: false });
  if (agent.status !== 'completed') throw new Error(agent.error ?? agent.result ?? `Agent hook ended with ${agent.status}`);
  return agent.result ?? '';
}

export async function runHooks(config: PlatformConfig, event: HookEvent, payload: Record<string, unknown>, cwd = process.cwd()): Promise<HookExecutionResult> {
  if (!(HOOK_EVENTS as readonly string[]).includes(event)) throw new Error('Unsupported lifecycle Hook event');
  payload = { ...payload, hook_event_name: event, cwd,
    ...(event==='FileChanged'?{file_path:payload.file_path??payload.path,event:payload.event??({created:'add',modified:'change',deleted:'unlink'} as Record<string,string>)[String(payload.change)]}:{}),
    ...(event==='DirectoryAdded'?{directory:payload.directory??payload.path}:{}),
    ...(payload.tool !== undefined ? { tool_name: payload.tool } : payload.tool_name !== undefined ? { tool: payload.tool_name } : {}),
    ...(payload.input !== undefined ? { tool_input: payload.input } : payload.tool_input !== undefined ? { input: payload.tool_input } : {}),
    ...(payload.result !== undefined ? { tool_response: payload.result } : {}),
    ...(payload.sessionId ? { session_id: payload.sessionId } : {}), ...(payload.agentId ? { agent_id: payload.agentId } : {}) };
  const hooks = config.hooks.filter((hook) => hook.event === event && matches(hook, payload));
  if (hooks.length && Buffer.byteLength(JSON.stringify(payload)) > 1_000_000) throw new Error(`Hook ${event} payload exceeds 1 MB`);
  const result: HookExecutionResult = { additionalContext: [] };
  for (const hook of hooks) {
    if (config.policy.mode === 'restricted') throw new Error(`Hooks are disabled in restricted mode (${event})`);
    if (config.policy.mode === 'sandbox' && !config.policy.processWrapper && (hook.type ?? 'command') === 'command') throw new Error(`Sandbox mode requires a processWrapper for command Hooks (${event})`);
    const identity = hookIdentity(event, hook);
    const ancestors = activeHooks.getStore() ?? new Set<string>();
    if (ancestors.has(identity)) continue;
    try {
      const execute = async () => {
      if (hook.once && 'async' in hook && hook.async) throw new Error('Once hooks must be synchronous so completion can be recorded');
      if ('async' in hook && hook.async && ['Stop', 'TaskCompleted', 'TeammateIdle', 'SubagentStop'].includes(event)) throw new Error(`Async ${event} Hook cannot enforce completion; use a synchronous hook`);
      const output = await activeHooks.run(new Set([...ancestors, identity]), () => hook.type === 'http' ? executeHttpHook(hook, payload, config)
        : hook.type === 'prompt' ? executePromptHook(hook, payload, config)
          : hook.type === 'agent' ? executeAgentHook(hook, payload, cwd, config)
            : executeCommandHook(hook, payload, cwd, config));
      if (hook.type === 'prompt' || hook.type === 'agent') {
        let verdict: Record<string, unknown>;
        try { verdict = JSON.parse(output) as Record<string, unknown>; } catch { throw new Error(`Hook ${event} verifier did not return a JSON verdict`); }
        if (!verdict || typeof verdict !== 'object' || !(typeof verdict.ok === 'boolean' || typeof verdict.continue === 'boolean' || ['approve', 'block'].includes(String(verdict.decision)))) throw new Error(`Hook ${event} verifier returned no explicit verdict`);
      }
      const response = parseHookResponse(output);
      // Failure hooks observe an API failure. Their output cannot retry, approve
      // a tool or replace the original error. Continue to later observers too.
      if(event==='MessageDisplay') {if(response.displayContent!==undefined)result.displayContent=response.displayContent;}
      else if (event !== 'StopFailure') {
        enforceResponse(response, event);
        if (response.additionalContext) result.additionalContext.push(response.additionalContext);
        if (response.updatedInput) result.updatedInput = { ...(result.updatedInput ?? {}), ...response.updatedInput };
      }
      await audit({ event: `hook.${event}`, outcome: 'success', details: { type: hook.type ?? 'command', target: identity.split(':').slice(2).join(':').slice(0, 500) } });
      };
      if (hook.once) await runHookOnce(cwd, { event, hook, session: payload.session_id ?? '', agent: payload.agent_id ?? '' }, execute);
      else await execute();
    } catch (error) {
      await audit({ event: `hook.${event}`, outcome: 'failure', details: { type: hook.type ?? 'command', error: error instanceof Error ? error.message : String(error) } });
      if (event === 'StopFailure') continue;
      if (hook.source) {
        const detail = `[${hook.source}] ${error instanceof Error ? error.message : String(error)}`;
        throw error instanceof HookDecisionError ? new HookDecisionError(event, detail, error.retry) : new Error(detail);
      }
      throw error;
    }
  }
  return result;
}
