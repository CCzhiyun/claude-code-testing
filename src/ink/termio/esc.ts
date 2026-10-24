import { ESC } from './ansi.js';
export interface EscAction { type: 'save-cursor' | 'restore-cursor' | 'index' | 'reverse-index' | 'next-line' | 'reset' | 'unknown'; value: string }
const actions: Record<string, EscAction['type']> = { '7': 'save-cursor', '8': 'restore-cursor', D: 'index', M: 'reverse-index', E: 'next-line', c: 'reset' };
export function parseEsc(value: string): EscAction { const normalized = value.startsWith(ESC) ? value.slice(1) : value; return { type: actions[normalized] ?? 'unknown', value: `${ESC}${normalized}` }; }
