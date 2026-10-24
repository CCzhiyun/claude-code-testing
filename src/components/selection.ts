export interface SelectItem<T = unknown> {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  value?: T;
  keywords?: readonly string[];
}

export interface RankedSelectItem<T = unknown> extends SelectItem<T> { score: number; positions: number[] }

export function fuzzyMatch(query: string, value: string): { score: number; positions: number[] } | undefined {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = value.toLocaleLowerCase();
  if (!needle) return { score: 0, positions: [] };
  if (haystack === needle) return { score: 10_000, positions: [...needle].map((_, index) => index) };
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return { score: 8_000 - direct * 4 - (haystack.length - needle.length), positions: [...needle].map((_, index) => direct + index) };
  const positions: number[] = [];
  let cursor = 0;
  let score = 0;
  let previous = -2;
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return undefined;
    positions.push(index);
    score += index === previous + 1 ? 18 : 5;
    if (index === 0 || /[\s_./\\-]/.test(haystack[index - 1] ?? '')) score += 12;
    score -= Math.max(0, index - previous - 1);
    previous = index;
    cursor = index + 1;
  }
  return { score: 1_000 + score - haystack.length, positions };
}

export function rankSelectItems<T>(items: readonly SelectItem<T>[], query: string, limit = 50): RankedSelectItem<T>[] {
  return items.flatMap((item) => {
    const searchable = [item.label, item.description ?? '', ...(item.keywords ?? [])].join(' ');
    const match = fuzzyMatch(query, searchable);
    return match ? [{ ...item, ...match }] : [];
  }).sort((left, right) => right.score - left.score || left.label.localeCompare(right.label)).slice(0, Math.max(0, limit));
}

export class SelectController<T = unknown> {
  #query = '';
  #selected = 0;
  readonly #checked = new Set<string>();
  constructor(readonly items: readonly SelectItem<T>[], readonly multiple = false) {}
  get query(): string { return this.#query; }
  get selected(): number { return this.#selected; }
  get visible(): RankedSelectItem<T>[] { return rankSelectItems(this.items, this.#query); }
  get checked(): string[] { return [...this.#checked]; }
  search(query: string): void { this.#query = query; this.#selected = 0; this.#ensureEnabled(1); }
  move(delta: number): void {
    const visible = this.visible;
    if (!visible.length) { this.#selected = 0; return; }
    const direction = delta < 0 ? -1 : 1;
    for (let count = 0; count < visible.length; count += 1) {
      this.#selected = (this.#selected + direction + visible.length) % visible.length;
      if (!visible[this.#selected]?.disabled) return;
    }
  }
  current(): RankedSelectItem<T> | undefined { return this.visible[this.#selected]; }
  toggle(): void {
    const current = this.current();
    if (!current || current.disabled) return;
    if (!this.multiple) this.#checked.clear();
    if (this.#checked.has(current.id)) this.#checked.delete(current.id); else this.#checked.add(current.id);
  }
  submit(): SelectItem<T>[] {
    const current = this.current();
    if (!this.multiple) return current && !current.disabled ? [current] : [];
    return this.items.filter((item) => this.#checked.has(item.id) && !item.disabled);
  }
  #ensureEnabled(direction: number): void { if (this.current()?.disabled) this.move(direction); }
}
