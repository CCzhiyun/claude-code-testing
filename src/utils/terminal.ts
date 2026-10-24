import { stripAnsi, terminalWidth } from '../ink.js';
import { escapeXml } from './portable.js';

export function hyperlink(label: string, url: string, enabled = true): string { return enabled ? `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007` : label; }
export function supportsColor(environment = process.env): boolean { return !('NO_COLOR' in environment) && environment.TERM !== 'dumb' && (Boolean(environment.FORCE_COLOR) || Boolean(process.stdout.isTTY)); }
export function horizontalScroll(value: string, offset: number, width: number): string { if (width <= 0) return ''; return [...stripAnsi(value)].slice(Math.max(0, offset), Math.max(0, offset) + width).join(''); }
export function fitTerminalLine(value: string, width: number): string { const plain = stripAnsi(value); const clipped = [...plain].slice(0, Math.max(0, width)).join(''); return `${clipped}${' '.repeat(Math.max(0, width - terminalWidth(clipped)))}`; }

export function ansiToSvg(value: string, options: { foreground?: string; background?: string; fontSize?: number; padding?: number } = {}): string {
  const foreground = options.foreground ?? '#d8dee9'; const background = options.background ?? '#1e222a'; const fontSize = options.fontSize ?? 14; const padding = options.padding ?? 16;
  const lines = stripAnsi(value).split(/\r?\n/); const columns = Math.max(1, ...lines.map((line) => [...line].length));
  const width = columns * fontSize * 0.62 + padding * 2; const height = Math.max(1, lines.length) * fontSize * 1.45 + padding * 2;
  const text = lines.map((line, index) => `<text x="${padding}" y="${padding + fontSize + index * fontSize * 1.45}">${escapeXml(line)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}"><rect width="100%" height="100%" fill="${escapeXml(background)}"/><g fill="${escapeXml(foreground)}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="${fontSize}">${text}</g></svg>`;
}

export interface AsciicastEvent { time: number; type: 'o' | 'i'; data: string }
export function encodeAsciicast(events: readonly AsciicastEvent[], options: { width?: number; height?: number; timestamp?: number } = {}): string {
  const header = { version: 2, width: options.width ?? 80, height: options.height ?? 24, timestamp: options.timestamp ?? Math.floor(Date.now() / 1000), env: { TERM: process.env.TERM ?? 'xterm-256color' } };
  return [JSON.stringify(header), ...events.map((event) => JSON.stringify([Math.max(0, event.time), event.type, event.data]))].join('\n');
}

export function terminalTheme(environment = process.env): 'dark' | 'light' | 'none' { if (environment.NO_COLOR !== undefined) return 'none'; return environment.COLORFGBG?.split(';').some((value) => Number(value) > 7) ? 'light' : 'dark'; }
