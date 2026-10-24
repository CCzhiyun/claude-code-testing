import type { PlatformConfig } from './types.js';
import { networkRequest } from './network.js';
import { SseDecoder, type SseEvent } from './cli/transports/SSETransport.js';
import { executionSignal, withExecutionSignal } from './executionControl.js';
import { abortableDelay } from './modelRetry.js';
import { handleMcpInteraction,McpInteractionSession, type McpInteractionHandlers } from './mcpInteraction.js';
import { auditMcpReply } from './mcpInteractionAudit.js';

export interface McpNotification { method: string; params?: unknown }
export interface McpWatchOptions {
  /** Explicit live approval callbacks; absent means notification-only, never inherited from settings. */
  interactions?: McpInteractionHandlers;
  maxInteractions?: number;
  durationMs?: number;
  maxEvents?: number;
  maxReconnects?: number;
  reconnectDelayMs?: number;
  signal?: AbortSignal;
  /** Synchronous sink. Queue work elsewhere; never execute notification content as instructions. */
  onNotification?: (notification: McpNotification) => void;
  /** Informational rejection notice only, never an approval or request executor. */
  onDeniedRequest?: (notice: { method: string; reason: string }) => void;
  onStatus?: (status: { state: 'connecting' | 'connected' | 'reconnecting'; reconnects: number }) => void;
}
export interface McpWatchResult {
  reason: 'duration' | 'event-limit' | 'cancelled';
  notifications: number; reconnects: number; deniedRequests: number; pings: number;
}
class PermanentStreamError extends Error {}
export function validateWatchOptions(options: McpWatchOptions): void {
  if (options.maxInteractions !== undefined && (!Number.isSafeInteger(options.maxInteractions) || options.maxInteractions < 1 || options.maxInteractions > 32)) throw new Error('MCP watch maxInteractions must be 1–32');
  for (const [name, min, max] of [['durationMs', 1, 3_600_000], ['maxEvents', 1, 10_000], ['maxReconnects', 0, 20], ['reconnectDelayMs', 10, 30_000]] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < min || value > max)) throw new Error(`MCP watch ${name} must be an integer between ${min} and ${max}`);
  }
}

/** Independent GET stream for the negotiated 2025 Streamable HTTP transport.
 * Cursor lives only within this session. Reconnection NEVER resends a tool POST.
 * Constant-size HTTP buffering, bounded frame/queue/total bytes and reconnect count. */
