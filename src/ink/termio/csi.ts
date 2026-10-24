import { CSI } from './ansi.js';

export function csi(parameters: readonly (string | number)[], final: string, prefix = ''): string { return `${CSI}${prefix}${parameters.join(';')}${final}`; }
const positive = (value: number): number => Math.max(1, Math.floor(value));
export const cursorUp = (count = 1): string => csi([positive(count)], 'A');
export const cursorDown = (count = 1): string => csi([positive(count)], 'B');
export const cursorForward = (count = 1): string => csi([positive(count)], 'C');
export const cursorBackward = (count = 1): string => csi([positive(count)], 'D');
export const cursorNextLine = (count = 1): string => csi([positive(count)], 'E');
export const cursorPreviousLine = (count = 1): string => csi([positive(count)], 'F');
export const cursorHorizontalAbsolute = (column = 0): string => csi([positive(column + 1)], 'G');
export const cursorPosition = (row = 0, column = 0): string => csi([positive(row + 1), positive(column + 1)], 'H');
export const cursorTo = (column: number, row?: number): string => row === undefined ? cursorHorizontalAbsolute(column) : cursorPosition(row, column);
export const cursorMove = (column: number, row: number): string => `${row < 0 ? cursorUp(-row) : row > 0 ? cursorDown(row) : ''}${column < 0 ? cursorBackward(-column) : column > 0 ? cursorForward(column) : ''}`;
export const eraseDisplay = (mode: 0 | 1 | 2 | 3 = 0): string => csi([mode], 'J');
export const eraseLine = (mode: 0 | 1 | 2 = 0): string => csi([mode], 'K');
export const eraseLines = (count: number): string => Array.from({ length: Math.max(0, count) }, (_, index) => `${eraseLine(2)}${index < count - 1 ? cursorUp() : ''}`).join('');
export const PASTE_START = `${CSI}200~`;
export const PASTE_END = `${CSI}201~`;
export const FOCUS_IN = `${CSI}I`;
export const FOCUS_OUT = `${CSI}O`;
export const CURSOR_HOME = cursorPosition(0, 0);
