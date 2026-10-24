import { abortError, throwIfAborted, withResolvers, type Deferred } from './async.js';

export type Cleanup = () => void | Promise<void>;

export class CleanupRegistry {
  readonly #cleanups: Cleanup[] = [];
  #closed = false;

  add(cleanup: Cleanup): () => void {
    if (this.#closed) throw new Error('CleanupRegistry is closed');
    this.#cleanups.push(cleanup);
    return () => { const index = this.#cleanups.indexOf(cleanup); if (index >= 0) this.#cleanups.splice(index, 1); };
  }

  async run(): Promise<unknown[]> {
    if (this.#closed) return [];
    this.#closed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.#cleanups.splice(0).reverse()) try { await cleanup(); } catch (error) { errors.push(error); }
    return errors;
  }

  get size(): number { return this.#cleanups.length; }
}

export interface ActivitySnapshot { active: number; lastStartedAt?: number; lastFinishedAt?: number; idle: boolean }

export class ActivityManager {
  #active = 0;
  #lastStartedAt?: number;
  #lastFinishedAt?: number;

  start(now = Date.now()): () => void {
    this.#active += 1;
    this.#lastStartedAt = now;
    let finished = false;
    return () => { if (finished) return; finished = true; this.#active = Math.max(0, this.#active - 1); this.#lastFinishedAt = Date.now(); };
  }

  snapshot(): ActivitySnapshot { return { active: this.#active, ...(this.#lastStartedAt === undefined ? {} : { lastStartedAt: this.#lastStartedAt }), ...(this.#lastFinishedAt === undefined ? {} : { lastFinishedAt: this.#lastFinishedAt }), idle: this.#active === 0 }; }
}

export class QueryGuard {
  readonly #running = new Map<string, AbortController>();

  enter(key: string, options: { replace?: boolean; parent?: AbortSignal } = {}): AbortSignal {
    const existing = this.#running.get(key);
    if (existing && !options.replace) throw new Error(`Query already running: ${key}`);
    existing?.abort(abortError(`Query replaced: ${key}`));
    const controller = new AbortController();
    const abort = (): void => controller.abort(options.parent?.reason);
    options.parent?.addEventListener('abort', abort, { once: true });
    this.#running.set(key, controller);
    return controller.signal;
  }

  leave(key: string, signal?: AbortSignal): void { const current = this.#running.get(key); if (!current || (signal && current.signal !== signal)) return; this.#running.delete(key); }
  cancel(key: string, reason = `Query cancelled: ${key}`): boolean { const current = this.#running.get(key); if (!current) return false; current.abort(abortError(reason)); this.#running.delete(key); return true; }
  cancelAll(reason = 'All queries cancelled'): void { for (const controller of this.#running.values()) controller.abort(abortError(reason)); this.#running.clear(); }
  has(key: string): boolean { return this.#running.has(key); }
}

export class QueueProcessor<T, R> {
  readonly #items: Array<{ value: T; result: Deferred<R> }> = [];
  #running = false;
  #closed = false;

  constructor(readonly operation: (value: T, signal: AbortSignal) => Promise<R>, readonly signal = new AbortController().signal) {}

  enqueue(value: T): Promise<R> {
    if (this.#closed) return Promise.reject(new Error('QueueProcessor is closed'));
    const result = withResolvers<R>();
    this.#items.push({ value, result });
    void this.#drain();
    return result.promise;
  }

  close(reason = new Error('QueueProcessor closed')): void { this.#closed = true; while (this.#items.length) this.#items.shift()?.result.reject(reason); }
  get pending(): number { return this.#items.length + (this.#running ? 1 : 0); }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (!this.#closed && this.#items.length) {
        const item = this.#items.shift()!;
        try { throwIfAborted(this.signal); item.result.resolve(await this.operation(item.value, this.signal)); }
        catch (error) { item.result.reject(error); }
      }
    } finally { this.#running = false; }
  }
}

export class BufferedWriter {
  #buffer = '';
  #timer: ReturnType<typeof setTimeout> | undefined;
  #chain = Promise.resolve();

  constructor(readonly write: (content: string) => void | Promise<void>, readonly options: { maximum?: number; interval?: number } = {}) {}

  append(content: string): void {
    this.#buffer += content;
    if (this.#buffer.length >= (this.options.maximum ?? 16_384)) void this.flush();
    else if (!this.#timer) this.#timer = setTimeout(() => { this.#timer = undefined; void this.flush(); }, this.options.interval ?? 25);
  }

  async flush(): Promise<void> {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    const content = this.#buffer;
    this.#buffer = '';
    if (!content) return this.#chain;
    this.#chain = this.#chain.then(() => this.write(content));
    await this.#chain;
  }
}

export class IdleTimeout {
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly milliseconds: number, readonly onIdle: () => void) { if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Idle timeout must be non-negative'); }
  touch(): void { this.stop(); this.#timer = setTimeout(this.onIdle, this.milliseconds); }
  stop(): void { if (this.#timer) clearTimeout(this.#timer); this.#timer = undefined; }
}

export async function collectAsync<T>(source: AsyncIterable<T>, signal?: AbortSignal): Promise<T[]> { const output: T[] = []; for await (const value of source) { throwIfAborted(signal); output.push(value); } return output; }

export async function* mapAsync<T, R>(source: AsyncIterable<T>, mapper: (value: T, index: number) => R | Promise<R>, signal?: AbortSignal): AsyncGenerator<R> { let index = 0; for await (const value of source) { throwIfAborted(signal); yield await mapper(value, index++); } }
