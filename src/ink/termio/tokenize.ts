import { BEL, ESC, ST } from './ansi.js';

export type Token = { type: 'text' | 'control' | 'csi' | 'osc'; value: string; final?: string; parameters?: string };

export function tokenizeTerminal(value: string): Token[] {
  const output: Token[] = []; let text = '';
  const flush = (): void => { if (text) { output.push({ type: 'text', value: text }); text = ''; } };
  for (let index = 0; index < value.length;) {
    const character = value[index]!;
    if (character !== ESC) {
      if (character < ' ' || character === '\u007f') { flush(); output.push({ type: 'control', value: character }); }
      else text += character;
      index += 1; continue;
    }
    flush();
    if (value[index + 1] === '[') {
      let end = index + 2;
      while (end < value.length && !/[\x40-\x7e]/.test(value[end]!)) end += 1;
      if (end >= value.length) { text += value.slice(index); break; }
      const token = value.slice(index, end + 1);
      output.push({ type: 'csi', value: token, parameters: token.slice(2, -1), final: token.at(-1) ?? '' }); index = end + 1; continue;
    }
    if (value[index + 1] === ']') {
      let end = index + 2;
      while (end < value.length && value[end] !== BEL && !value.startsWith(ST, end)) end += 1;
      const hasSt = value.startsWith(ST, end); const tokenEnd = Math.min(value.length, end + (hasSt ? 2 : 1));
      output.push({ type: 'osc', value: value.slice(index, tokenEnd) }); index = tokenEnd; continue;
    }
    output.push({ type: 'control', value: value.slice(index, index + 2) }); index += 2;
  }
  flush(); return output;
}

export function createTokenizer(onToken: (token: Token) => void): { write(value: string): void; end(): void } {
  let pending = '';
  return {
    write(value: string): void { pending += value; const tokens = tokenizeTerminal(pending); pending = ''; for (const token of tokens) onToken(token); },
    end(): void { if (pending) { onToken({ type: 'text', value: pending }); pending = ''; } },
  };
}
