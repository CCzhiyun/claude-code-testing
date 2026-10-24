import { ContextLimitError, ModelRequestError, ModelBoundaryError, redactModelDiagnostic } from './modelErrors.js';

/** Only structured provider failures qualify, never an arbitrary tool error. */
export function stopFailurePayload(error: unknown): Record<string, string> | undefined {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++, current = current.cause) {
    if(current instanceof ModelBoundaryError){if(current.category==='cancelled')return undefined;const detail=redactModelDiagnostic(current.message);return {error:current.category,error_details:detail,last_assistant_message:detail,...(current.code?{error_code:redactModelDiagnostic(current.code)}:{})};}
    if (!(current instanceof ModelRequestError) && !(current instanceof ContextLimitError && current.source === 'provider')) continue;
    const status = current instanceof ModelRequestError ? current.status : 400;
    const code = current instanceof ModelRequestError ? current.code ?? '' : 'context_length_exceeded';
    const category = /billing|insufficient_quota|credit/i.test(code) ? 'billing_error'
      : /max_output/i.test(code) ? 'max_output_tokens'
      : status === 401 || status === 403 ? 'authentication_failed'
      : status === 404 ? 'model_not_found' : status === 429 ? 'rate_limit'
      : status === 529 || /overloaded/i.test(code) ? 'overloaded'
      : status >= 500 ? 'server_error' : status >= 400 ? 'invalid_request' : 'unknown';
    const detail = redactModelDiagnostic(current.message);
    return { error: category, error_details: detail, last_assistant_message: detail };
  }
  return undefined;
}
