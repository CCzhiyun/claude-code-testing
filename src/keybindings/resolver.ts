import { matchesKeystroke } from './match.js';
import type { KeybindingContextName } from './schema.js';
import type { ParsedBinding, ParsedKeystroke, TerminalKey } from './types.js';

export type ChordResolveResult = { type: 'match'; action: string } | { type: 'none' } | { type: 'unbound' } | { type: 'chord_started'; pending: ParsedKeystroke[] } | { type: 'chord_cancelled' };

export class KeybindingResolver {
  readonly #bindings: ParsedBinding[];
  #pending: { candidates: ParsedBinding[]; index: number; startedAt: number } | undefined;
  constructor(bindings: ParsedBinding[], readonly chordTimeoutMs = 1_000) { this.#bindings = bindings; }

  resolve(input: string, key: TerminalKey, contexts: KeybindingContextName[]): ChordResolveResult {
    if (this.#pending && Date.now() - this.#pending.startedAt > this.chordTimeoutMs) this.#pending = undefined;
    if (this.#pending) {
      const matches = this.#pending.candidates.filter((binding) => binding.chord[this.#pending!.index] && matchesKeystroke(input, key, binding.chord[this.#pending!.index]!));
      if (!matches.length) { this.#pending = undefined; return { type: 'chord_cancelled' }; }
      const complete = matches.find((binding) => binding.chord.length === this.#pending!.index + 1);
      if (complete) { this.#pending = undefined; return complete.action === null ? { type: 'unbound' } : { type: 'match', action: complete.action }; }
      this.#pending = { candidates: matches, index: this.#pending.index + 1, startedAt: Date.now() };
      return { type: 'chord_started', pending: matches[0]!.chord.slice(0, this.#pending.index) };
    }
    const active = new Set<KeybindingContextName>(['Global', ...contexts]);
    const matches = this.#bindings.filter((binding) => active.has(binding.context) && binding.chord[0] && matchesKeystroke(input, key, binding.chord[0]));
    const ranked = matches.sort((left, right) => (right.source === 'user' ? 2 : 0) - (left.source === 'user' ? 2 : 0) || (right.context === 'Global' ? 0 : 1) - (left.context === 'Global' ? 0 : 1));
    const first = ranked[0];
    if (!first) return { type: 'none' };
    if (first.chord.length === 1) return first.action === null ? { type: 'unbound' } : { type: 'match', action: first.action };
    this.#pending = { candidates: ranked.filter((binding) => binding.chord.length > 1), index: 1, startedAt: Date.now() };
    return { type: 'chord_started', pending: first.chord.slice(0, 1) };
  }
}
