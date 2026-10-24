import { randomUUID } from 'node:crypto';
import type { ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import { authorizeModelEndpoint, callModel, type ModelResponse } from './model.js';
import { API_PRESETS, apiPresetPatch, modelAuthHeaders, resolveModelEndpoint, resolveModelProtocol, resolveModelWireProtocol, type ApiPreset } from './modelConnection.js';
import { networkRequest } from './network.js';
import { executionSignal, withExecutionSignal } from './executionControl.js';
import { withSpendScope } from './spending.js';
import { prepareModelCredential } from './protectedModelCredentials.js';
import { ModelRequestError, type ModelDiagnostic } from './modelErrors.js';

/** Model probe options are temporary and must be applied BEFORE managed settings. */
export function modelProbeOverrides(args: string[], settingsModel?: Partial<PlatformConfig['model']>): Partial<PlatformConfig> {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    if (index < 0) return undefined;
    if (args[index + 1] === undefined || args[index + 1]!.startsWith('--')) throw new Error(`--${name} requires a value`);
    return args[index + 1];
  };
  const preset = value('api-preset');
  if (preset && !API_PRESETS.includes(preset as ApiPreset)) throw new Error('Unknown API preset');
  const patch: Partial<PlatformConfig['model']> = { ...settingsModel, ...(preset ? apiPresetPatch(preset as ApiPreset) : {}) };
  for (const [flag, key] of [['model', 'name'], ['endpoint-url', 'endpointUrl'], ['base-url', 'baseUrl'], ['api-key-env', 'apiKeyEnv'], ['api-key-header', 'apiKeyHeader'], ['api-key-prefix', 'apiKeyPrefix'], ['api-protocol', 'apiProtocol'], ['responses-transport', 'responsesTransport'], ['chat-tool-reasoning', 'chatToolReasoning']] as const) {
    const option = value(flag);
    if (option !== undefined) Object.assign(patch, { [key]: option });
  }
  // An explicitly changed destination must also explicitly select its credential.
  // Do not inherit the user's default model key into a new host during a test.
  if ((patch.endpointUrl || patch.baseUrl) && !patch.apiKeyEnv) throw new Error('Changing the probe destination requires --api-preset or --api-key-env; credentials are not inferred across destinations');
  if (patch.baseUrl && !patch.endpointUrl) patch.endpointUrl = '';
  if (patch.endpointUrl || patch.baseUrl) patch.headersFromEnvironment = settingsModel?.headersFromEnvironment ?? {};
  return Object.keys(patch).length ? { model: patch as PlatformConfig['model'] } : {};
}

export interface ModelProbeOptions { connectivityOnly?: boolean; stream?: boolean; toolsCheck?: boolean; fullToolsCheck?: boolean; conversationCheck?: boolean; cancellationCheck?: boolean; diagnostics?: boolean; timeoutMs?: number }
export interface ModelProbeReport {
  ok: boolean; stage: string; model: string; protocol: string; endpoint: string;
  wireProtocol?: string;
  authenticatedModelVerified: boolean; elapsedMs: number; detail: string;
  status?: number; textReceived?: boolean; expectedReplyMatched?: boolean;
  streamRequested?: boolean; textDeltaCallbacks?: number; toolRoundTrip?: boolean;
  usage?: ModelResponse['usage'];
  diagnostics?: ModelDiagnostic;
  catalogToolCount?: number;
  conversationRoundTrip?: boolean;
  cancellationObserved?: boolean;
}

function failureStage(error: unknown): { stage: string; status?: number; detail: string } {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++, current = current.cause) {
    const code = String((current as NodeJS.ErrnoException).code ?? '');
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return { stage: 'dns', detail: 'Hostname cannot be resolved. Check corporate VPN, DNS and proxy configuration.' };
    if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return { stage: 'tls', detail: 'TLS verification or handshake failed. Check the company CA chain, hostname and mTLS client certificate. Verification was not disabled.' };
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return { stage: 'connection', detail: 'The configured endpoint/proxy could not be reached reliably. Check VPN, port, firewall and proxy.' };
    if (current instanceof ModelRequestError) {
      const status = current.status;
      if ([401, 403].includes(status)) return { stage: 'authentication', status, detail: 'The server rejected authentication or access. Check the gateway-specific key/header and deployment permissions.' };
      if (status === 404) return { stage: 'route-or-deployment', status, detail: 'HTTP 404: endpoint route or deployment was not found. Chat Completions support does not establish Responses support.' };
      if ([429, 502, 503, 529].includes(status)) return { stage: 'capacity', status, detail: 'Rate/quota/capacity error. Inspect provider quota; this does not prove a protocol mismatch.' };
      return { stage: 'provider-request', status, detail: 'The server rejected this protocol request. Check deployment name, API version and supported request fields.' };
    }
    if (/credential environment variable|Required model header/.test(current.message)) return { stage: 'credentials', detail: 'A configured credential environment variable is missing. No fallback key was sent.' };
    if (/CA file|ENOENT|PEM|private key/i.test(current.message)) return { stage: 'certificate-files', detail: 'A configured CA/client certificate file is missing or invalid.' };
    if (/timed out|deadline|cancelled|aborted/i.test(current.message)) return { stage: 'timeout', detail: 'Probe stopped at its deadline or was cancelled; the conversation was not modified.' };
  }
  return { stage: 'protocol-or-policy', detail: 'The model response, configuration, policy or budget did not permit a successful probe. Server text is not printed to avoid exposing credentials.' };
}

