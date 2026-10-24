import { watchLocalState } from './localStateWatch.js';

/** Coalesce invalidations while busy. Never discard a change just because a
 * dialog/model turn is active; failed loads wait for a new change/manual retry. */
export class DeferredStateReload {
  #dirty = false;
  #stopped = false;
  #active: Promise<void> | undefined;
  #stop: (() => void) | undefined;
  #key = '';
  constructor(private readonly options: { busy: () => boolean; reload: () => Promise<void>; onError: () => void; intervalMs?: number }) {}
  get reloading(): boolean { return !!this.#active; }
  invalidate(): void { if (!this.#stopped) this.#dirty = true; }
  setPaths(paths: readonly string[]): void {
    const unique = [...new Set(paths)].sort(), key = JSON.stringify(unique);
    if (this.#stopped || key === this.#key) return;
    // Construct before removing the old subscription: invalid bounds keep it intact.
    const next = watchLocalState(unique, () => this.invalidate(), { recursive: true, initial: true, ...(this.options.intervalMs ? { intervalMs: this.options.intervalMs } : {}), onError: this.options.onError });
    this.#stop?.(); this.#stop = next; this.#key = key;
  }
  flush(): Promise<void> {
    if (this.#active) return this.#active;
    if (this.#stopped || !this.#dirty || this.options.busy()) return Promise.resolve();
    this.#dirty = false;
    this.#active = Promise.resolve().then(() => {
      if (this.#stopped || this.options.busy()) { this.#dirty = !this.#stopped; return; }
      return this.options.reload();
    }).catch(() => { if (!this.#stopped) this.options.onError(); }).finally(() => { this.#active = undefined; });
    return this.#active;
  }
  async settled(): Promise<void> { await this.#active; }
  dispose(): void { this.#stopped = true; this.#dirty = false; this.#stop?.(); }
}
