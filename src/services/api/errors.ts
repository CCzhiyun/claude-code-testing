export class ApiError extends Error { constructor(message: string, readonly status: number, readonly body?: unknown, options?: ErrorOptions) { super(message, options); this.name = 'ApiError'; } }
export class ApiRateLimitError extends ApiError { constructor(message: string, readonly retryAfterMs?: number, body?: unknown) { super(message, 429, body); this.name = 'ApiRateLimitError'; } }
export class ApiAuthenticationError extends ApiError { constructor(message = 'API authentication failed') { super(message, 401); this.name = 'ApiAuthenticationError'; } }
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt exceeds the configured context window';