/** No repository instructions, Skills, Hooks, MCP, chat history or filesystem tools. */
export async function probeModel(config: PlatformConfig, options: ModelProbeOptions = {}): Promise<ModelProbeReport> {
  const toolsCheck = options.toolsCheck || options.fullToolsCheck;
  const started = Date.now();
  const report: ModelProbeReport = { ok: false, stage: 'configuration', model: config.model.name, protocol: resolveModelProtocol(config.model), wireProtocol: resolveModelWireProtocol(config.model), endpoint: '', authenticatedModelVerified: false, elapsedMs: 0, detail: '' };
  const timeout = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120_000) throw new Error('Probe timeout must be 100–120000 milliseconds');
  if ([Boolean(options.connectivityOnly), Boolean(toolsCheck), Boolean(options.conversationCheck), Boolean(options.cancellationCheck)].filter(Boolean).length > 1) throw new Error('Probe modes cannot be combined');
  const controller = new AbortController();
  const parent = executionSignal();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const endpoint = resolveModelEndpoint(config.model), url = new URL(endpoint);
    // Never display query credentials or provider response bodies.
    report.endpoint = `${url.origin}${url.pathname}`;
    authorizeModelEndpoint(config, endpoint);
    if (!config.network.rejectUnauthorized) throw new Error('Model probes require TLS verification to remain enabled');
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Model probes require HTTPS outside loopback');
    await withExecutionSignal(signal, async () => {
      signal.throwIfAborted();
      if (options.connectivityOnly) {
        const response = await networkRequest(endpoint, { method: 'HEAD', maxResponseBytes: 65536, deadlineMs: timeout }, config.network);
        report.status = response.status; report.ok = true; report.stage = 'http-reachable';
        report.detail = 'Unauthenticated HEAD received an HTTP response. This does NOT verify model availability, authentication, Responses support or tool calling.';
        return;
      }
      await prepareModelCredential(config.model);
      modelAuthHeaders(config.model); // fail closed if the explicitly selected secret is absent
      const runtime = structuredClone(config);
      runtime.model.maxOutputTokens = Math.min(runtime.model.maxOutputTokens, 512);
      runtime.model.responsesStore = false;
      runtime.model.responsesTextFormat = null;
      runtime.modelRetry = { ...runtime.modelRetry, maxRetries: 0 };
      let deltas = 0;
      const stream = options.stream || options.cancellationCheck ? { onTextDelta() { deltas++; if (options.cancellationCheck) controller.abort(); } } : undefined;
      const marker = options.conversationCheck ? `CCPT_${randomUUID().replaceAll('-', '')}` : 'CCPT_OK';
      const messages: ModelMessage[] = [{ role: 'user', content: options.cancellationCheck ? 'CCPT_CANCEL_STREAM: Write a long numbered list of 1000 programming terms. Begin immediately with text.' : toolsCheck ? 'Call ccpt_probe_echo with value CCPT_OK exactly once. Do not call any other tool. After receiving the tool output, reply with that value only.' : `Reply with ${marker} only.` }];
      const tools: ToolDefinition[] = toolsCheck ? [{ name: 'ccpt_probe_echo', description: 'A harmless local protocol echo; no filesystem, shell or network side effects.', input_schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] : [];
      // Schema registration only. Even with the full catalog, only the fixed echo is executable here.
      if (options.fullToolsCheck) tools.push(...(await import('./tooling.js')).tools);
      report.catalogToolCount = tools.length;
      await withSpendScope(`model-probe-${randomUUID()}`, async () => {
        let response: ModelResponse;
        try { response = await callModel(runtime, 'You are testing a model API connection. Follow the small diagnostic request only.', messages, tools, stream); }
        catch (error) {
          if (options.cancellationCheck && deltas > 0 && controller.signal.aborted && !parent?.aborted) {
            report.ok = true; report.stage = 'stream-cancelled'; report.cancellationObserved = true; report.streamRequested = true; report.textDeltaCallbacks = deltas;
            report.authenticatedModelVerified = true; report.detail = 'Client stopped the streamed request after text; no generated tool was executed. This does not verify provider billing cancellation.'; return;
          }
          throw error;
        }
        if (options.cancellationCheck) {
          report.stage = 'cancellation-not-observed'; report.cancellationObserved = false; report.detail = 'The request completed or returned without an observable streaming cancellation. Not counted as a cancellation pass.'; return;
        }
        if (options.conversationCheck) {
          const firstText = response.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
          if (firstText.trim() !== marker || response.content.some(block => block.type === 'tool_use')) throw new Error('Initial conversation marker did not match');
          messages.push({ role: 'assistant', content: response.content, ...(response.responses ? { responses: response.responses } : {}) });
          messages.push({ role: 'user', content: 'Repeat only the exact marker from your previous answer.' });
          response = await callModel(runtime, 'Continue the diagnostic conversation; do not use tools.', messages, [], stream);
          if (response.content.some(block => block.type === 'tool_use')) throw new Error('Conversation probe refused tools');
        }
        if (toolsCheck) {
          const calls = response.content.filter((block) => block.type === 'tool_use');
          if (calls.length !== 1 || calls[0]?.name !== 'ccpt_probe_echo' || calls[0].input?.value !== 'CCPT_OK' || !calls[0].id) throw new Error('Probe tool call did not match the expected echo');
          messages.push({ role: 'assistant', content: response.content, ...(response.responses ? { responses: response.responses } : {}) });
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: calls[0].id, content: 'CCPT_OK' }] });
          response = await callModel(runtime, 'Reply with the tool output only. Do not call further tools.', messages, options.fullToolsCheck ? tools : [], stream);
          if (response.content.some((block) => block.type === 'tool_use')) throw new Error('Probe refused additional tool execution');
          report.toolRoundTrip = true;
        }
        const text = response.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
        report.textReceived = Boolean(text.trim()); report.expectedReplyMatched = text.trim() === marker;
        if (options.conversationCheck) report.conversationRoundTrip = report.expectedReplyMatched;
        report.usage = response.usage;
        report.streamRequested = Boolean(options.stream); report.textDeltaCallbacks = deltas;
        report.ok = report.expectedReplyMatched; report.authenticatedModelVerified = report.ok;
        report.stage = report.ok ? 'model-response' : 'unexpected-reply';
        report.detail = report.ok ? 'The selected protocol returned the expected diagnostic reply. This verifies only this deployment/request, not full enterprise acceptance.' : 'The server returned a response but not the requested marker; model output is intentionally hidden.';
      });
    });
  } catch (error) {
    Object.assign(report, failureStage(error));
    if (options.diagnostics) {
      let current = error;
      for (let depth = 0; depth < 8 && current instanceof Error; depth++, current = current.cause) {
        if (current instanceof ModelRequestError && current.diagnostics) { report.diagnostics = current.diagnostics; break; }
      }
    }
  }
  finally { clearTimeout(timer); report.elapsedMs = Date.now() - started; }
  return report;
}

