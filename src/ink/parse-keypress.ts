import { PASTE_END, PASTE_START } from './termio/csi.js';

export interface ParsedKey { name?: string; sequence: string; ctrl?: boolean; meta?: boolean; shift?: boolean }
export interface ParsedMouse { x: number; y: number; button: number; action: 'press' | 'release' | 'move' | 'scroll'; ctrl: boolean; alt: boolean; shift: boolean }
export type ParsedInput = { type: 'key'; key: ParsedKey } | { type: 'paste'; text: string } | { type: 'mouse'; mouse: ParsedMouse } | { type: 'focus'; focused: boolean };

const csiKeys: Record<string, Pick<ParsedKey, 'name' | 'shift' | 'ctrl' | 'meta'>> = {
  '\u001b[A': { name: 'up' }, '\u001b[B': { name: 'down' }, '\u001b[C': { name: 'right' }, '\u001b[D': { name: 'left' },
  '\u001b[H': { name: 'home' }, '\u001b[F': { name: 'end' }, '\u001b[Z': { name: 'tab', shift: true },
  '\u001b[3~': { name: 'delete' }, '\u001b[5~': { name: 'pageup' }, '\u001b[6~': { name: 'pagedown' },
};

function mouse(sequence: string): ParsedInput | undefined {
  const match = sequence.match(/^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/); if (!match) return undefined;
  const code = Number(match[1]); const buttonCode = code & 3; const wheel = Boolean(code & 64); const moving = Boolean(code & 32);
  return { type: 'mouse', mouse: { x: Math.max(0, Number(match[2]) - 1), y: Math.max(0, Number(match[3]) - 1), button: wheel ? (code & 1 ? 5 : 4) : buttonCode, action: wheel ? 'scroll' : moving ? 'move' : match[4] === 'm' ? 'release' : 'press', shift: Boolean(code & 4), alt: Boolean(code & 8), ctrl: Boolean(code & 16) } };
}

export function parseKeypress(sequence: string): ParsedInput {
  const parsedMouse = mouse(sequence); if (parsedMouse) return parsedMouse;
  if (sequence === '\u001b[I') return { type: 'focus', focused: true };
  if (sequence === '\u001b[O') return { type: 'focus', focused: false };
  const direct = csiKeys[sequence]; if (direct) return { type: 'key', key: { sequence, ...direct } };
  const modified = sequence.match(/^\u001b\[1;(\d+)([ABCDHF])$/);
  if (modified) { const modifier = Number(modified[1]) - 1; const names: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' }; return { type: 'key', key: { sequence, name: names[modified[2] ?? ''] ?? modified[2] ?? '', shift: Boolean(modifier & 1), meta: Boolean(modifier & 2), ctrl: Boolean(modifier & 4) } }; }
  if (sequence === '\r' || sequence === '\n') return { type: 'key', key: { sequence, name: 'return' } };
  if (sequence === '\t') return { type: 'key', key: { sequence, name: 'tab' } };
  if (sequence === '\u007f' || sequence === '\b') return { type: 'key', key: { sequence, name: 'backspace' } };
  if (sequence === '\u001b') return { type: 'key', key: { sequence, name: 'escape' } };
  if (sequence.length === 1 && sequence.charCodeAt(0) >= 1 && sequence.charCodeAt(0) <= 26) return { type: 'key', key: { sequence, name: String.fromCharCode(sequence.charCodeAt(0) + 96), ctrl: true } };
  if (sequence.startsWith('\u001b') && sequence.length > 1) return { type: 'key', key: { sequence, name: sequence.slice(1), meta: true } };
  return { type: 'key', key: { sequence, name: sequence } };
}

export function parseMultipleKeypresses(value: string): ParsedInput[] {
  const output: ParsedInput[] = []; let index = 0;
  while (index < value.length) {
    if (value.startsWith(PASTE_START, index)) { const end = value.indexOf(PASTE_END, index + PASTE_START.length); if (end < 0) { output.push({ type: 'paste', text: value.slice(index + PASTE_START.length) }); break; } output.push({ type: 'paste', text: value.slice(index + PASTE_START.length, end) }); index = end + PASTE_END.length; continue; }
    const mouseMatch = value.slice(index).match(/^\u001b\[<\d+;\d+;\d+[Mm]/); if (mouseMatch) { output.push(parseKeypress(mouseMatch[0])); index += mouseMatch[0].length; continue; }
    const csiMatch = value.slice(index).match(/^\u001b\[(?:\d+(?:;\d+)*)?[~A-Za-z]/); if (csiMatch) { output.push(parseKeypress(csiMatch[0])); index += csiMatch[0].length; continue; }
    const codePoint = value.codePointAt(index)!; const character = String.fromCodePoint(codePoint); output.push(parseKeypress(character)); index += character.length;
  }
  return output;
}

export const INITIAL_STATE = Object.freeze({ pending: '' });
