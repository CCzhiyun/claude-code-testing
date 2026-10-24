export interface VirtualWindow { start: number; end: number; selected: number; offset: number }
export class VirtualScrollController {
  #selected = 0; #offset = 0;
  constructor(readonly viewport: number) { if (!Number.isInteger(viewport) || viewport < 1) throw new Error('Viewport must be a positive integer'); }
  move(delta: number, count: number): VirtualWindow { this.#selected = Math.max(0, Math.min(Math.max(0, count - 1), this.#selected + Math.trunc(delta))); if (this.#selected < this.#offset) this.#offset = this.#selected; if (this.#selected >= this.#offset + this.viewport) this.#offset = this.#selected - this.viewport + 1; return this.window(count); }
  select(index: number, count: number): VirtualWindow { this.#selected = Math.max(0, Math.min(Math.max(0, count - 1), Math.trunc(index))); return this.move(0, count); }
  window(count: number): VirtualWindow { const maxOffset = Math.max(0, count - this.viewport); this.#offset = Math.min(this.#offset, maxOffset); return { start: this.#offset, end: Math.min(count, this.#offset + this.viewport), selected: this.#selected, offset: this.#offset }; }
}
