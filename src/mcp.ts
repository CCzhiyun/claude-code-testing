import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import packageMetadata from '../package.json' with { type: 'json' };
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServerConfig, PlatformConfig } from './types.js';
import { homeStateDir, projectStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import { readMcpCredential, storeMcpCredential, removeMcpCredential, type StoredMcpToken } from './mcpCredentials.js';
import { abortableDelay } from './modelRetry.js';
import { modelCredentialNames, sanitizedEnvironment } from './environment.js';
import { authorizeCommand, protectPath } from './policy.js';
import { runHooks } from './hooks.js';
import { networkJson, networkRequest } from './network.js';
import { SseDecoder } from './cli/transports/SSETransport.js';
import { assertExecutionActive, executionSignal, terminateOwnedProcess, withExecutionSignal } from './executionControl.js';
import { handleMcpInteraction,McpInteractionSession, mcpInteractionCapabilities, mcpInteractionProtocol,negotiatedMcpHandlers,type McpInteractionHandlers } from './mcpInteraction.js';
import {McpProtocolError} from './mcpErrors.js';
import { requestStreamableMcp } from './mcpHttpRequest.js';
import { auditMcpReply, withMcpAuditScope } from './mcpInteractionAudit.js';
import { isolatedCommand } from './osSandbox.js';
import {createHash} from 'node:crypto';
import {validateToolSchemas} from './toolSchema.js';
import {redactModelDiagnostic} from './modelErrors.js';
import {isWorkspaceTrusted} from './workspaceTrust.js';

export async function saveMcpServer(cwd: string, name: string, server: McpServerConfig): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid MCP server name');
  const path = join(projectStateDir(cwd), 'settings.json');
  const settings = await readJson<Record<string, unknown>>(path, {});
  const mcpServers = (settings.mcpServers ?? {}) as Record<string, McpServerConfig>;
  mcpServers[name] = server;
  await writeJson(path, { ...settings, mcpServers });
}

function isLocalUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function authorizeMcpNetwork(url: string, config: PlatformConfig): void {
  if ((config.policy.mode === 'restricted' || !config.policy.allowNetwork) && !isLocalUrl(url)) {
    throw new Error('External network access is disabled by policy');
  }
}

export async function loginMcp(name: string, token: string, config?: PlatformConfig): Promise<void> {
  if (!token.trim() || Buffer.byteLength(token) > 256000) throw new Error('MCP token must be non-empty and within 256 KB');
  await storeMcpCredential(name, { accessToken: token }, config);
}

export async function logoutMcp(name: string, config?: PlatformConfig): Promise<void> {
  await removeMcpCredential(name, config);
}

export async function getMcpToken(name: string, server?: McpServerConfig, config?: PlatformConfig): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid MCP server name');
  return withFileLock(join(homeStateDir(), `mcp-refresh-${name}.lock`), async () => {
  const stored = await readMcpCredential(name, config);
  if (typeof stored === 'string') return stored;
  if (!stored) return undefined;
  if (stored.binding) {
    const { mcpResource, oauthUrl } = await import('./mcpOAuth.js');
    if (!server || mcpResource(server) !== stored.binding.resource || !server.oauth || server.oauth.clientId && server.oauth.clientId !== stored.binding.clientId || server.oauth.tokenUrl && server.oauth.tokenUrl !== stored.binding.tokenUrl || stored.binding.issuer && (!server.oauth.issuer || oauthUrl(server.oauth.issuer).href !== stored.binding.issuer)) throw new Error('MCP OAuth deployment changed; authorize this server again before sending credentials');
  }
  if (stored.expiresAt && stored.expiresAt <= Date.now() + 30_000 && stored.refreshToken && server?.oauth) {
    const clientId = stored.binding?.clientId ?? server.oauth.clientId, tokenUrl = stored.binding?.tokenUrl ?? server.oauth.tokenUrl;
    if (!clientId || !tokenUrl) throw new Error('MCP refresh requires the original client ID and token endpoint');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refreshToken, client_id: clientId, ...(stored.binding ? { resource: stored.binding.resource } : {}) });
    if (!config) throw new Error('Platform network configuration is required to refresh an MCP token');
    authorizeMcpNetwork(tokenUrl, config);
    const { oauthRequestObject } = await import('./mcpOAuth.js');
    const value = await oauthRequestObject(tokenUrl, config, 'POST', body.toString());
    if (typeof value.access_token !== 'string' || !value.access_token || /\s/.test(value.access_token) || value.access_token.length > 256000 || value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 256000 || /[\u0000-\u001f\u007f]/.test(value.refresh_token)) || value.expires_in !== undefined && (typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.expires_in > 31536000) || value.token_type !== undefined && typeof value.token_type !== 'string' || stored.binding && (value.token_type as string | undefined)?.toLowerCase() !== 'bearer') throw new Error('MCP token refresh returned invalid credentials');
    const next: StoredMcpToken = { accessToken: value.access_token, refreshToken: value.refresh_token ?? stored.refreshToken, ...(stored.binding ? { binding: stored.binding } : {}), ...(value.expires_in ? { expiresAt: Date.now() + value.expires_in * 1_000 } : {}), ...(value.token_type ? { tokenType: value.token_type } : {}) };
    await storeMcpCredential(name, next, config);
    return next.accessToken;
  }
  if (stored.expiresAt && stored.expiresAt <= Date.now() && !stored.refreshToken) throw new Error('MCP credential expired; authorize this server again');
  return stored.accessToken;
  });
}

