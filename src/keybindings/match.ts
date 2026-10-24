import type { ParsedKeystroke, TerminalKey } from './types.js';

export function getKeyName(input: string, key: TerminalKey): string | null {
  const name = key.name?.toLowerCase();
  if (name === 'return') return 'enter';
  if (name) return name;
  return input.length === 1 ? input.toLowerCase() : null;
}

export function matchesKeystroke(input: string, key: TerminalKey, target: ParsedKeystroke): boolean {
  if (getKeyName(input, key) !== target.key) return false;
  if (Boolean(key.ctrl) !== target.ctrl || Boolean(key.shift) !== target.shift || Boolean(key.super) !== target.super) return false;
  // readline marks a standalone ESC as meta:true on Windows and POSIX.
  // Normalize only that exact sequence; Alt+key/Alt+Esc must remain distinct.
  const terminalMeta = key.name === 'escape' && key.sequence === '\u001b' ? false : Boolean(key.meta);
  return (target.alt || target.meta) === terminalMeta;
}
