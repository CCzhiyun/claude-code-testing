import { truncateTerminal } from '../ink.js';
import { moveCursor, sanitizeTerminalText } from './termio.js';

export interface RenderFrameOptions { width: number; height: number; previous?: readonly string[]; originX?: number; originY?: number }
export interface RenderFrame { lines: string[]; output: string; changedRows: number[] }

export function renderFrame(source: readonly string[], options: RenderFrameOptions): RenderFrame {
  const width = Math.max(1, Math.floor(options.width)); const height = Math.max(1, Math.floor(options.height));
  const lines = Array.from({ length: height }, (_, index) => truncateTerminal(sanitizeTerminalText(source[index] ?? ''), width));
  const changedRows = lines.flatMap((line, index) => (options.previous?.[index] ?? '') === line ? [] : [index]);
  const output = changedRows.map((row) => `${moveCursor(options.originX ?? 0, (options.originY ?? 0) + row)}${lines[row]}\u001b[K`).join('');
  return { lines, output, changedRows };
}
