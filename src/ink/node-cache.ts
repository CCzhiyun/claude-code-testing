import type { Rectangle } from './layout/geometry.js';
export interface NodeCacheEntry { frame: Rectangle; text?: string; dirty: boolean }
export class NodeCache {
  readonly #values = new Map<object, NodeCacheEntry>(); readonly #removed: Rectangle[] = [];
  get(node: object): NodeCacheEntry | undefined { const value = this.#values.get(node); return value ? { ...value, frame: { ...value.frame } } : undefined; }
  set(node: object, value: NodeCacheEntry): void { this.#values.set(node, { ...value, frame: { ...value.frame } }); }
  markDirty(node: object): void { const value = this.#values.get(node); if (value) value.dirty = true; }
  remove(node: object): void { const value = this.#values.get(node); if (value) this.#removed.push({ ...value.frame }); this.#values.delete(node); }
  consumeRemoved(): Rectangle[] { return this.#removed.splice(0); }
  clear(): void { this.#values.clear(); this.#removed.length = 0; }
}
export const nodeCache = new NodeCache();
