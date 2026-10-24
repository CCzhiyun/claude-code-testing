import type { Chord, ParsedBinding, ParsedKeystroke } from './types.js';
import type { KeybindingBlock } from './schema.js';

export function parseKeystroke(input: string): ParsedKeystroke {
  const result: ParsedKeystroke = { key: '', ctrl: false, alt: false, shift: false, meta: false, super: false };
  for (const part of input.split('+')) {
    const value = part.toLowerCase();
    if (value === 'ctrl' || value === 'control') result.ctrl = true;
    else if (value === 'alt' || value === 'opt' || value === 'option') result.alt = true;
    else if (value === 'shift') result.shift = true;
    else if (value === 'meta') result.meta = true;
    else if (['cmd', 'command', 'super', 'win'].includes(value)) result.super = true;
    else result.key = ({ esc: 'escape', return: 'enter', space: ' ', '↑': 'up', '↓': 'down', '←': 'left', '→': 'right' } as Record<string, string>)[value] ?? value;
  }
  return result;
}

export function parseChord(input: string): Chord { return input === ' ' ? [parseKeystroke('space')] : input.trim().split(/\s+/).map(parseKeystroke); }
export function keystrokeToString(value: ParsedKeystroke): string { return [...(value.ctrl ? ['ctrl'] : []), ...(value.alt ? ['alt'] : []), ...(value.shift ? ['shift'] : []), ...(value.meta ? ['meta'] : []), ...(value.super ? ['cmd'] : []), value.key === ' ' ? 'Space' : value.key].join('+'); }
export function chordToString(chord: Chord): string { return chord.map(keystrokeToString).join(' '); }
export function parseBindings(blocks: KeybindingBlock[], source: NonNullable<ParsedBinding['source']>): ParsedBinding[] {
  return blocks.flatMap((block) => Object.entries(block.bindings).map(([key, action]) => ({ chord: parseChord(key), action, context: block.context, source })));
}
