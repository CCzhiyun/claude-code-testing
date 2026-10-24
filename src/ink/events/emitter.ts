export type Listener<T> = (value: T) => void;
export class EventEmitter<Events extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();
  on<K extends keyof Events>(name: K, listener: Listener<Events[K]>): () => void { const listeners = this.#listeners.get(name) ?? new Set(); listeners.add(listener as Listener<never>); this.#listeners.set(name, listeners); return () => this.off(name, listener); }
  once<K extends keyof Events>(name: K, listener: Listener<Events[K]>): () => void { const dispose = this.on(name, (value) => { dispose(); listener(value); }); return dispose; }
  off<K extends keyof Events>(name: K, listener: Listener<Events[K]>): void { this.#listeners.get(name)?.delete(listener as Listener<never>); }
  emit<K extends keyof Events>(name: K, value: Events[K]): void { for (const listener of [...(this.#listeners.get(name) ?? [])]) listener(value as never); }
  clear(name?: keyof Events): void { if (name === undefined) this.#listeners.clear(); else this.#listeners.delete(name); }
  count(name: keyof Events): number { return this.#listeners.get(name)?.size ?? 0; }
}
