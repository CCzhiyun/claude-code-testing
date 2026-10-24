import { tokenizeTerminal } from './tokenize.js';
import { applySgr } from './sgr.js';
import { defaultStyle, type TerminalAction, type TextStyle } from './types.js';

export class TerminalParser {
  #style: TextStyle = defaultStyle();
  parse(value: string): TerminalAction[] {
    const actions: TerminalAction[] = [];
    for (const token of tokenizeTerminal(value)) {
      if (token.type === 'text') { actions.push({ type: 'text', value: token.value, style: { ...this.#style } }); continue; }
      if (token.type === 'control') { actions.push({ type: 'control', value: token.value }); continue; }
      if (token.type === 'osc') { const match = token.value.match(/^\u001b\](\d+);([\s\S]*?)(?:\u0007|\u001b\\)$/); if (match) actions.push({ type: 'osc', command: Number(match[1]), value: match[2] ?? '' }); continue; }
      const parameters = (token.parameters ?? '').replace(/^\?/, '').split(';').filter(Boolean).map(Number);
      if (token.final === 'm') { this.#style = applySgr(this.#style, parameters); actions.push({ type: 'sgr', parameters }); }
      else if (token.final === 'H' || token.final === 'f') actions.push({ type: 'cursor', row: Math.max(0, (parameters[0] ?? 1) - 1), column: Math.max(0, (parameters[1] ?? 1) - 1) });
      else if (token.final === 'A') actions.push({ type: 'cursor', deltaRow: -(parameters[0] ?? 1) });
      else if (token.final === 'B') actions.push({ type: 'cursor', deltaRow: parameters[0] ?? 1 });
      else if (token.final === 'C') actions.push({ type: 'cursor', deltaColumn: parameters[0] ?? 1 });
      else if (token.final === 'D') actions.push({ type: 'cursor', deltaColumn: -(parameters[0] ?? 1) });
      else if (token.final === 'J') actions.push({ type: 'erase', target: 'display', mode: parameters[0] ?? 0 });
      else if (token.final === 'K') actions.push({ type: 'erase', target: 'line', mode: parameters[0] ?? 0 });
    }
    return actions;
  }
  reset(): void { this.#style = defaultStyle(); }
}
