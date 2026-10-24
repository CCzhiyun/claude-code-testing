import type { ComponentTone } from './types.js';

const ESC = '\u001b[';
export const terminalTheme = {
  reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`,
  neutral: `${ESC}38;5;252m`, info: `${ESC}38;5;45m`, success: `${ESC}38;5;84m`,
  warning: `${ESC}38;5;220m`, danger: `${ESC}38;5;203m`, muted: `${ESC}38;5;245m`,
} as const;

export function tone(value: string, name: ComponentTone = 'neutral', enabled = true): string {
  return enabled ? `${terminalTheme[name]}${value}${terminalTheme.reset}` : value;
}

export const symbols = { selected: '›', bullet: '•', success: '✓', warning: '!', error: '×', pending: '○', running: '◌' } as const;
