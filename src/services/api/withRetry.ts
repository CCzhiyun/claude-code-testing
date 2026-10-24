import { isRetryableApiError } from './errorUtils.js';
import { ApiRateLimitError } from './errors.js';
import { abortableDelay } from '../../modelRetry.js';

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: { attempts?: number; baseDelayMs?: number; signal?: AbortSignal; maxWaitMs?: number } = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 21) throw new Error('Retry attempts must be between 1 and 21');
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted();
    try { return await operation(attempt); }
    catch (error) {
      if (attempt >= attempts || !isRetryableApiError(error)) throw error;
      const delay = Math.max(error instanceof ApiRateLimitError ? error.retryAfterMs ?? 0 : 0, Math.min(32_000, (options.baseDelayMs ?? 500) * 2 ** (attempt - 1)));
      if (!Number.isFinite(delay) || waited + delay > (options.maxWaitMs ?? 120_000)) throw new Error('Required retry delay exceeds wait budget; retry later', { cause: error });
      await abortableDelay(delay, options.signal); waited += delay;
    }
  }
}
