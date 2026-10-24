import type { PlatformConfig } from './types.js';
import { networkRequest } from './network.js';
import { executionSignal } from './executionControl.js';
import { SseDecoder } from './cli/transports/SSETransport.js';
import { handleMcpInteraction,McpInteractionSession, type McpInteractionHandlers } from './mcpInteraction.js';
import {McpProtocolError} from './mcpErrors.js';
import { auditMcpReply } from './mcpInteractionAudit.js';
import { abortableDelay } from './modelRetry.js';

export interface McpReverseBudget { requests: number; ids: Set<string>;session?:McpInteractionSession }
export interface McpHttpRequestOptions {
  endpoint: string; headers: Record<string, string>; id: number; method: string; params: Record<string, unknown>;
  config: PlatformConfig; budget: McpReverseBudget;
  interactions?: McpInteractionHandlers;
  onNotification?: (value: unknown) => void;
  onSessionId?: (id: string) => void;
  /** Resume a broken POST SSE with GET + its cursor. Never re-send the tool POST. */
  resumeSse?: boolean;
}
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Read POST/SSE while open; optional cursor-only GET continuation, never tool replay or a server-provided reply URL. */
export async function requestStreamableMcp(options: McpHttpRequestOptions): Promise<unknown> {
  const { endpoint, headers, id, method, params, config, budget } = options;
  const session=budget.session??=new McpInteractionSession();
  const outer = executionSignal(), connection = new AbortController(), review = new AbortController();
  const signal = outer ? AbortSignal.any([outer, connection.signal]) : connection.signal;
  const reviewSignal = outer ? AbortSignal.any([outer, review.signal]) : review.signal;
  const deadline = Date.now() + config.network.timeoutMs;
  let timedOut = false;
  const operationTimer = setTimeout(() => { timedOut = true; review.abort(); connection.abort(); }, config.network.timeoutMs);
  let decoder = new SseDecoder(1_000_000), utf8 = new TextDecoder('utf-8', { fatal: true });
  let lastEventId='',retryMs=0;const seenEvents=new Set<string>();
  const chunks: Buffer[] = [];
  let mode = '', bytes = 0, frames = 0, queued = 0, found = false, ended = false;
  let result: unknown, failure: Error | undefined, rpcError: Error | undefined, transportError: unknown;
  let queue = Promise.resolve();
  const fail = (error: Error) => { failure ??= error; review.abort(); connection.abort(); };
  const reply = async (requestId: string | number, outcome: object) => {
    if (ended || outer?.aborted || Date.now() >= deadline) return;
    const response = await networkRequest(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, ...outcome }),
      ...(outer ? { signal: outer } : {}), deadlineMs: Math.max(1, Math.min(3000, deadline - Date.now())), maxResponseBytes: 16000 }, config.network);
    if (response.status !== 202 || response.body.length) throw new Error('MCP server did not accept the client response with empty HTTP 202');
    await auditMcpReply(outcome, 'reply-acknowledged');
  };
  const consume = (value: unknown) => {
    if (++frames > 4096 || !object(value) || value.jsonrpc !== '2.0') throw new Error('Invalid or excessive MCP HTTP frames');
    if ('method' in value) {
      if (mode !== 'text/event-stream' || typeof value.method !== 'string' || !value.method || 'result' in value || 'error' in value) throw new Error('Invalid MCP server request/notification envelope');
      if (found) throw new Error('MCP server sent data after its terminal response');
      if (!('id' in value)) {
        if(!session.notification(value.method,value.params,options.interactions))return;
        const returned: unknown = options.onNotification?.({ method: value.method, ...('params' in value ? { params: value.params } : {}) });
        if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') { Promise.resolve(returned).catch(() => {}); throw new Error('MCP notification callbacks must be synchronous'); }
        return;
      }
      if (!(typeof value.id === 'string' && value.id.length <= 512 || typeof value.id === 'number' && Number.isSafeInteger(value.id))) throw new Error('Invalid MCP server request ID');
      const requestId = value.id as string | number, key = `${typeof requestId}:${requestId}`;
      let denial: { error: { code: number; message: string } } | undefined;
      if (value.method !== 'ping') {
        if (budget.ids.has(key)) denial = { error: { code: -32600, message: 'Duplicate server request ID' } };
        else if (budget.requests >= 8) denial = { error: { code: -32000, message: 'MCP interaction request limit exceeded' } };
        else { budget.requests++; budget.ids.add(key); }
      }
      if (++queued > 16) throw new Error('MCP reverse request queue exceeded');
      queue = queue.then(async () => {
        if (ended || found || reviewSignal.aborted) return;
        const outcome = denial ?? (value.method === 'ping' ? { result: {} } : await handleMcpInteraction(value.method, value.params, options.interactions, reviewSignal,session));
        if (!ended && !found && !reviewSignal.aborted) await reply(requestId, outcome);
      }).catch(error => fail(error instanceof Error ? error : new Error('MCP reverse request failed'))).finally(() => { queued--; });
      return;
    }
    if (value.id !== id) return;
    if (found) throw new Error('Duplicate MCP response ID');
    if (('result' in value) === ('error' in value)) throw new Error('Invalid MCP response envelope');
    if ('error' in value) {
      if (!object(value.error) || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== 'string') throw new Error('Invalid MCP error envelope');
      rpcError = new McpProtocolError(value.error,options.interactions);
    } else result = value.result;
    found = true; review.abort();
    // Complete result is sufficient. A server must not keep the caller captive
    // by leaving an otherwise-completed SSE response open indefinitely.
    queueMicrotask(() => connection.abort());
  };
  const events=(text:string)=>{
    for(const event of decoder.push(text)){
      if(event.retry!==undefined)retryMs=event.retry;
      if(event.id!==undefined&&(event.id.length>512||!/^[\x21-\x7e]*$/.test(event.id)))throw new Error('Invalid MCP SSE event ID');
      if(event.id&&seenEvents.has(event.id))continue;
      if(event.data&&event.data!=='[DONE]')consume(JSON.parse(event.data));
      if(event.id!==undefined){lastEventId=event.id;if(event.id){if(seenEvents.size>=4096)throw new Error('MCP SSE cursor limit exceeded');seenEvents.add(event.id);}}
    }
  };
  const onData=(chunk:Buffer)=>{
    bytes+=chunk.length;if(bytes>8_000_000)throw new Error('MCP response exceeds 8 MB');
    try{if(mode==='application/json')chunks.push(chunk);else events(utf8.decode(chunk,{stream:true}));}
    catch(error){fail(error instanceof Error?error:new Error('Invalid MCP stream'));throw failure;}
  };
  try {
    try {
      await networkRequest(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal,
        collectBody: false, maxResponseBytes: 8_000_000, deadlineMs: config.network.timeoutMs,
        onHeaders(status, responseHeaders) {
          if (status !== 200) throw new Error(`MCP HTTP error ${status}${status === 404 && headers['mcp-session-id'] ? ': session expired; retry explicitly (no automatic tool replay)' : ''}`);
          mode = String(responseHeaders['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
          if (!['application/json', 'text/event-stream'].includes(mode)) throw new Error('MCP HTTP response must be JSON or SSE');
          if (method === 'initialize' && responseHeaders['mcp-session-id'] !== undefined) {
            const sessionId = responseHeaders['mcp-session-id'];
            if (typeof sessionId !== 'string' || sessionId.length > 512 || !/^[\x21-\x7e]+$/.test(sessionId)) throw new Error('Invalid MCP session header');
            options.onSessionId?.(sessionId);
          }
        },
        onData,
      }, config.network);
      if (mode === 'application/json') consume(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      else if (!found) {
        events(utf8.decode());
        if (decoder.hasPendingData) throw new Error('Incomplete MCP SSE frame');
      }
    } catch (error) { transportError = error; }
    for(let resumed=0;options.resumeSse&&method!=='initialize'&&!found&&!failure&&!outer?.aborted&&mode==='text/event-stream'&&lastEventId&&resumed<2&&Date.now()<deadline;resumed++){
      await queue;if(found||failure||reviewSignal.aborted||Date.now()>=deadline)break;
      if(retryMs>=deadline-Date.now()){transportError=new Error('MCP SSE retry interval exceeds the remaining request deadline; no tool POST was replayed');break;}
      if(retryMs)await abortableDelay(retryMs,signal);
      decoder=new SseDecoder(1_000_000);utf8=new TextDecoder('utf-8',{fatal:true});
      let rejectedStatus:number|undefined;
      try{
        await networkRequest(endpoint,{method:'GET',headers:{...headers,accept:'text/event-stream','last-event-id':lastEventId},signal,collectBody:false,maxResponseBytes:8_000_000,deadlineMs:Math.max(1,deadline-Date.now()),
          onHeaders(status,responseHeaders){if(status!==200||String(responseHeaders['content-type']??'').split(';')[0]!.trim().toLowerCase()!=='text/event-stream'){rejectedStatus=status;throw new Error(`MCP SSE continuation rejected (${status}); no tool POST was replayed`);}},onData},config.network);
        if(!found){events(utf8.decode());if(decoder.hasPendingData)throw new Error('Incomplete resumed MCP SSE frame');}
      }catch(error){transportError=error;if(!found&&rejectedStatus!==undefined&&![502,503,504].includes(rejectedStatus))break;}
    }
    // Revoke callbacks immediately when the originating operation is over.
    ended = true; review.abort(); await queue;
    if (failure) throw failure;
    if (!found) throw timedOut ? new Error('MCP request timed out; no tool POST was replayed') : transportError ?? new Error('MCP response did not contain the requested ID');
    if (rpcError) throw rpcError;
    return result;
  } finally {
    clearTimeout(operationTimer); ended = true; review.abort(); connection.abort();
    if (!found && (timedOut || outer?.aborted || transportError instanceof Error && /deadline|timed out/i.test(transportError.message))) {
      // This is a cancellation notification, never a retry of the originating tool.
      try { await networkRequest(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'Client cancelled or timed out' } }), signal: new AbortController().signal, deadlineMs: 1000, maxResponseBytes: 16000 }, config.network); } catch { /* Best effort only; preserve the original error. */ }
    }
  }
}
