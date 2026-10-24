import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { executionSignal } from './executionControl.js';
import { ModelRequestError } from './modelErrors.js';
import { modelAuthHeaders, resolveModelEndpoint } from './modelConnection.js';
import { estimateContextInput } from './contextBudget.js';
import {preparedProviderInput} from './inputTokenCounting.js';
import type { PlatformConfig, ModelMessage, ToolDefinition } from './types.js';
import type { ModelResponse, ModelStreamHandlers } from './model.js';

export interface ModelRetryPolicy { maxRetries?: number; maxWaitMs?: number; baseDelayMs?: number; requestsPerMinute?: number; tokensPerMinute?: number }
export interface RetryNotice { attempt: number; maxRetries: number; delayMs: number; reason: string }
export class ModelWaitError extends Error {
  constructor(message: string, cause?: unknown) { super(message, { cause }); this.name = 'ModelWaitError'; }
}
export function isModelWaitFailure(error: unknown): boolean {
  for (let depth = 0; depth < 8 && error instanceof Error; depth++, error = error.cause) if (error instanceof ModelWaitError) return true;
  return false;
}
export function validateModelRetry(policy: ModelRetryPolicy | undefined): void {
  if (policy === undefined) return;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('modelRetry must be an object');
  for (const key of ['maxRetries', 'maxWaitMs', 'baseDelayMs', 'requestsPerMinute', 'tokensPerMinute'] as const) {
    const value = policy[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (key === 'maxRetries' ? 0 : 1))) throw new Error(`modelRetry.${key} is invalid`);
  }
  if ((policy.maxRetries ?? 3) > 20 || (policy.maxWaitMs ?? 120_000) > 3_600_000) throw new Error('modelRetry is bounded to 20 retries and 1 hour of waiting per request');
}

export async function abortableDelay(delay: number, signal = executionSignal()): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = (): void => { cleanup(); reject(new Error('Model wait cancelled')); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function rateSlot(config: PlatformConfig, tokens: number): Promise<number> {
  const policy = config.modelRetry;
  if (!policy?.requestsPerMinute && !policy?.tokensPerMinute) return 0;
  if (policy.tokensPerMinute && tokens > policy.tokensPerMinute) throw new ModelWaitError(`This request needs ~${tokens} input + output-reserve tokens, above the configured TPM ${policy.tokensPerMinute}. Waiting cannot fit a single oversized request. Reduce input/maxOutputTokens or raise the actual deployment quota; the conversation remains available.`);
  // Raw credentials and endpoint query values are never written to the shared file.
  const key = createHash('sha256').update(JSON.stringify([resolveModelEndpoint(config.model), config.model.name, modelAuthHeaders(config.model)])).digest('hex');
  const path = join(homeStateDir(), 'rate-limits', `${key}.json`);
  return withFileLock(`${path}.lock`, async () => {
    const now = Date.now();
    const slots = (await readJson<Array<{ at: number; tokens: number }>>(path, [])).filter((slot) => now - slot.at < 60_000);
    let wait = 0;
    if (policy.requestsPerMinute && slots.length >= policy.requestsPerMinute) wait = Math.max(wait, slots[slots.length - policy.requestsPerMinute]!.at + 60_000 - now);
    if (policy.tokensPerMinute) {
      let total = slots.reduce((sum, slot) => sum + slot.tokens, tokens);
      for (const slot of slots) { if (total <= policy.tokensPerMinute) break; total -= slot.tokens; wait = Math.max(wait, slot.at + 60_000 - now); }
    }
    if (wait > 0) return wait;
    slots.push({ at: now, tokens }); await writeJson(path, slots);
    return 0;
  });
}

export async function withModelRetry(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], stream: ModelStreamHandlers | undefined, operation: (stream?: ModelStreamHandlers) => Promise<ModelResponse>): Promise<ModelResponse> {
  const policy = config.modelRetry ?? {}; validateModelRetry(policy);
  const maxRetries = policy.maxRetries ?? 3, maxWait = policy.maxWaitMs ?? 120_000;
  let waited = 0, emitted = false;
  const wrapped = stream ? { ...stream, onTextDelta(delta: string) { if (delta) emitted = true; stream.onTextDelta?.(delta); }, onThinkingDelta(delta: string) { if (delta) emitted = true; stream.onThinkingDelta?.(delta); } } : undefined;
  const wait = async (delayMs: number, attempt: number, reason: string): Promise<void> => {
    // Never shorten Retry-After: if it exceeds our wait budget, pause for the user.
    if (!Number.isFinite(delayMs) || waited + delayMs > maxWait) throw new ModelWaitError(`${reason}; retry requires ${Math.ceil(delayMs / 1000)}s, beyond this request's configured wait budget. Continue later; the session is preserved.`);
    stream?.onRetry?.({ attempt, maxRetries, delayMs, reason });
    await abortableDelay(delayMs); waited += delayMs;
  };
  const tokens = (preparedProviderInput(config,system,messages,tools)??estimateContextInput(system, messages, tools,config.model)) + config.model.maxOutputTokens;
  for (let attempt = 0; ; attempt++) {
    executionSignal()?.throwIfAborted();
    for (;;) { const delay = await rateSlot(config, tokens); if (!delay) break; await wait(delay, attempt, 'Local RPM/TPM pacing'); }
    try { return await operation(wrapped); }
    catch (error) {
      if (!(error instanceof ModelRequestError) || ![429, 502, 503, 529].includes(error.status)) throw error;
      if (!error.retryable || emitted || attempt >= maxRetries) throw new ModelWaitError(emitted ? 'The stream was interrupted after partial output. It was not replayed automatically; continue this session explicitly.' : `Model capacity/quota requires attention after ${attempt + 1} attempt(s). ${error.message}`, error);
      const backoff = Math.min(32_000, (policy.baseDelayMs ?? 500) * 2 ** attempt) * (1 + Math.random() * 0.25);
      await wait(Math.max(error.retryAfterMs ?? 0, backoff), attempt + 1, `Model HTTP ${error.status}; waiting before retry`);
    }
  }
}
