import { stringWidth } from './stringWidth.js';
import { tokenizeTerminal } from './termio/tokenize.js';
export function wrapAnsi(value: string, width: number): string {
  const maximum = Math.max(1, Math.floor(width)); let column = 0; let output = '';
  for (const token of tokenizeTerminal(value)) {
    if (token.type !== 'text') { output += token.value; continue; }
    for (const character of token.value) { const size = stringWidth(character); if (column && column + size > maximum) { output += '\n'; column = 0; } output += character; column = character === '\n' ? 0 : column + size; }
  }
  return output;
}
export default wrapAnsi;
