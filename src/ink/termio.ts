const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g;
export const enterAlternateScreen = '\u001b[?1049h';
export const leaveAlternateScreen = '\u001b[?1049l';
export const clearScreen = '\u001b[2J\u001b[H';
export const showCursor = '\u001b[?25h';
export const hideCursor = '\u001b[?25l';

export function sanitizeTerminalText(value: string): string { return value.replace(controlCharacters, ''); }
export function moveCursor(x: number, y: number): string { return `\u001b[${Math.max(1, Math.floor(y) + 1)};${Math.max(1, Math.floor(x) + 1)}H`; }
export function terminalFrame(lines: readonly string[], width: number, height: number): string {
  const safeWidth = Math.max(1, Math.floor(width)); const safeHeight = Math.max(1, Math.floor(height));
  return Array.from({ length: safeHeight }, (_, index) => sanitizeTerminalText(lines[index] ?? '').slice(0, safeWidth).padEnd(safeWidth)).join('\n');
}
