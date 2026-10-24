export interface InputSnapshot { text: string; cursor: number }
export class InputBuffer {
  #text = ''; #cursor = 0;
  constructor(value = '') { this.set(value); }
  get snapshot(): InputSnapshot { return { text: this.#text, cursor: this.#cursor }; }
  set(value: string, cursor = [...value].length): void { this.#text = value; this.#cursor = Math.max(0, Math.min(cursor, [...value].length)); }
  insert(value: string): void { const characters = [...this.#text]; characters.splice(this.#cursor, 0, ...value); this.#text = characters.join(''); this.#cursor += [...value].length; }
  backspace(): void { if (!this.#cursor) return; const characters = [...this.#text]; characters.splice(this.#cursor - 1, 1); this.#text = characters.join(''); this.#cursor -= 1; }
  delete(): void { const characters = [...this.#text]; if (this.#cursor < characters.length) characters.splice(this.#cursor, 1); this.#text = characters.join(''); }
  move(delta: number): void { this.#cursor = Math.max(0, Math.min([...this.#text].length, this.#cursor + Math.trunc(delta))); }
  clear(): string { const previous = this.#text; this.set(''); return previous; }
}

export class InputHistory {
  readonly #items: string[] = []; #index = -1; #draft = '';
  constructor(readonly limit = 100) {}
  push(value: string): void { const trimmed = value.trim(); if (!trimmed || this.#items.at(-1) === trimmed) return; this.#items.push(trimmed); if (this.#items.length > this.limit) this.#items.shift(); this.reset(); }
  previous(current: string): string { if (!this.#items.length) return current; if (this.#index < 0) this.#draft = current; this.#index = Math.min(this.#items.length - 1, this.#index + 1); return this.#items[this.#items.length - 1 - this.#index] ?? current; }
  next(): string { if (this.#index <= 0) { this.reset(); return this.#draft; } this.#index -= 1; return this.#items[this.#items.length - 1 - this.#index] ?? this.#draft; }
  search(query: string): string[] { const normalized = query.toLowerCase(); return [...this.#items].reverse().filter((item) => item.toLowerCase().includes(normalized)); }
  reset(): void { this.#index = -1; this.#draft = ''; }
}
