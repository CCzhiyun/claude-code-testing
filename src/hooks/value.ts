export type ValueListener<T> = (value: T, previous: T) => void;
export class ReactiveValue<T> {
  readonly #listeners = new Set<ValueListener<T>>();
  constructor(private current: T) {}
  get value(): T { return this.current; }
  set(value: T): void { if (Object.is(value, this.current)) return; const previous = this.current; this.current = value; for (const listener of [...this.#listeners]) listener(value, previous); }
  update(transform: (value: T) => T): void { this.set(transform(this.current)); }
  subscribe(listener: ValueListener<T>, immediate = false): () => void { this.#listeners.add(listener); if (immediate) listener(this.current, this.current); return () => this.#listeners.delete(listener); }
}

export function derivedValue<T, R>(source: ReactiveValue<T>, select: (value: T) => R): { value: ReactiveValue<R>; dispose(): void } { const value = new ReactiveValue(select(source.value)); const unsubscribe = source.subscribe((next) => value.set(select(next))); return { value, dispose: unsubscribe }; }