export async function listenMcpNotifications(endpoint: string, headers: Record<string, string>, config: PlatformConfig, options: McpWatchOptions, refreshToken: () => Promise<string | undefined>): Promise<McpWatchResult> {
  validateWatchOptions(options);
  if (options.interactions && config.policy.mode === 'restricted') throw new Error('Interactive MCP is disabled in restricted mode');
  const duration = options.durationMs ?? 60_000, maxEvents = options.maxEvents ?? 1000;
  const stop = new AbortController();
  const signals = [stop.signal, executionSignal(), options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
  const signal = AbortSignal.any(signals);
  const result: McpWatchResult = { reason: 'duration', notifications: 0, reconnects: 0, deniedRequests: 0, pings: 0 };
  let reason: McpWatchResult['reason'] | undefined;
  const finish = (value: McpWatchResult['reason']): void => { reason ??= value; stop.abort(); };
  const timer = setTimeout(() => finish('duration'), duration);
  const deadline = Date.now() + duration;
  let lastEventId = '', bytes = 0, received = 0, serverRetry: number | undefined;
  const seen = new Set<string>();
  const requestIds = new Set<string>(); let interactionCount = 0;
  const interactions=new McpInteractionSession();
  try {
    while (!signal.aborted) {
      options.onStatus?.({ state: result.reconnects ? 'reconnecting' : 'connecting', reconnects: result.reconnects });
      // Credentials are resolved for each GET; never follow a server-provided URL.
      let token: string | undefined;
      try { token = await withExecutionSignal(signal, refreshToken); }
      catch { if (signal.aborted) break; throw new Error('MCP watch credential resolution failed'); }
      if (token) headers.authorization = `Bearer ${token}`; else delete headers.authorization;
      const decoder = new SseDecoder(1_000_000), utf8 = new TextDecoder('utf-8', { fatal: true });
      const connection = new AbortController();
      const requestSignal = AbortSignal.any([signal, connection.signal]);
      let failure: Error | undefined, queued = 0;
      let queue = Promise.resolve();
      const handle = async (event: SseEvent): Promise<void> => {
        if (signal.aborted) return;
        if(event.retry!==undefined)serverRetry=event.retry;
        if (event.id !== undefined && (event.id.length > 512 || !/^[\x21-\x7e]*$/.test(event.id))) throw new PermanentStreamError('Invalid MCP event ID');
        if (event.id && seen.has(event.id)) return; // Do not regress the resume cursor on a duplicate.
        if (event.data) {
          let message: any;
          try { message = JSON.parse(event.data); } catch { throw new PermanentStreamError('Invalid JSON in MCP notification stream'); }
          if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method || 'result' in message || 'error' in message) throw new PermanentStreamError('Expected a server notification or request on the independent MCP stream');
          if ('id' in message) {
            if (!(typeof message.id === 'string' && message.id.length <= 512 || typeof message.id === 'number' && Number.isSafeInteger(message.id))) throw new PermanentStreamError('Invalid MCP server request ID');
            const ping = message.method === 'ping';
            const key = `${typeof message.id}:${message.id}`;
            const duplicate = requestIds.has(key);
            if (!ping) requestIds.add(key);
            const outcome = ping ? { result: {} } : duplicate ? { error: { code: -32600, message: 'Duplicate server request ID' } }
              : interactionCount++ >= (options.maxInteractions ?? 8) ? { error: { code: -32000, message: 'MCP interaction limit exceeded' } }
              : await handleMcpInteraction(message.method, message.params, options.interactions, requestSignal,interactions);
            if (signal.aborted) return;
            const reply = { jsonrpc: '2.0', id: message.id, ...outcome };
            const response = await networkRequest(endpoint, { method: 'POST', headers, body: JSON.stringify(reply), signal: requestSignal, deadlineMs: Math.max(1, Math.min(3000, deadline - Date.now())), maxResponseBytes: 16000 }, config.network);
            if (response.status !== 202 || response.body.length) throw new PermanentStreamError(`MCP server rejected client response (${response.status})`);
            await auditMcpReply(outcome, 'reply-acknowledged');
            if (ping) result.pings++; else if ('error' in outcome) {
              result.deniedRequests++;
              const returned: unknown = options.onDeniedRequest?.({ method: message.method.slice(0, 256), reason: 'Client capability is not enabled; no model, tool or form input was executed' });
              if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') { Promise.resolve(returned).catch(() => {}); throw new PermanentStreamError('MCP rejection callbacks must be synchronous'); }
            }
          } else {
            if(!interactions.notification(message.method,message.params,options.interactions)){
              // Still acknowledge the event cursor: unknown/duplicate completion
              // IDs are ignored, never retried as commands or shown as success.
              if(event.id!==undefined){lastEventId=event.id;if(event.id)seen.add(event.id);}return;
            }
            const returned: unknown = options.onNotification?.({ method: message.method, ...('params' in message ? { params: message.params } : {}) });
            if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
              Promise.resolve(returned).catch(() => {});
              throw new PermanentStreamError('MCP notification callbacks must be synchronous');
            }
            result.notifications++;
          }
        }
        if (event.id !== undefined) {
          lastEventId = event.id;
          if (event.id) seen.add(event.id);
        }
        if (result.notifications >= maxEvents) finish('event-limit');
      };
      try {
        await networkRequest(endpoint, {
          method: 'GET', headers: { ...headers, accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
          signal: requestSignal, deadlineMs: Math.max(1, deadline - Date.now()), collectBody: false,
          onHeaders(status, responseHeaders) {
            if (status === 404) throw new PermanentStreamError('MCP session expired; restart watch explicitly. No tool calls were replayed.');
            if (status === 405) throw new PermanentStreamError('MCP server does not support an independent GET/SSE stream');
            if ([502, 503, 504].includes(status)) throw new Error(`Transient MCP stream HTTP ${status}`);
            if (status !== 200) throw new PermanentStreamError(`MCP stream HTTP ${status}`);
            if (String(responseHeaders['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() !== 'text/event-stream') throw new PermanentStreamError('MCP GET response must use text/event-stream');
            options.onStatus?.({ state: 'connected', reconnects: result.reconnects });
          },
          onData(chunk) {
            try {
              bytes += chunk.length;
              if (bytes > 8_000_000) throw new PermanentStreamError('MCP watch exceeds the 8 MB total data limit');
              const events = decoder.push(utf8.decode(chunk, { stream: true }));
              for (const event of events) {
                if (++received > 20_000 || ++queued > 128) throw new PermanentStreamError('MCP watch event/queue limit exceeded');
                queue = queue.then(async () => { if (!failure) await handle(event); }).catch(error => {
                  failure = error instanceof PermanentStreamError ? error : new PermanentStreamError('MCP notification processing failed');
                  connection.abort();
                }).finally(() => { queued--; });
              }
            } catch (error) {
              failure = error instanceof PermanentStreamError ? error : new PermanentStreamError('Invalid or oversized MCP event stream');
              throw failure;
            }
          },
        }, config.network);
      } catch (error) {
        // A stream error is not authorization to reinitialize or replay POST requests.
        if (error instanceof PermanentStreamError) failure = error;
      }
      await queue;
      if (signal.aborted) break;
      if (failure) throw failure;
      if (result.reconnects >= (options.maxReconnects ?? 5)) throw new Error('MCP notification reconnect limit reached; restart watch explicitly');
      result.reconnects++;
      const delay=serverRetry??Math.min(30_000,(options.reconnectDelayMs??1000)*2**(result.reconnects-1));
      // Never reconnect sooner than the server asks, even if its delay is larger
      // than our total watch duration. The duration timer remains authoritative.
      try { await abortableDelay(delay, signal); }
      catch { if (!signal.aborted) throw new Error('MCP reconnect wait failed'); }
    }
    result.reason = reason ?? 'cancelled';
    return result;
  } finally { clearTimeout(timer); stop.abort(); }
}
