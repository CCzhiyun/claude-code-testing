import { interactionTrace, traceMcpReply } from './mcpInteractionAudit.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import {parseModernSampling,parseModernSamplingResult,type McpModernSamplingRequest,type McpModernSamplingResult} from './mcpSamplingModern.js';
const interactionDepth = new AsyncLocalStorage<number>();
/** Explicit runtime callbacks, never settings, stored grants or model-produced approvals. */
export interface McpSamplingRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
  maxTokens: number;
  systemPrompt?: string;
}
export interface McpSamplingResult { role: 'assistant'; content: { type: 'text'; text: string }; model: string; stopReason?: 'endTurn' | 'maxTokens' | 'stopSequence' }
export interface McpElicitationRequest { message: string; requestedSchema: { type: 'object'; properties: Record<string, Record<string, unknown>>; required?: string[] } }
export interface McpElicitationResult { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean> }
export interface McpUrlElicitation {mode:'url';url:string;elicitationId:string;message:string}
export interface McpMediaContent {type:'image'|'audio';data:string;mimeType:string}
export interface McpMultimodalSamplingRequest {messages:Array<{role:'user'|'assistant';content:{type:'text';text:string}|McpMediaContent}>;maxTokens:number;systemPrompt?:string}
export interface McpMultimodalSamplingResult {role:'assistant';content:{type:'text';text:string}|McpMediaContent;model:string;stopReason?:'endTurn'|'maxTokens'|'stopSequence'}
export interface McpInteractionHandlers {
  timeoutMs?: number;
  confirmSampling?: (request: McpSamplingRequest, signal: AbortSignal) => Promise<boolean>;
  sample?: (request: McpSamplingRequest, signal: AbortSignal) => Promise<McpSamplingResult>;
  confirmSamplingResult?: (result: McpSamplingResult, request: McpSamplingRequest, signal: AbortSignal) => Promise<boolean>;
  elicit?: (request: McpElicitationRequest, signal: AbortSignal) => Promise<McpElicitationResult>;
  /** URL consent is out-of-band, never a credential submission or proof of completion. */
  urlOrigins?: string[];
  elicitUrl?: (request:McpUrlElicitation,signal:AbortSignal)=>Promise<{action:'accept'|'decline'|'cancel'}>;
  confirmMultimodalSampling?:(request:McpMultimodalSamplingRequest,signal:AbortSignal)=>Promise<boolean>;
  sampleMultimodal?:(request:McpMultimodalSamplingRequest,signal:AbortSignal)=>Promise<McpMultimodalSamplingResult>;
  confirmMultimodalSamplingResult?:(result:McpMultimodalSamplingResult,request:McpMultimodalSamplingRequest,signal:AbortSignal)=>Promise<boolean>;
  /** Explicit SDK callbacks; never execute server tools on the client's behalf. */
  samplingTools?: boolean;
  confirmModernSampling?: (request:McpModernSamplingRequest,signal:AbortSignal)=>Promise<boolean>;
  sampleModern?: (request:McpModernSamplingRequest,signal:AbortSignal)=>Promise<McpModernSamplingResult>;
  confirmModernSamplingResult?: (result:McpModernSamplingResult,request:McpModernSamplingRequest,signal:AbortSignal)=>Promise<boolean>;
  /** Informational only. Completion is not an approval or permission to replay a tool. */
  onUrlElicitationComplete?: (elicitationId:string)=>void;
}
/** One per negotiated transport session; no global cross-server ID association. */
export class McpInteractionSession {
  readonly #urls=new Map<string,'pending'|'accepted'|'complete'>();
  reserve(id:string):void { if(this.#urls.has(id)||this.#urls.size>=128)throw new InvalidInteraction('Duplicate or excessive URL elicitation ID');this.#urls.set(id,'pending'); }
  accept(id:string):void { if(this.#urls.get(id)!=='pending')throw new InvalidInteraction('Unknown URL consent');this.#urls.set(id,'accepted'); }
  notification(method:string,params:unknown,handlers?:McpInteractionHandlers):boolean {
    if(method!=='notifications/elicitation/complete')return true;
    if(!record(params)||typeof params.elicitationId!=='string'||this.#urls.get(params.elicitationId)!=='accepted')return false;
    this.#urls.set(params.elicitationId,'complete');
    const returned:unknown=handlers?.onUrlElicitationComplete?.(params.elicitationId);
    if(returned&&typeof(returned as PromiseLike<unknown>).then==='function'){Promise.resolve(returned).catch(()=>{});throw new Error('MCP completion callback must be synchronous');}
    return true;
  }
}
export type McpInteractionOutcome = { result: unknown } | { error: { code: number; message: string } };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const safeName = (value: string) => /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const sensitive = /password|passwd|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret|private[ _-]?key|credit[ _-]?card|payment|ssn|密码|密钥|令牌|银行卡|信用卡/i;
class InvalidInteraction extends Error {}
function requireValue(condition: unknown): asserts condition { if (!condition) throw new InvalidInteraction('Unsupported or invalid MCP interaction parameters'); }

export function mcpInteractionCapabilities(handlers?: McpInteractionHandlers): Record<string, unknown> {
  if (handlers?.timeoutMs !== undefined && (!Number.isSafeInteger(handlers.timeoutMs) || handlers.timeoutMs < 1 || handlers.timeoutMs > 120000)) throw new Error('MCP interaction timeout must be 1–120000 ms');
  return {
    ...(handlers?.confirmSampling && handlers.sample && handlers.confirmSamplingResult || handlers?.confirmMultimodalSampling&&handlers.sampleMultimodal&&handlers.confirmMultimodalSamplingResult || handlers?.confirmModernSampling&&handlers.sampleModern&&handlers.confirmModernSamplingResult ? { sampling: handlers?.samplingTools&&handlers.confirmModernSampling&&handlers.sampleModern&&handlers.confirmModernSamplingResult?{tools:{}}:{} } : {}),
    ...(handlers?.elicitUrl ? {elicitation:{...(handlers.elicit?{form:{}}:{}),url:{}}} : handlers?.elicit ? { elicitation: {} } : {}),
  };
}
export function mcpInteractionProtocol(handlers?:McpInteractionHandlers){return handlers?.elicitUrl||handlers?.sampleMultimodal||handlers?.sampleModern?'2025-11-25':'2025-06-18';}
export function negotiatedMcpHandlers(handlers:McpInteractionHandlers|undefined,protocol:string):McpInteractionHandlers|undefined{
 if(protocol==='2025-11-25')return handlers;
 if(protocol!=='2025-06-18'||!handlers)return undefined;
 // Keep the caller's live approval/revocation callbacks. A spread snapshot would
 // retain a formerly approving callback after it was revoked during a session.
 // The protocol mask is permanent even if new callbacks are installed later.
 const disabled=new Set<PropertyKey>(['elicitUrl','urlOrigins','onUrlElicitationComplete','confirmMultimodalSampling','sampleMultimodal','confirmMultimodalSamplingResult','samplingTools','confirmModernSampling','sampleModern','confirmModernSamplingResult']);
 return new Proxy({} as McpInteractionHandlers,{get:(_target,key)=>disabled.has(key)?undefined:Reflect.get(handlers,key),has:(_target,key)=>!disabled.has(key)&&Reflect.has(handlers,key)});
}
export function validateMcpUrlElicitation(value:unknown,origins:string[]|undefined):McpUrlElicitation{
 requireValue(record(value)&&value.mode==='url'&&typeof value.url==='string'&&value.url.length<=2048&&!/[\x00-\x20\x7f-\x9f]/.test(value.url)&&typeof value.message==='string'&&value.message.length<=8000&&typeof value.elicitationId==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(value.elicitationId)&&value.requestedSchema===undefined);
 const url=new URL(value.url);requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&url.href===value.url&&Array.isArray(origins)&&origins.length>0&&origins.length<=32&&origins.every(origin=>{try{const parsed=new URL(origin);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&origin===parsed.origin;}catch{return false;}})&&origins.includes(url.origin));
 return {mode:'url',url:url.href,elicitationId:value.elicitationId,message:value.message};
}
function media(value:unknown):McpMediaContent{
 requireValue(record(value)&&['image','audio'].includes(String(value.type))&&typeof value.data==='string'&&value.data.length>0&&value.data.length<=700000&&typeof value.mimeType==='string');
 requireValue(value.type==='image'?['image/png','image/jpeg','image/gif','image/webp'].includes(value.mimeType):['audio/wav','audio/mpeg','audio/ogg','audio/flac'].includes(value.mimeType));requireValue(/^[A-Za-z0-9+/]+={0,2}$/.test(value.data));const bytes=Buffer.from(value.data,'base64');requireValue(bytes.length<=512000&&bytes.toString('base64')===value.data);return {type:value.type as 'image'|'audio',data:value.data,mimeType:value.mimeType};
}
function multimodalParams(value:unknown):McpMultimodalSamplingRequest{
 requireValue(record(value)&&Array.isArray(value.messages)&&value.messages.length>0&&value.messages.length<=16&&value.tools===undefined&&value.toolChoice===undefined&&(value.includeContext===undefined||value.includeContext==='none')&&Number.isSafeInteger(value.maxTokens)&&Number(value.maxTokens)>0&&Number(value.maxTokens)<=2048&&(value.systemPrompt===undefined||typeof value.systemPrompt==='string'&&value.systemPrompt.length<=8000));
 const messages=value.messages.map(message=>{requireValue(record(message)&&['user','assistant'].includes(String(message.role))&&record(message.content));const content=message.content.type==='text'?(requireValue(typeof message.content.text==='string'&&message.content.text.length<=16000),{type:'text' as const,text:message.content.text}):media(message.content);return {role:message.role as 'user'|'assistant',content};});const request={messages,maxTokens:Number(value.maxTokens),...(typeof value.systemPrompt==='string'?{systemPrompt:value.systemPrompt}:{})};requireValue(Buffer.byteLength(JSON.stringify(request))<=750000);return request;
}
function samplingParams(value: unknown): McpSamplingRequest {
  requireValue(record(value) && Array.isArray(value.messages) && value.messages.length > 0 && value.messages.length <= 50);
  requireValue(value.tools === undefined && value.toolChoice === undefined && (value.includeContext === undefined || value.includeContext === 'none'));
  requireValue(Number.isSafeInteger(value.maxTokens) && Number(value.maxTokens) >= 1 && Number(value.maxTokens) <= 2048);
  requireValue(value.systemPrompt === undefined || typeof value.systemPrompt === 'string' && value.systemPrompt.length <= 8000);
  const messages = value.messages.map(message => {
    requireValue(record(message) && ['user', 'assistant'].includes(String(message.role)) && record(message.content) && message.content.type === 'text' && typeof message.content.text === 'string' && message.content.text.length <= 16000);
    return { role: message.role as 'user' | 'assistant', content: { type: 'text' as const, text: message.content.text as string } };
  });
  const request: McpSamplingRequest = { messages, maxTokens: Number(value.maxTokens), ...(typeof value.systemPrompt === 'string' ? { systemPrompt: value.systemPrompt } : {}) };
  requireValue(Buffer.byteLength(JSON.stringify(request)) <= 64000);
  return request;
}
function formParams(value: unknown): McpElicitationRequest {
  requireValue(record(value) && (value.mode === undefined || value.mode === 'form') && typeof value.message === 'string' && value.message.length <= 8000 && !sensitive.test(value.message));
  const schema = value.requestedSchema;
  requireValue(record(schema) && schema.type === 'object' && record(schema.properties) && Object.keys(schema.properties).length <= 32);
  requireValue(Object.keys(schema).every(key => ['type', 'properties', 'required', 'additionalProperties'].includes(key)));
  requireValue(schema.required === undefined || Array.isArray(schema.required) && schema.required.every(name => typeof name === 'string' && Object.hasOwn(schema.properties as object, name)));
  for (const [name, property] of Object.entries(schema.properties)) {
    requireValue(safeName(name) && !sensitive.test(name) && record(property) && ['string', 'number', 'integer', 'boolean'].includes(String(property.type)));
    requireValue(Object.keys(property).every(key => ['type', 'title', 'description', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'format', 'default'].includes(key)));
    for (const key of ['title', 'description']) requireValue(property[key] === undefined || typeof property[key] === 'string' && (property[key] as string).length <= 1000 && !sensitive.test(property[key] as string));
    for (const key of ['minLength', 'maxLength']) requireValue(property[key] === undefined || Number.isSafeInteger(property[key]) && Number(property[key]) >= 0 && Number(property[key]) <= 4096);
    for (const key of ['minimum', 'maximum']) requireValue(property[key] === undefined || typeof property[key] === 'number' && Number.isFinite(property[key]));
    requireValue(property.format === undefined || ['email', 'uri', 'date', 'date-time'].includes(String(property.format)));
    requireValue(property.enum === undefined || Array.isArray(property.enum) && property.enum.length > 0 && property.enum.length <= 32 && property.enum.every(item => typeof item === 'string' && item.length <= 256));
    requireValue(property.default === undefined || typeof property.default === 'string' && property.default.length <= 4096 || typeof property.default === 'number' && Number.isFinite(property.default) || typeof property.default === 'boolean');
    requireValue(property.minLength === undefined || property.maxLength === undefined || Number(property.minLength) <= Number(property.maxLength));
    requireValue(property.minimum === undefined || property.maximum === undefined || Number(property.minimum) <= Number(property.maximum));
  }
  requireValue(Buffer.byteLength(JSON.stringify(schema)) <= 64000);
  return structuredClone({ message: value.message, requestedSchema: schema }) as McpElicitationRequest;
}
function validateFormResult(request: McpElicitationRequest, result: unknown): McpElicitationResult {
  requireValue(record(result) && ['accept', 'decline', 'cancel'].includes(String(result.action)));
  if (result.action !== 'accept') return { action: result.action as 'decline' | 'cancel' };
  requireValue(record(result.content));
  for (const name of request.requestedSchema.required ?? []) requireValue(Object.hasOwn(result.content, name));
  for (const [name, value] of Object.entries(result.content)) {
    requireValue(Object.hasOwn(request.requestedSchema.properties, name));
    const property = request.requestedSchema.properties[name]!;
    requireValue(property.type === 'integer' ? Number.isSafeInteger(value) : typeof value === property.type);
    if (typeof value === 'number') requireValue(Number.isFinite(value) && (property.minimum === undefined || value >= Number(property.minimum)) && (property.maximum === undefined || value <= Number(property.maximum)));
    if (typeof value === 'string') {
      requireValue(value.length <= Math.min(4096, Number(property.maxLength ?? 4096)) && value.length >= Number(property.minLength ?? 0));
      if (property.format === 'email') requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
      if (property.format === 'uri') { try { const url = new URL(value); requireValue(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password); } catch { throw new InvalidInteraction(); } }
      if (property.format === 'date') requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
      if (property.format === 'date-time') requireValue(/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
    }
    if (property.enum) requireValue((property.enum as unknown[]).includes(value));
  }
  requireValue(Buffer.byteLength(JSON.stringify(result.content)) <= 16000);
  return { action: 'accept', content: structuredClone(result.content) as NonNullable<McpElicitationResult['content']> };
}
export async function handleMcpInteraction(method: string, params: unknown, handlers: McpInteractionHandlers | undefined, signal: AbortSignal,session?:McpInteractionSession): Promise<McpInteractionOutcome> {
  const depth=interactionDepth.getStore()??0;
  if(depth>=3){await interactionTrace(method).record('nesting-limit','denied');return {error:{code:-32000,message:'MCP interaction nesting limit exceeded'}};}
  return interactionDepth.run(depth+1,()=>handleInteraction(method,params,handlers,signal,session));
}
async function handleInteraction(method: string, params: unknown, handlers: McpInteractionHandlers | undefined, signal: AbortSignal,session?:McpInteractionSession): Promise<McpInteractionOutcome> {
  const trace = interactionTrace(method);
  const finish = async (value: McpInteractionOutcome): Promise<McpInteractionOutcome> => { await trace.record('result-authorized', 'result' in value ? 'allowed' : 'denied'); if ('result' in value) combined.throwIfAborted(); traceMcpReply(value, trace); return value; };
  const capabilities = mcpInteractionCapabilities(handlers);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), handlers?.timeoutMs ?? 60000);
  const combined = AbortSignal.any([signal, deadline.signal]);
  const abortable = async <T>(action: () => Promise<T>): Promise<T> => {
    combined.throwIfAborted();
    let listener: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { combined.throwIfAborted(); return action(); }), new Promise<never>((_, reject) => { listener = () => reject(new Error('MCP interaction cancelled or timed out')); combined.addEventListener('abort', listener, { once: true }); if (combined.aborted) listener(); })]); }
    finally { combined.removeEventListener('abort', listener); }
  };
  try {
    await trace.record('received', 'requested');
    if(method==='elicitation/create'&&record(params)&&params.mode==='url'){
      requireValue(handlers?.elicitUrl);const request=validateMcpUrlElicitation(params,handlers.urlOrigins);session?.reserve(request.elicitationId);await trace.record('url-consent','requested');
      const response=await abortable(()=>handlers.elicitUrl!(structuredClone(request),combined));requireValue(record(response)&&['accept','decline','cancel'].includes(response.action)&&Object.keys(response).every(k=>k==='action'));combined.throwIfAborted();
      const outcome=await finish({result:{action:response.action}});if(response.action==='accept')session?.accept(request.elicitationId);return outcome;
    }
    if(method==='sampling/createMessage'&&handlers?.confirmModernSampling&&handlers.sampleModern&&handlers.confirmModernSamplingResult){
      let request:McpModernSamplingRequest;try{request=parseModernSampling(params,handlers.samplingTools===true);}catch{throw new InvalidInteraction();}
      await trace.record('modern-request-approval','requested');if(await abortable(()=>handlers.confirmModernSampling!(structuredClone(request),combined))!==true)return await finish({error:{code:-1,message:'User declined sampling'}});
      await trace.record('modern-request-approved','allowed');combined.throwIfAborted();await trace.record('modern-model-started');const raw=await abortable(()=>handlers.sampleModern!(structuredClone(request),combined));let output:McpModernSamplingResult;try{output=parseModernSamplingResult(raw,request);}catch{throw new InvalidInteraction();}await trace.record('modern-model-completed');
      await trace.record('modern-share-approval','requested');if(await abortable(()=>handlers.confirmModernSamplingResult!(structuredClone(output),structuredClone(request),combined))!==true)return await finish({error:{code:-1,message:'User declined sharing sampled content'}});
      await trace.record('modern-share-approved','allowed');combined.throwIfAborted();return await finish({result:output});
    }
    if(method==='sampling/createMessage'&&record(params)&&Array.isArray(params.messages)&&params.messages.some(m=>record(m)&&record(m.content)&&m.content.type!=='text')){
      requireValue(handlers?.confirmMultimodalSampling&&handlers.sampleMultimodal&&handlers.confirmMultimodalSamplingResult);const request=multimodalParams(params);await trace.record('media-request-approval','requested');if(await abortable(()=>handlers.confirmMultimodalSampling!(structuredClone(request),combined))!==true)return await finish({error:{code:-1,message:'User declined multimodal sampling'}});
      await trace.record('media-model-started');const raw=await abortable(()=>handlers.sampleMultimodal!(structuredClone(request),combined));requireValue(record(raw)&&raw.role==='assistant'&&typeof raw.model==='string'&&raw.model.length<=256&&(raw.stopReason===undefined||['endTurn','maxTokens','stopSequence'].includes(raw.stopReason))&&record(raw.content));const content=raw.content.type==='text'?(requireValue(typeof raw.content.text==='string'&&raw.content.text.length<=32000),{type:'text' as const,text:raw.content.text}):media(raw.content);const output:McpMultimodalSamplingResult={role:'assistant',model:raw.model,content,...(raw.stopReason?{stopReason:raw.stopReason}:{})};await trace.record('media-share-approval','requested');if(await abortable(()=>handlers.confirmMultimodalSamplingResult!(structuredClone(output),structuredClone(request),combined))!==true)return await finish({error:{code:-1,message:'User declined sharing sampled content'}});combined.throwIfAborted();return await finish({result:output});
    }
    if (method === 'sampling/createMessage' && capabilities.sampling && handlers?.confirmSampling&&handlers.sample&&handlers.confirmSamplingResult) {
      const request = samplingParams(params);
      await trace.record('request-approval', 'requested');
      if (await abortable(() => handlers!.confirmSampling!(structuredClone(request), combined)) !== true) return await finish({ error: { code: -1, message: 'User declined sampling' } });
      await trace.record('request-approved', 'allowed');
      combined.throwIfAborted(); await trace.record('model-started');
      const result = await abortable(() => handlers!.sample!(structuredClone(request), combined));
      await trace.record('model-completed');
      requireValue(record(result) && result.role === 'assistant' && record(result.content) && result.content.type === 'text' && typeof result.content.text === 'string' && result.content.text.length <= 32000 && typeof result.model === 'string' && result.model.length <= 256);
      requireValue(result.stopReason === undefined || ['endTurn', 'maxTokens', 'stopSequence'].includes(result.stopReason));
      const output: McpSamplingResult = { role: 'assistant', content: { type: 'text', text: result.content.text }, model: result.model, ...(result.stopReason ? { stopReason: result.stopReason } : {}) };
      await trace.record('share-approval', 'requested');
      if (await abortable(() => handlers!.confirmSamplingResult!(structuredClone(output), structuredClone(request), combined)) !== true) return await finish({ error: { code: -1, message: 'User declined sharing sampled content' } });
      await trace.record('share-approved', 'allowed');
      combined.throwIfAborted(); return await finish({ result: output });
    }
    if (method === 'elicitation/create' && capabilities.elicitation && handlers?.elicit) {
      const request = formParams(params); await trace.record('form-review', 'requested');
      const result = await abortable(() => handlers!.elicit!(structuredClone(request), combined));
      combined.throwIfAborted(); const validated = validateFormResult(request, result);
      await trace.record(`form-${validated.action}`, validated.action === 'accept' ? 'allowed' : 'denied');
      return await finish({ result: validated });
    }
    if(method==='elicitation/create'&&capabilities.elicitation)throw new InvalidInteraction('Elicitation mode is not enabled');
    return await finish({ error: { code: -32601, message: 'Client capability is not enabled' } });
  } catch (error) {
    const value: McpInteractionOutcome = { error: { code: error instanceof InvalidInteraction ? -32602 : -32000, message: error instanceof InvalidInteraction ? 'Unsupported or invalid MCP interaction parameters' : 'MCP interaction cancelled, timed out, failed or could not be audited; no response content shared' } };
    try { await trace.record(signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'timed-out' : 'failed', 'failure'); traceMcpReply(value, trace); } catch { /* Audit failure never authorizes model use or sharing. */ }
    return value;
  } finally { clearTimeout(timer); }
}
