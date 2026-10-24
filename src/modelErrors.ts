import { AsyncLocalStorage } from 'node:async_hooks';

export interface ModelDiagnostic { message: string; code?: string; param?: string; requestId?: string }
/** Typed at the model boundary only; never inferred from tool output. */
export class ModelBoundaryError extends Error {
  constructor(readonly category:'authentication_failed'|'network_error'|'tls_error'|'timeout'|'invalid_response'|'cancelled',message:string,readonly code?:string,cause?:unknown){super(redactModelDiagnostic(message),{cause});this.name='ModelBoundaryError';}
}
export function modelBoundaryFailure(error:unknown,stage:'credential'|'transport',cancelled=false):Error {
  if(error instanceof ModelRequestError||error instanceof ContextLimitError||error instanceof ModelBoundaryError)return error;
  let code='';for(let value=error,depth=0;value instanceof Error&&depth<8;depth++,value=value.cause){const candidate=(value as NodeJS.ErrnoException).code;if(candidate){code=String(candidate);break;}}
  const message=error instanceof Error?error.message:String(error);
  const category=cancelled?'cancelled':stage==='credential'?'authentication_failed':/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(code)?'tls_error':/ETIMEDOUT|ESOCKETTIMEDOUT/.test(code)||/^Network request (?:timed out|deadline exceeded)$/.test(message)?'timeout':/ECONN|ENOTFOUND|EAI_AGAIN|EPIPE|EHOST|ENET/.test(code)||/^Network response aborted$/.test(message)?'network_error':'invalid_response';
  return new ModelBoundaryError(category,message,code||undefined,error);
}
const diagnosticSecrets = new AsyncLocalStorage<string[]>();
export function withModelDiagnosticSecrets<T>(secrets: string[], action: () => T): T { return diagnosticSecrets.run(secrets, action); }

/** Some runtimes produce a stack without its Error message. Never let that
 * discard the provider's sanitized code/param/request-id diagnostic. */
export function formatErrorDiagnostic(error:unknown):string{
  if(!(error instanceof Error))return redactModelDiagnostic(String(error),16000,true);
  const label=`${error.name||'Error'}: ${error.message}`,stack=typeof error.stack==='string'?error.stack:'';
  return redactModelDiagnostic(error.message&&stack.includes(error.message)?stack:`${label}${stack?'\n'+stack:''}`,16000,true);
}

/** Allowlisted diagnostic fields only; never retain the complete provider payload. */
export function redactModelDiagnostic(value: string, limit=2000, preserveFormatting=false): string {
  let text = value;
  const secrets = [...(diagnosticSecrets.getStore() ?? []), ...Object.entries(process.env).filter(([name]) => /secret|token|password|credential|api.?key/i.test(name)).map(([, secret]) => secret ?? '')];
  for (const secret of secrets.filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]');
  }
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[private key redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => { try { const url = new URL(raw); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } catch { return '[URL redacted]'; } })
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]')
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret|cookie)["']?\s*[:=]\s*)["']?[^\s,;"'}]+["']?/gi, '$1[redacted]')
    .replace(preserveFormatting?/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g:/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, Math.min(64000,Math.max(1,limit)));
}

/** Structured failures: recovery must never infer a retry from arbitrary tool text. */
export class ContextLimitError extends Error {
  constructor(message: string, readonly source: 'local' | 'provider', readonly windowHint?: number, readonly diagnostics?: ModelDiagnostic) {
    super(message); this.name = 'ContextLimitError';
  }
}

export class ModelRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfterMs?: number, readonly retryable?: boolean, readonly rejectedBeforeGeneration = false, readonly diagnostics?: ModelDiagnostic) {
    super(message); this.name = 'ModelRequestError';
  }
}

/** Context exhaustion is resumable conversation state, not a terminal task failure. */
export function isContextLimitFailure(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof ContextLimitError) return true;
    current = current.cause;
  }
  return false;
}