export interface ModelAcceptanceReport { ok: boolean; checks: Array<{ name: string; report: ModelProbeReport }>; scope: string }
/** Explicit paid diagnostic suite, no project context or executable model-selected tools. */
export async function probeModelAcceptance(config: PlatformConfig, confirmed: boolean, options: Pick<ModelProbeOptions, 'timeoutMs' | 'diagnostics'> = {}): Promise<ModelAcceptanceReport> {
  if (!confirmed) throw new Error('Model acceptance requires --confirm: up to 7 paid model requests including the full tool schema catalog');
  const report: ModelAcceptanceReport = { ok: false, checks: [], scope: 'This deployment/protocol only; no workspace reads, shell, MCP, plugins, session history or corporate environment certification. Cost/budget metadata may be recorded.' };
  const stages: Array<[string, ModelProbeOptions]> = [['ordinary-chat', {}], ['multi-turn', { conversationCheck: true }], ['full-catalog-tool-roundtrip', { fullToolsCheck: true }], ['streaming-text', { stream: true }], ['streaming-cancel', { cancellationCheck: true }]];
  for (const [name, stage] of stages) {
    const result = await probeModel(config, { ...options, ...stage });
    if (name === 'streaming-text' && !result.textDeltaCallbacks) { result.ok = false; result.stage = 'no-text-deltas'; result.detail = 'No text callbacks were observed.'; }
    report.checks.push({ name, report: result });
    if (!result.ok) return report; // Never spend more requests after a failure or silently switch protocols.
  }
  report.ok = true; return report;
}