export async function loginMcpDeviceFlow(name: string, server: McpServerConfig, config: PlatformConfig, onCode: (details: { verificationUri: string; userCode: string }) => void): Promise<void> {
  const oauth = server.oauth;
  if (!oauth?.deviceAuthorizationUrl || !oauth.clientId || !oauth.tokenUrl) throw new Error(`MCP server ${name} requires deviceAuthorizationUrl, clientId and tokenUrl for device flow`);
  authorizeMcpNetwork(oauth.deviceAuthorizationUrl, config);
  authorizeMcpNetwork(oauth.tokenUrl, config);
  const deviceResponse = await networkJson<{ device_code?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; expires_in?: number; interval?: number; error_description?: string }>(oauth.deviceAuthorizationUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: oauth.clientId, ...(oauth.scopes?.length ? { scope: oauth.scopes.join(' ') } : {}) }).toString() }, config.network);
  const device = deviceResponse.value;
  if (deviceResponse.status < 200 || deviceResponse.status >= 300 || !device.device_code || !device.user_code || !(device.verification_uri_complete ?? device.verification_uri)) throw new Error(device.error_description ?? 'MCP device authorization failed');
  const expiry = device.expires_in ?? 600, polling = device.interval ?? 5;
  if (!Number.isFinite(expiry) || expiry <= 0 || !Number.isFinite(polling) || polling <= 0) throw new Error('Invalid MCP device authorization timing');
  onCode({ verificationUri: device.verification_uri_complete ?? device.verification_uri ?? '', userCode: device.user_code });
  const deadline = Date.now() + Math.min(expiry, 3600) * 1_000;
  let interval = Math.min(300, Math.max(1, polling));
  while (Date.now() < deadline) {
    await abortableDelay(Math.min(interval * 1_000, Math.max(0, deadline - Date.now())), executionSignal());
    assertExecutionActive();
    if (Date.now() >= deadline) break;
    const tokenResponse = await networkJson<{ access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; error?: string; error_description?: string }>(oauth.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code, client_id: oauth.clientId }).toString() }, config.network);
    const token = tokenResponse.value;
    if (tokenResponse.status >= 200 && tokenResponse.status < 300 && typeof token.access_token === 'string' && token.access_token) {
      await storeMcpCredential(name, { accessToken: token.access_token, ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}), ...(token.expires_in ? { expiresAt: Date.now() + token.expires_in * 1_000 } : {}), ...(token.token_type ? { tokenType: token.token_type } : {}) }, config);
      return;
    }
    if (token.error === 'slow_down') { interval = Math.min(300, interval + 5); continue; }
    if (token.error !== 'authorization_pending') throw new Error(token.error_description ?? token.error ?? `MCP OAuth failed (${tokenResponse.status})`);
  }
  throw new Error('MCP device authorization timed out');
}

export class StdioMcpClient extends EventEmitter {
  #disposeCancellation: (() => void) | undefined;
  #closed: Promise<void> = Promise.resolve();
  #process: ChildProcessWithoutNullStreams | undefined;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; controller: AbortController }>();
  #interactionHandlers: McpInteractionHandlers | undefined;
  #interactionStop = new AbortController();
  #interactionQueue: Promise<void> = Promise.resolve();
  #reverseIds = new Set<string>();
  #reverseCount = 0;
  #ready = false;
  #interactionSession=new McpInteractionSession();