export function retryAfterDelay(headers: Record<string, string | string[] | undefined>, now = Date.now()): number | undefined {
  const value = (name: string): string | undefined => { const raw = headers[name]; return Array.isArray(raw) ? raw[0] : raw; };
  const milliseconds = value('retry-after-ms') ?? value('x-ms-retry-after-ms');
  if (milliseconds !== undefined && /^\d+(?:\.\d+)?$/.test(milliseconds.trim()) && Number.isFinite(Number(milliseconds))) return Number(milliseconds);
  const seconds = value('retry-after');
  if (seconds === undefined) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(seconds.trim()) && Number.isFinite(Number(seconds))) return Number(seconds) * 1000;
  const date = Date.parse(seconds);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function modelRequestError(status: number, body: unknown, headers: Record<string, string | string[] | undefined> = {}, embedded = false): Error {
  let value: unknown = body;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Plain gateway error. */ } }
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
  const envelope = object(value);
  const rawError = envelope.error ?? value;
  let details = object(rawError);
  // Gateways can wrap an upstream JSON error as a string or another error object.
  // Walk only known envelopes, bounded, never stringify an arbitrary response body.
  let nested:unknown=rawError;
  for(let depth=0;depth<4;depth++){
    if(typeof nested==='string'){try{nested=JSON.parse(nested);}catch{break;}}
    const item=object(nested);if(!Object.keys(item).length)break;
    details={...details,...item};
    if(item.error===undefined)break;nested=item.error;
  }
  const field = (v: unknown): string | undefined => typeof v === 'string' || typeof v === 'number' ? redactModelDiagnostic(String(v)) : undefined;
  const message = field(details.message) ?? field(details.detail) ?? field(details.title) ?? field(nested) ?? field(rawError) ?? 'Provider rejected the request (no supported error message field was returned)';
  const code = field(details.code ?? envelope.code ?? details.type) ?? '';
  const param = field(details.param ?? envelope.param);
  const header = (...names: string[]): unknown => Object.entries(headers).find(([key]) => names.includes(key.toLowerCase()))?.[1];
  const rawId = header('x-request-id', 'request-id', 'apim-request-id', 'x-ms-request-id') ?? envelope.request_id ?? details.request_id;
  const requestId = field(Array.isArray(rawId) ? rawId[0] : rawId);
  const diagnostics: ModelDiagnostic = { message, ...(code ? { code } : {}), ...(param ? { param } : {}), ...(requestId ? { requestId } : {}) };
  // Preserve real HTTP status. For an error inside HTTP 200 SSE, use its explicit status when present.
  const embeddedStatus = Number(details.status ?? details.status_code ?? envelope.status_code ?? envelope.status);
  if (embedded && Number.isInteger(embeddedStatus) && embeddedStatus >= 400 && embeddedStatus <= 599) status = embeddedStatus;
  const quotaCode = String(object(details.details).error_code ?? code);
  const quota = /^(insufficient_quota|billing_hard_limit_reached|enforced_spend_limit_reached|usage_limit_reached)$/i.test(quotaCode) || /credit balance is too low|reached your (?:specified (?:workspace )?API )?usage limits|exceeded your current quota/i.test(message);
  const metadata = [code && `code=${code}`, param && `param=${param}`, requestId && `request-id=${requestId}`].filter(Boolean).join('; ');
  const compatibilityHint=status===400&&/reasoning_effort/i.test(`${param??''} ${message}`)&&/function tools|tool.*reasoning|reasoning.*tool/i.test(message)
    ? '\nDeployment compatibility: for this Chat deployment configure model.chatToolReasoning="none" if permitted, or select the separately configured native Responses deployment. No automatic endpoint/credential switch or request replay was performed.' : '';
  const label = `Model request failed (${status}): ${message}${metadata ? ` [${metadata}]` : ''}${compatibilityHint}`;
  const contextCode = /^(context_length_exceeded|context_window_exceeded|prompt_too_long|input_too_long|too_many_tokens)$/i.test(code);
  const contextText = /maximum context length|context (?:window|length).*(?:exceed|limit)|(?:prompt|input) is too long|too many (?:input )?tokens/i.test(message);
  const genericInputCode = !code || /^(invalid_request_error|invalid_request|bad_request)$/i.test(code);
  if ([400, 413, 422].includes(status) && (contextCode || (genericInputCode && contextText))) {
    // Accept explicit window limits only. Never mistake requested/input token counts for capacity.
    const match = message.match(/maximum context length (?:is|of)\s*([\d,]+)\s*tokens/i)
      ?? message.match(/(?:context window|context length)\s*(?:limit)?\s*(?:is|of|:)\s*([\d,]+)\s*tokens/i);
    const hint = match ? Number(match[1]!.replaceAll(',', '')) : undefined;
    return new ContextLimitError(label, 'provider', hint && Number.isSafeInteger(hint) && hint >= 256 ? hint : undefined, diagnostics);
  }
  const capacityStatus = quota || code === 'rate_limit_error' ? 429 : code === 'overloaded_error' ? 529 : status;
  const shouldRetry = headers['x-should-retry'];
  return new ModelRequestError(label, capacityStatus, code || undefined, retryAfterDelay(headers), !quota && shouldRetry !== 'false' && [429, 502, 503, 529].includes(capacityStatus), status === 429, diagnostics);
}
