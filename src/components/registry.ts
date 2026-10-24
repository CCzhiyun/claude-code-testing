import type { ComponentKind, ComponentRenderer } from './types.js';

export class ComponentRegistry {
  readonly #renderers = new Map<ComponentKind, ComponentRenderer>();
  register(renderer: ComponentRenderer): this { this.#renderers.set(renderer.kind, renderer); return this; }
  get(kind: ComponentKind): ComponentRenderer | undefined { return this.#renderers.get(kind); }
  has(kind: ComponentKind): boolean { return this.#renderers.has(kind); }
  list(): ComponentKind[] { return [...this.#renderers.keys()].sort(); }
}
