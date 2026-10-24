export class CircularBuffer<T> {
  readonly #values: T[] = [];
  constructor(readonly capacity: number) { if (!Number.isInteger(capacity) || capacity < 1) throw new Error('CircularBuffer capacity must be a positive integer'); }
  push(value: T): void { if (this.#values.length === this.capacity) this.#values.shift(); this.#values.push(value); }
  clear(): void { this.#values.length = 0; }
  toArray(): T[] { return [...this.#values]; }
  get length(): number { return this.#values.length; }
}
export function objectGroupBy<T, K extends PropertyKey>(items: Iterable<T>, key: (item: T, index: number) => K): Partial<Record<K, T[]>> { const output: Partial<Record<K, T[]>> = {}; let index = 0; for (const item of items) { const group = key(item, index++); (output[group] ??= []).push(item); } return output; }
export function uniqueBy<T, K>(items: Iterable<T>, key: (item: T) => K): T[] { const keys = new Set<K>(); const output: T[] = []; for (const item of items) { const value = key(item); if (!keys.has(value)) { keys.add(value); output.push(item); } } return output; }
export function memoize<Args extends readonly unknown[], Result>(operation: (...args: Args) => Result, key: (...args: Args) => string = (...args) => JSON.stringify(args)): (...args: Args) => Result { const cache = new Map<string, Result>(); return (...args) => { const id = key(...args); if (cache.has(id)) return cache.get(id)!; const value = operation(...args); cache.set(id, value); return value; }; }
export function mapDefined<T, R>(items: Iterable<T>, mapper: (item: T) => R | undefined): R[] { const output: R[] = []; for (const item of items) { const mapped = mapper(item); if (mapped !== undefined) output.push(mapped); } return output; }

export class Cursor<T> {
  #index = -1;
  constructor(readonly values: readonly T[], readonly wrap = false) {}
  get index(): number { return this.#index; }
  get current(): T | undefined { return this.#index < 0 ? undefined : this.values[this.#index]; }
  reset(): void { this.#index = -1; }
  move(delta: number): T | undefined {
    if (!this.values.length) return undefined;
    const next = this.#index < 0 ? (delta < 0 ? this.values.length - 1 : 0) : this.#index + delta;
    this.#index = this.wrap ? ((next % this.values.length) + this.values.length) % this.values.length : Math.max(0, Math.min(this.values.length - 1, next));
    return this.current;
  }
  select(index: number): T | undefined { if (!Number.isInteger(index) || index < 0 || index >= this.values.length) return undefined; this.#index = index; return this.current; }
}

export function setIntersection<T>(left: Iterable<T>, right: Iterable<T>): Set<T> { const other = new Set(right); return new Set([...left].filter((value) => other.has(value))); }
export function setDifference<T>(left: Iterable<T>, right: Iterable<T>): Set<T> { const other = new Set(right); return new Set([...left].filter((value) => !other.has(value))); }
export function partition<T>(items: Iterable<T>, predicate: (item: T, index: number) => boolean): [T[], T[]] { const yes: T[] = []; const no: T[] = []; let index = 0; for (const item of items) (predicate(item, index++) ? yes : no).push(item); return [yes, no]; }
export function compact<T>(items: Iterable<T | null | undefined | false>): T[] { return [...items].filter((value): value is T => value !== undefined && value !== null && value !== false); }
export function chunk<T>(items: readonly T[], size: number): T[][] { if (!Number.isInteger(size) || size < 1) throw new Error('Chunk size must be a positive integer'); const output: T[][] = []; for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size)); return output; }

export interface TreeNode<T> { value: T; children: TreeNode<T>[] }
export function treeify<T, K>(items: Iterable<T>, id: (item: T) => K, parent: (item: T) => K | undefined): TreeNode<T>[] {
  const nodes = new Map<K, TreeNode<T>>(); const roots: TreeNode<T>[] = [];
  for (const item of items) nodes.set(id(item), { value: item, children: [] });
  for (const node of nodes.values()) { const parentId = parent(node.value); const owner = parentId === undefined ? undefined : nodes.get(parentId); if (owner) owner.children.push(node); else roots.push(node); }
  return roots;
}