  async connect(server: McpServerConfig, token?: string, config?: PlatformConfig, interactions?: McpInteractionHandlers): Promise<void> {
    assertExecutionActive();
    if (this.#process || this.#interactionStop.signal.aborted) throw new Error('Use a new MCP client after close or cancellation');
    const capabilities = config?.policy.mode === 'restricted' ? {} : mcpInteractionCapabilities(interactions);
    this.#interactionHandlers = config?.policy.mode === 'restricted' ? undefined : interactions;
    if (server.transport !== 'stdio' || !server.command) throw new Error('A stdio MCP command is required');
    if (config) authorizeCommand(server.command, server.args ?? [], config);
    if (config && server.cwd) protectPath(server.cwd, config);
    const env = sanitizedEnvironment(config?.policy.mode ?? 'normal', {}, config?.policy.allowedEnvironmentVariables ?? [], modelCredentialNames(config));
    if (token && server.tokenEnv) env[server.tokenEnv] = token;
    const cwd=server.cwd??config?.policy.workspaceRoots[0];
    const invocation=config?await isolatedCommand(server.command,server.args??[],cwd??process.cwd(),config):{command:server.command,args:server.args??[]};
    this.#process = spawn(invocation.command,invocation.args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe', env, ...(cwd?{cwd}:{}) });
    this.#closed = new Promise((resolve) => this.#process!.once('close', () => resolve()));
    const signal = executionSignal();
    const cancel = (): void => { this.#interactionStop.abort(); this.#rejectPending(new Error('MCP execution cancelled')); if (this.#process) terminateOwnedProcess(this.#process); };
    signal?.addEventListener('abort', cancel, { once: true });
    this.#disposeCancellation = () => signal?.removeEventListener('abort', cancel);
    const decoder = new TextDecoder('utf-8', { fatal: true }); let buffered = '', received = 0;
    this.#process.stdout.on('data', (chunk: Buffer) => {
      try {
        received += chunk.length; if (received > 8_000_000) throw new Error('MCP stdio session exceeds 8 MB');
        buffered += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (Buffer.byteLength(line) > 1_000_000) throw new Error('MCP stdio frame exceeds 1 MB');
          if (line.trim()) this.#receive(line);
        }
        if (Buffer.byteLength(buffered) > 1_000_000) throw new Error('MCP stdio frame exceeds 1 MB');
      } catch { this.#interactionStop.abort(); this.#rejectPending(new Error('Invalid or oversized MCP stdio stream')); if (this.#process) terminateOwnedProcess(this.#process); }
    });
    this.#process.stderr.on('data', () => { /* Drain server diagnostics to avoid pipe backpressure. */ });
    this.#process.on('error', (error) => this.#rejectPending(error));
    this.#process.stdin.on('error', (error) => this.#rejectPending(error));
    this.#process.on('exit', () => {
      this.#interactionStop.abort();
      this.#disposeCancellation?.();
      for (const pending of this.#pending.values()) { pending.controller.abort(); clearTimeout(pending.timer); pending.reject(new Error('MCP server exited')); }
      this.#pending.clear();
      this.emit('closed');
    });
    const initialized = await this.request('initialize', {
      protocolVersion: mcpInteractionProtocol(this.#interactionHandlers),
      capabilities,
      clientInfo: { name: 'ccpt', version: packageMetadata.version },
    }, Math.min(config?.network.timeoutMs ?? 30_000, 30_000)) as { protocolVersion?: string };
    if (!['2025-11-25','2025-06-18', '2025-03-26', '2024-11-05'].includes(initialized?.protocolVersion ?? '')) throw new Error('MCP server selected an unsupported protocol version');
    this.#interactionHandlers = negotiatedMcpHandlers(this.#interactionHandlers,initialized.protocolVersion!);
    this.#ready = true;
    this.notify('notifications/initialized', {});
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (!this.#process) throw new Error('MCP client is not connected');
    this.#interactionStop.signal.throwIfAborted();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => { this.#pending.delete(id); controller.abort(); this.#interactionStop.abort(); reject(new Error(`MCP request timed out: ${method}`)); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, controller });
      this.#process!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) this.#rejectPending(error);
      });
    });
  }

  notify(method: string, params: unknown): void {
    this.#process?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) { pending.controller.abort(); clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
  }

  async close(): Promise<void> {
    this.#interactionStop.abort(); this.#ready = false;
    this.#disposeCancellation?.(); this.#rejectPending(new Error('MCP client closed'));
    if (this.#process) terminateOwnedProcess(this.#process);
    this.#process = undefined;
    // Wait for the owned process and its pipes, not just taskkill dispatch. On Windows
    // its working directory cannot be removed safely until shutdown has finished.
    let timer: NodeJS.Timeout | undefined;
    try { await Promise.race([this.#closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCP process shutdown timed out')), 10_000); })]); }
    finally { clearTimeout(timer); }
  }

  #receive(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { this.#rejectPending(new Error('Invalid MCP JSON frame')); return; }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') { this.#rejectPending(new Error('Invalid MCP JSON-RPC envelope')); return; }
    // Request IDs belong to two distinct directions. A server request must NEVER
    // settle a client pending request, even when their numeric IDs collide.
    if (typeof message.method === 'string') {
      if (!('id' in message)) { if (!('result' in message) && !('error' in message)) {try{if(this.#interactionSession.notification(message.method,message.params,this.#interactionHandlers))this.emit('notification', { method: message.method, params: message.params });}catch{this.#rejectPending(new Error('MCP notification processing failed'));}} return; }
      if (!(typeof message.id === 'string' && message.id.length <= 512 || typeof message.id === 'number' && Number.isSafeInteger(message.id))) return;
      const id = message.id as string | number;
      const reply = (outcome: unknown) => { if (this.#process && !this.#interactionStop.signal.aborted) this.#process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...(outcome as object) })}\n`, error => { if (!error) void auditMcpReply(outcome as object, 'reply-written').catch(() => { this.#interactionStop.abort(); this.#rejectPending(new Error('MCP reply audit failed')); }); }); };
      if ('result' in message || 'error' in message) { reply({ error: { code: -32600, message: 'Invalid server request envelope' } }); return; }
      if (message.method === 'ping') { reply({ result: {} }); return; }
      const key = `${typeof id}:${id}`;
      if (this.#reverseIds.has(key)) { reply({ error: { code: -32600, message: 'Duplicate server request ID' } }); return; }
      if (++this.#reverseCount > 8) { reply({ error: { code: -32000, message: 'MCP interaction request limit exceeded' } }); return; }
      this.#reverseIds.add(key);
      // Only a nested, active operation may ask for interaction, never initialize
      // or an unsolicited notification. All approved work is serialized.
      const parent = this.#ready && this.#pending.size === 1 ? this.#pending.values().next().value : undefined;
      this.#interactionQueue = this.#interactionQueue.then(async () => {
        if (this.#interactionStop.signal.aborted) return;
        reply(await handleMcpInteraction(message.method, message.params, parent ? this.#interactionHandlers : undefined, parent ? AbortSignal.any([this.#interactionStop.signal, parent.controller.signal]) : this.#interactionStop.signal,this.#interactionSession));
      }).catch(() => { reply({ error: { code: -32000, message: 'MCP interaction failed' } }); });
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      pending.controller.abort();
      clearTimeout(pending.timer);
      if ('method' in message || ('result' in message) === ('error' in message)) pending.reject(new Error('Invalid MCP response envelope'));
      else if ('error' in message) {
        if (!message.error || typeof message.error !== 'object' || Array.isArray(message.error) || !Number.isSafeInteger(message.error.code) || typeof message.error.message !== 'string') pending.reject(new Error('Invalid MCP error envelope'));
        else {try{pending.reject(new McpProtocolError(message.error,this.#interactionHandlers));}catch(error){pending.reject(error instanceof Error?error:new Error('Invalid MCP error'));}}
      }
      else pending.resolve(message.result);
    }
  }
}

export function configuredMcpServers(config: PlatformConfig): Array<[string, McpServerConfig]> {
  return Object.entries(config.mcpServers);
}

export async function callMcpServer(
  name: string,
  server: McpServerConfig,
  tool: string,
  args: Record<string, unknown>,
  allowNetwork: boolean,
  onNotification?: (value: unknown) => void,
  config?: PlatformConfig,
  interactions?: McpInteractionHandlers,
): Promise<unknown> {
  return requestMcpServer(name, server, 'tools/call', { name: tool, arguments: args }, allowNetwork, onNotification, config, interactions);
}

export async function requestMcpServer(
  name: string,
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  allowNetwork: boolean,
  onNotification?: (value: unknown) => void,
  config?: PlatformConfig,
  interactions?: McpInteractionHandlers,
): Promise<unknown> {
  if (interactions && server.transport === 'http' && server.httpMode !== 'streamable') throw new Error('Interactive HTTP MCP requires Streamable HTTP; direct gateways have no capability negotiation');
  return withMcpAuditScope(name, server.transport, () => withMcpRequester(name, server, allowNetwork, config, onNotification, (request) => request(method, params), interactions));
}

type McpRequester = (method: string, params: Record<string, unknown>) => Promise<unknown>;
/** Explicit target-server acceptance. Only ping/catalog requests, never invokes
 * tools, reads resources, obtains prompts, samples models or opens browser URLs.
 * A stdio server is still real code: workspace trust and explicit consent apply. */
export async function acceptMcpDeployment(cwd:string,name:string,config:PlatformConfig,options:{confirmed:boolean;maxRequests:number;timeoutMs:number}){
 if(!options.confirmed||!Number.isSafeInteger(options.maxRequests)||options.maxRequests<1||options.maxRequests>32||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>120000)throw new Error('MCP acceptance requires --confirm, --max-requests 1–32 and --timeout 100–120000');
 if(!await isWorkspaceTrusted(cwd)||config.policy.mode==='restricted')throw new Error('MCP acceptance requires trusted workspace and non-restricted policy');
 const server=config.mcpServers[name];if(!server)throw new Error('Unknown MCP acceptance server');
 const checks:Array<{method:string;ok:boolean;unsupported?:boolean;items?:number;digest?:string;detail?:string}>=[];let requests=0;
 const controller=new AbortController(),outer=executionSignal(),signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(),options.timeoutMs);
 try{await withExecutionSignal(signal,()=>withMcpAuditScope(name,server.transport,()=>withMcpRequester(name,server,config.policy.allowNetwork,config,undefined,async request=>{
  const call=async(method:string,params:Record<string,unknown>)=>{if(++requests>options.maxRequests){requests--;throw new Error('MCP acceptance probe request limit reached');}return request(method,params)};
  const pong=await call('ping',{});if(!pong||typeof pong!=='object'||Array.isArray(pong))throw new Error('Invalid MCP ping result');checks.push({method:'ping',ok:true});
  for(const [method,key]of [['tools/list','tools'],['resources/list','resources'],['prompts/list','prompts']] as const){
   let cursor:string|undefined,total=0;const seen=new Set<string>(),names=new Set<string>(),catalog:Array<unknown>=[];
   try{for(let page=0;page<32;page++){
    const result=await call(method,cursor?{cursor}:{} ) as Record<string,unknown>;
    if(!result||!Array.isArray(result[key])||(result[key] as unknown[]).length>1024)throw new Error('Invalid bounded MCP catalog');
    const items=result[key] as Array<Record<string,unknown>>;total+=items.length;if(total>2048)throw new Error('MCP acceptance catalog size limit');
    for(const item of items){const identity=method==='resources/list'?item?.uri:item?.name;if(typeof identity!=='string'||!identity||identity.length>4096||names.has(identity))throw new Error('Invalid or duplicate MCP catalog identity');names.add(identity);}
    if(method==='tools/list')validateToolSchemas(items.map(tool=>{if(typeof tool.name!=='string'||!tool.name||tool.name.length>128||!tool.inputSchema||typeof tool.inputSchema!=='object')throw new Error('Invalid MCP tool metadata');return {name:tool.name,description:typeof tool.description==='string'?tool.description:'',input_schema:tool.inputSchema as Record<string,unknown>}}));
    catalog.push(...items);if(result.nextCursor===undefined){checks.push({method,ok:true,items:total,digest:createHash('sha256').update(JSON.stringify(catalog)).digest('hex')});break;}
    if(typeof result.nextCursor!=='string'||!result.nextCursor||result.nextCursor.length>2048||seen.has(result.nextCursor)||page===31)throw new Error('MCP acceptance cursor did not progress');cursor=result.nextCursor;seen.add(cursor);
   }}catch(error){if(error instanceof McpProtocolError&&error.code===-32601&&method!=='tools/list')checks.push({method,ok:true,unsupported:true});else throw error;}
  }
 })));
 }catch(error){checks.push({method:'acceptance',ok:false,detail:redactModelDiagnostic(error instanceof Error?error.message:String(error))});}
 finally{clearTimeout(timer);controller.abort();}
 return {ok:checks.length>0&&checks.every(c=>c.ok),serverDigest:createHash('sha256').update(name).digest('hex'),transport:server.transport,probeRequests:requests,checks,toolCalls:0,modelRequests:0,resourceContentsRead:0,scope:'This target session only; initialization/cleanup are additional transport requests. Reverse approval, OAuth expiry, media models and cross-host certification require separate explicit scenarios.'};
}
interface McpHttpSession { endpoint: string; headers: Record<string, string> }

/** Normalize JSON and SSE RPC envelopes consistently; never turn errors or mismatched IDs into empty success. */
export function decodeMcpResponse(text: string, contentType: string, id: number, onNotification?: (value: unknown) => void, allowRaw = false): unknown {
  const values = contentType.includes('text/event-stream')
    ? new SseDecoder().push(`${text}\n\n`).filter((event) => event.data && event.data !== '[DONE]').map((event) => JSON.parse(event.data)) : [JSON.parse(text)];
  let found = false; let result: unknown;
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP response');
    if (value.jsonrpc === '2.0' && typeof value.method === 'string' && value.id === undefined && !('result' in value) && !('error' in value)) { onNotification?.({ method: value.method, params: value.params }); continue; }
    if (value.jsonrpc === '2.0') {
      if (value.id !== id) continue;
      if ('method' in value || ('result' in value) === ('error' in value)) throw new Error('Invalid MCP response envelope');
      if ('error' in value) {
        if (!value.error || typeof value.error !== 'object' || Array.isArray(value.error) || typeof value.error.message !== 'string') throw new Error('Invalid MCP error envelope');
        throw new McpProtocolError(value.error);
      }
      if (!('result' in value)) throw new Error('MCP response is missing result');
      if (found) throw new Error('Duplicate MCP response ID');
      result = value.result; found = true;
    } else if (allowRaw && !contentType.includes('text/event-stream')) { result = value; found = true; }
    else throw new Error('Invalid MCP JSON-RPC envelope');
  }
  if (!found) throw new Error('MCP response did not contain the requested ID');
  return result;
}

async function withMcpRequester<T>(name: string, server: McpServerConfig, allowNetwork: boolean, config: PlatformConfig | undefined, onNotification: ((value: unknown) => void) | undefined, action: (request: McpRequester, session?: McpHttpSession) => Promise<T>, interactions?: McpInteractionHandlers): Promise<T> {
  if (server.transport === 'stdio') {
    const token = server.tokenEnv ? process.env[server.tokenEnv] ?? await getMcpToken(name, server, config) : await getMcpToken(name, server, config);
    const client = new StdioMcpClient();
    if (onNotification) client.on('notification', onNotification);
    try { await client.connect(server, token, config, interactions); return await action((method, params) => client.request(method, params, Math.min(config?.network.timeoutMs ?? 30000, interactions ? 120000 : 30000))); }
    finally { await client.close(); }
  }
  const endpoint = server.url;
  if (endpoint && ((!allowNetwork || config?.policy.mode === 'restricted') && !isLocalUrl(endpoint))) throw new Error('External network access is disabled by policy');
  if (config && config.policy.mode !== 'bypass') await runHooks(config, 'PermissionRequest', { action: 'mcp-network', server: name, url: server.url }, config.policy.workspaceRoots[0]);
  if (!server.url) throw new Error(`HTTP MCP server ${name} has no URL`);
  if (!config) throw new Error('Platform network configuration is required for HTTP MCP');
  const token = server.tokenEnv ? process.env[server.tokenEnv] ?? await getMcpToken(name, server, config) : await getMcpToken(name, server, config);
  let nextId = 1;
  const reverseBudget = { requests: 0, ids: new Set<string>() };
  const enabledInteractions = config.policy.mode === 'restricted' ? undefined : interactions;
  const capabilities = mcpInteractionCapabilities(enabledInteractions);
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const post = async (method: string, params: Record<string, unknown>, notification = false) => {
    const id = nextId++;
    if (server.httpMode === 'streamable' && !notification) return requestStreamableMcp({ endpoint: server.url!, headers, id, method, params, config, budget: reverseBudget,
      ...(server.resumePostSse?{resumeSse:true}:{}),
      ...(negotiatedMcpHandlers(enabledInteractions,headers['mcp-protocol-version']??'') ? { interactions: negotiatedMcpHandlers(enabledInteractions,headers['mcp-protocol-version']??'')! } : {}),
      ...(onNotification ? { onNotification } : {}), onSessionId: sessionId => { headers['mcp-session-id'] = sessionId; } });
    const response = await networkRequest(server.url!, { method: 'POST', headers, maxResponseBytes: 8_000_000, deadlineMs: config.network.timeoutMs, body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id } : {}), method, params }) }, config.network);
    if (response.status < 200 || response.status >= 300) throw new Error(`MCP HTTP error ${response.status}${response.status === 404 && headers['mcp-session-id'] ? ': session expired; retry explicitly (no automatic tool replay)' : ''}`);
    if (notification) { if (server.httpMode === 'streamable' && (response.status !== 202 || response.body.length)) throw new Error('MCP notification requires empty HTTP 202'); return undefined; }
    const result = decodeMcpResponse(response.text, String(response.headers['content-type'] ?? ''), id, onNotification, server.httpMode !== 'streamable');
    if (method === 'initialize') {
      const sessionId = response.headers['mcp-session-id'];
      if (sessionId !== undefined) {
        if (typeof sessionId !== 'string' || !/^[\x21-\x7e]+$/.test(sessionId)) throw new Error('Invalid MCP session header');
        headers['mcp-session-id'] = sessionId;
      }
    }
    return result;
  };
  try {
    if (server.httpMode === 'streamable') {
      const initialized = await post('initialize', { protocolVersion: mcpInteractionProtocol(enabledInteractions), capabilities, clientInfo: { name: 'ccpt', version: packageMetadata.version } }) as { protocolVersion?: string };
      if (!['2025-11-25','2025-06-18', '2025-03-26', '2024-11-05'].includes(initialized?.protocolVersion ?? '')) throw new Error('MCP server selected an unsupported protocol version');
      headers['mcp-protocol-version'] = initialized.protocolVersion!;
      await post('notifications/initialized', {}, true);
    }
    return await action((method, params) => post(method, params), { endpoint: server.url, headers });
  } finally {
    if (headers['mcp-session-id']) {
      // Cleanup failure must not mask a successfully executed tool or cause its replay.
      try { await networkRequest(server.url!, { method: 'DELETE', headers, signal: AbortSignal.timeout(Math.min(config.network.timeoutMs, 3000)), deadlineMs: Math.min(config.network.timeoutMs, 3000), maxResponseBytes: 16000 }, config.network); } catch { /* Server may not support DELETE. */ }
    }
  }
}

/** Notification-only by default. Interactive listeners require explicit runtime callbacks. */
export async function watchMcpServer(name: string, config: PlatformConfig, options: import('./mcpNotifications.js').McpWatchOptions = {}): Promise<import('./mcpNotifications.js').McpWatchResult> {
  const { listenMcpNotifications, validateWatchOptions } = await import('./mcpNotifications.js');
  validateWatchOptions(options);
  if (options.interactions && config.policy.mode === 'restricted') throw new Error('Interactive MCP is disabled in restricted mode');
  const server = config.mcpServers[name];
  if (!server || server.transport !== 'http' || server.httpMode !== 'streamable') throw new Error('MCP watch requires a configured HTTP server with httpMode=streamable');
  let endpoint: URL;
  try { endpoint = new URL(server.url ?? ''); } catch { throw new Error('MCP watch requires a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('MCP watch endpoint must be HTTP(S), without embedded credentials or fragments');
  const signals = [options.signal, executionSignal()].filter((signal): signal is AbortSignal => Boolean(signal));
  const signal = signals.length ? AbortSignal.any(signals) : new AbortController().signal;
  signal.throwIfAborted();
  return withMcpAuditScope(name,'http-get',()=>withExecutionSignal(signal, () => withMcpRequester(name, server, config.policy.allowNetwork, config, undefined, async (_request, session) => {
    if (!session || !['2025-11-25','2025-03-26', '2025-06-18'].includes(session.headers['mcp-protocol-version'] ?? '')) throw new Error('MCP watch requires a negotiated supported 2025 Streamable HTTP session');
    if(options.interactions && !['2025-11-25','2025-06-18'].includes(session.headers['mcp-protocol-version']!)) throw new Error('Interactive GET requires negotiated 2025-06-18 or newer capabilities');
    const {interactions:_,...baseOptions}=options,negotiated=negotiatedMcpHandlers(options.interactions,session.headers['mcp-protocol-version']!);
    return listenMcpNotifications(session.endpoint, session.headers, config, {...baseOptions,...(negotiated?{interactions:negotiated}:{})}, async () => {
      authorizeMcpNetwork(session.endpoint, config);
      const token = server.tokenEnv ? process.env[server.tokenEnv] ?? await getMcpToken(name, server, config) : await getMcpToken(name, server, config);
      return token;
    });
  },options.interactions)));
}

export interface McpResourceSummary {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}

async function listMcpPages(request: McpRequester, method: string, field: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await request(method, cursor ? { cursor } : {}) as Record<string, unknown>;
    if (!result || !Array.isArray(result[field])) throw new Error(`MCP ${method} did not return ${field}`);
    for (const item of result[field] as unknown[]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid MCP ${field} entry`);
      items.push(item as Record<string, unknown>);
    }
    if (items.length > 10000) throw new Error('MCP catalog exceeds 10000 entries');
    if (result.nextCursor === undefined) return items;
    if (typeof result.nextCursor !== 'string' || !result.nextCursor || cursors.has(result.nextCursor)) throw new Error('Invalid or repeated MCP pagination cursor');
    cursor = result.nextCursor; cursors.add(cursor);
  }
  throw new Error('MCP catalog exceeded 100 pages');
}

export async function listMcpResources(config: PlatformConfig, serverName?: string): Promise<McpResourceSummary[]> {
  const servers = serverName
    ? Object.entries(config.mcpServers).filter(([name]) => name === serverName)
    : Object.entries(config.mcpServers);
  if (serverName && servers.length === 0) throw new Error(`Unknown MCP server: ${serverName}`);
  const output: McpResourceSummary[] = [];
  for (const [name, server] of servers) {
    const resources = await withMcpRequester(name, server, config.policy.allowNetwork, config, undefined, request => listMcpPages(request, 'resources/list', 'resources'));
    for (const resource of resources) {
      if (typeof resource.uri !== 'string') continue;
      output.push({ uri: resource.uri, name: typeof resource.name === 'string' ? resource.name : resource.uri, ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}), ...(typeof resource.description === 'string' ? { description: resource.description } : {}), server: name });
    }
  }
  return output;
}

export async function readMcpResource(config: PlatformConfig, serverName: string, uri: string): Promise<unknown> {
  const server = config.mcpServers[serverName];
  if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
  const result = await requestMcpServer(serverName, server, 'resources/read', { uri }, config.policy.allowNetwork, undefined, config) as { contents?: Array<Record<string, unknown>> };
  if (!Array.isArray(result.contents)) return result;
  const directory = join(homeStateDir(), 'mcp-output');
  await mkdir(directory, { recursive: true });
  const contents = await Promise.all(result.contents.map(async (content, index) => {
    if (typeof content.blob !== 'string') return content;
    const bytes = Buffer.from(content.blob, 'base64');
    if (bytes.length > 50_000_000) return { ...content, blob: undefined, error: 'Binary MCP resource exceeds the 50 MB persistence limit' };
    const mime = typeof content.mimeType === 'string' ? content.mimeType : 'application/octet-stream';
    const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'application/pdf': '.pdf', 'audio/mpeg': '.mp3', 'audio/wav': '.wav' } as Record<string, string>)[mime] ?? '.bin';
    const path = join(directory, `${createId('resource')}-${index}${extension}`);
    await writeFile(path, bytes, { mode: 0o600 });
    const { blob: _blob, ...withoutBlob } = content;
    return { ...withoutBlob, blobSavedTo: path, size: bytes.length };
  }));
  return { ...result, contents };
}

export async function listMcpPrompts(config: PlatformConfig, serverName?: string): Promise<Array<Record<string, unknown> & { server: string }>> {
  const servers = serverName
    ? Object.entries(config.mcpServers).filter(([name]) => name === serverName)
    : Object.entries(config.mcpServers);
  if (serverName && servers.length === 0) throw new Error(`Unknown MCP server: ${serverName}`);
  const output: Array<Record<string, unknown> & { server: string }> = [];
  for (const [name, server] of servers) {
    const prompts = await withMcpRequester(name, server, config.policy.allowNetwork, config, undefined, request => listMcpPages(request, 'prompts/list', 'prompts'));
    for (const prompt of prompts) output.push({ ...prompt, server: name });
  }
  return output;
}

export async function getMcpPrompt(config: PlatformConfig, serverName: string, promptName: string, args: Record<string, string> = {}): Promise<unknown> {
  const server = config.mcpServers[serverName];
  if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
  return requestMcpServer(serverName, server, 'prompts/get', { name: promptName, arguments: args }, config.policy.allowNetwork, undefined, config);
}

export async function inspectMcpServer(name: string, server: McpServerConfig, config?: PlatformConfig): Promise<unknown> {
  return withMcpRequester(name, server, config?.policy.allowNetwork ?? false, config, undefined, async (request) => {
    return { tools: await listMcpPages(request, 'tools/list', 'tools') };
  });
}
