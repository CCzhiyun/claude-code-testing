import { lineEnd, lineStart, resolveMotion } from './motions.js';
import { executeLineOperator, executeOperator } from './operators.js';
import { createInitialVimState, MAX_VIM_COUNT, type Operator, type VimEditResult, type VimState } from './types.js';

const operators: Record<string, Operator> = { d: 'delete', c: 'change', y: 'yank' };
export class VimController {
  state: VimState = createInitialVimState();
  handle(input: string, text: string, cursor: number): VimEditResult {
    if (this.state.mode === 'INSERT') {
      if (input !== 'escape') return { text, cursor, state: this.state, handled: false };
      this.state = { ...this.state, mode: 'NORMAL', command: { type: 'idle' } };
      return { text, cursor: Math.max(0, cursor - 1), state: this.state, handled: true };
    }
    if (input === 'escape') { this.state = { ...this.state, command: { type: 'idle' } }; return { text, cursor, state: this.state, handled: true }; }
    const command = this.state.command;
    if (command.type === 'operator') {
      if (input === command.op[0]) return this.#capture(executeLineOperator(command.op, command.count, text, cursor, this.state));
      if ('hljkwbe0^$'.includes(input)) return this.#capture(executeOperator(command.op, input, command.count, text, cursor, this.state));
      this.state = { ...this.state, command: { type: 'idle' } }; return { text, cursor, state: this.state, handled: true };
    }
    if (command.type === 'count' && /[0-9]/.test(input)) { this.state = { ...this.state, command: { type: 'count', digits: String(Math.min(MAX_VIM_COUNT, Number(command.digits + input))) } }; return { text, cursor, state: this.state, handled: true }; }
    const count = command.type === 'count' ? Number(command.digits) : 1;
    if (/[1-9]/.test(input) && command.type === 'idle') { this.state = { ...this.state, command: { type: 'count', digits: input } }; return { text, cursor, state: this.state, handled: true }; }
    if (operators[input]) { this.state = { ...this.state, command: { type: 'operator', op: operators[input], count } }; return { text, cursor, state: this.state, handled: true }; }
    if ('hljkwbe0^$'.includes(input)) return this.#capture({ text, cursor: resolveMotion(input, text, cursor, count), state: { ...this.state, command: { type: 'idle' } }, handled: true });
    if (input === 'x') return this.#capture({ text: text.slice(0, cursor) + text.slice(cursor + count), cursor: Math.min(cursor, Math.max(0, text.length - count - 1)), state: { ...this.state, register: text.slice(cursor, cursor + count), command: { type: 'idle' } }, handled: true });
    if (['i', 'a', 'I', 'A'].includes(input)) {
      const next = input === 'a' ? Math.min(text.length, cursor + 1) : input === 'I' ? lineStart(text, cursor) : input === 'A' ? lineEnd(text, cursor) : cursor;
      return this.#capture({ text, cursor: next, state: { ...this.state, mode: 'INSERT', command: { type: 'idle' } }, handled: true });
    }
    return { text, cursor, state: this.state, handled: true };
  }
  #capture(result: VimEditResult): VimEditResult { this.state = result.state; return result; }
}
