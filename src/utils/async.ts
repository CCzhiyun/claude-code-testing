export interface Deferred<T> { promise: Promise<T>; resolve(value: T | PromiseLike<T>): void; reject(reason?: unknown): void }
export function withResolvers<T>(): Deferred<T> { let resolve!: Deferred<T>['resolve']; let reject!: Deferred<T>['reject']; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export function abortError(reason = 'Operation aborted'): Error { const error = new Error(reason); error.name = 'AbortError'; return error; }
export function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError(String(signal?.reason ?? 'Operation aborted')); }
export function combinedAbortSignal(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return new AbortController().signal;
  if (active.some((signal) => signal.aborted)) return AbortSignal.abort(active.find((signal) => signal.aborted)?.reason);
  return AbortSignal.any(active);
}
export async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal); if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Sleep duration must be a non-negative number');
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, milliseconds); const abort = (): void => { clearTimeout(timer); reject(signal?.reason instanceof Error ? signal.reason : abortError()); }; signal?.addEventListener('abort', abort, { once: true }); });
}
export async function sequential<T, R>(items: readonly T[], operation: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> { const output: R[] = []; for (const [index, item] of items.entries()) { throwIfAborted(signal); output.push(await operation(item, index)); } return output; }
export async function withTimeout<T>(operation: Promise<T>, milliseconds: number, message = 'Operation timed out'): Promise<T> { const controller = new AbortController(); const timeout = sleep(milliseconds, controller.signal).then(() => { throw new Error(message); }); try { return await Promise.race([operation, timeout]); } finally { controller.abort(); } }

export class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = []; readonly #waiters: Array<Deferred<IteratorResult<T>>> = []; #closed = false;
  push(value: T): void { if (this.#closed) throw new Error('Queue is closed'); const waiter = this.#waiters.shift(); if (waiter) waiter.resolve({ value, done: false }); else this.#values.push(value); }
  close(): void { this.#closed = true; while (this.#waiters.length) this.#waiters.shift()?.resolve({ value: undefined, done: true }); }
  async next(): Promise<IteratorResult<T>> { const value = this.#values.shift(); if (value !== undefined) return { value, done: false }; if (this.#closed) return { value: undefined, done: true }; const waiter = withResolvers<IteratorResult<T>>(); this.#waiters.push(waiter); return waiter.promise; }
  [Symbol.asyncIterator](): AsyncIterator<T> { return this; }
}
