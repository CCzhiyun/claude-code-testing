const ESC = '\u001b[';
import { resolveTheme, themeSequence, type ThemeName } from '../components/theme.js';
import { stringWidth } from '../ink/stringWidth.js';
import { terminalSegments } from './terminalText.js';

export const tuiTheme: Record<'reset' | 'bold' | 'dim' | 'accent' | 'user' | 'assistant' | 'success' | 'warning' | 'error' | 'muted' | 'border' | 'selected', string> = {
  reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`,
  accent: `${ESC}38;5;173m`, user: `${ESC}38;5;153m`, assistant: `${ESC}38;5;252m`,
  success: `${ESC}38;5;114m`, warning: `${ESC}38;5;221m`, error: `${ESC}38;5;203m`,
  muted: `${ESC}38;5;245m`, border: `${ESC}38;5;240m`, selected: `${ESC}48;5;238m${ESC}38;5;255m`,
} as const;

export function applyTuiTheme(requested = process.env.CCPT_THEME): ThemeName {
  const theme = resolveTheme(requested);
  const enabled = theme !== 'none';
  tuiTheme.reset = enabled ? `${ESC}0m` : '';
  tuiTheme.bold = enabled ? `${ESC}1m` : '';
  tuiTheme.dim = enabled ? `${ESC}2m` : '';
  tuiTheme.accent = themeSequence('accent', theme);
  tuiTheme.user = themeSequence('accent', theme);
  tuiTheme.assistant = themeSequence('text', theme);
  tuiTheme.success = themeSequence('success', theme);
  tuiTheme.warning = themeSequence('warning', theme);
  tuiTheme.error = themeSequence('danger', theme);
  tuiTheme.muted = themeSequence('muted', theme);
  tuiTheme.border = themeSequence('border', theme);
  tuiTheme.selected = enabled ? `${ESC}7m` : '> ';
  return theme;
}

export type TranscriptRole = 'user' | 'assistant' | 'thinking' | 'system' | 'error' | 'command' | 'tool' | 'tool_result' | 'queued' | 'question';
export interface TranscriptEntry {
  role: TranscriptRole;
  text: string;
  name?: string;
  input?: Record<string, unknown>;
  isError?: boolean;
  /** Full diagnostic, model metadata, or collapsed reasoning shown in verbose transcript mode. */
  detail?: string;
}

export interface TranscriptRenderOptions { verbose?: boolean }

export function stripAnsi(value: string): string { return value.replace(/\u001b\[[0-9;]*m/g, ''); }

export function truncateTerminal(value: string, width: number): string {
  const limit = Math.max(0, Math.floor(width));
  if (!limit) return '';
  if (stringWidth(value) <= limit) return value;
  let result = ''; let used = 0;
  for (const segment of terminalSegments(value)) {
    const size = stringWidth(segment);
    if (used + size > limit - 1) break;
    result += segment; used += size;
  }
  return `${result}…${result.includes('\u001b[') ? '\u001b[0m' : ''}`;
}

export function wrapTerminal(value: string, width: number): string[] {
  const safeWidth = Math.max(8, width);
  const output: string[] = [];
  for (const source of value.replaceAll('\t', '  ').split(/\r?\n/)) {
    if (!source) { output.push(''); continue; }
    let remaining = terminalSegments(source);
    while (stringWidth(remaining.join('')) > safeWidth) {
      let used = 0; let end = 0; let space = -1;
      while (end < remaining.length) {
        const segment = remaining[end]!; const size = stringWidth(segment);
        if (used + size > safeWidth) break;
        used += size;
        if (segment === ' ' && used >= safeWidth * 0.35) space = end;
        end++;
      }
      const split = space >= 0 ? space : Math.max(1, end);
      output.push(remaining.slice(0, split).join(''));
      remaining = remaining.slice(space >= 0 ? split + 1 : split);
    }
    output.push(remaining.join(''));
  }
  return output;
}

function compactValue(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(compactValue).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

export function summarizeToolInput(name: string, input: Record<string, unknown> = {}, width = 90): string {
  const preferred = ['path', 'file_path', 'notebook_path', 'command', 'query', 'url', 'prompt', 'goal', 'task_id', 'agent_id', 'server', 'tool'];
  const parts: string[] = [];
  for (const key of preferred) {
    if (!(key in input)) continue;
    parts.push(compactValue(input[key]));
    if (parts.join(', ').length >= width) break;
  }
  if (!parts.length) {
    for (const [key, value] of Object.entries(input).slice(0, 3)) parts.push(`${key}: ${compactValue(value)}`);
  }
  return truncateTerminal(parts.join(', '), width);
}

export function renderTranscriptEntry(entry: TranscriptEntry, width: number, options: TranscriptRenderOptions = {}): string[] {
  const inner = Math.max(12, width - 4);
  if (entry.role === 'user') {
    const lines = wrapTerminal(entry.text, inner - 2);
    return lines.map((line, index) => `${tuiTheme.user}${index === 0 ? '>' : ' '} ${line}${tuiTheme.reset}`);
  }
  if (entry.role === 'assistant') {
    const lines = wrapTerminal(entry.text, inner - 2);
    return lines.map((line, index) => `${index === 0 ? `${tuiTheme.assistant}●${tuiTheme.reset} ` : '  '}${line}`);
  }
  if (entry.role === 'thinking') {
    const detail = entry.detail?.trim();
    const heading = `${entry.text}${detail && !options.verbose ? ' (Ctrl+O to expand)' : ''}`;
    const lines = [`${tuiTheme.muted}  ${heading}${tuiTheme.reset}`];
    if (options.verbose && detail) lines.push(...wrapTerminal(detail, inner - 4).map((line) => `${tuiTheme.dim}    ${line}${tuiTheme.reset}`));
    return lines;
  }
  if (entry.role === 'tool') {
    const subject = summarizeToolInput(entry.name ?? 'Tool', entry.input, inner - (entry.name?.length ?? 4) - 4);
    return [`${tuiTheme.assistant}●${tuiTheme.reset} ${tuiTheme.bold}${entry.name ?? 'Tool'}${tuiTheme.reset}${subject ? `(${subject})` : ''}`];
  }
  if (entry.role === 'tool_result') {
    const lines = wrapTerminal(entry.detail ?? entry.text, inner - 4);
    const tone = entry.isError ? tuiTheme.error : tuiTheme.muted;
    const visible = options.verbose ? lines : lines.slice(0, 8);
    const rendered = visible.map((line, index) => `${index === 0 ? `  ${tone}⎿${tuiTheme.reset} ` : '    '}${line}`);
    if (!options.verbose && lines.length > visible.length) rendered.push(`${tuiTheme.muted}    … ${lines.length - visible.length} more lines (Ctrl+O to expand)${tuiTheme.reset}`);
    return rendered;
  }
  if (entry.role === 'question') {
    const lines = wrapTerminal(entry.text, inner - 4);
    return [`${tuiTheme.warning}╭─ Input required${tuiTheme.reset}`, ...lines.map((line) => `${tuiTheme.warning}│${tuiTheme.reset} ${line}`), `${tuiTheme.warning}╰─${tuiTheme.reset} Type your answer below`];
  }
  if (entry.role === 'system' && entry.text.startsWith('Using ')) return [`  ${tuiTheme.muted}${truncateTerminal(entry.text, inner)}${tuiTheme.reset}`];
  if (entry.role === 'system' && entry.detail?.trim()) {
    const lines = wrapTerminal(entry.text, inner - 4).map((line, index) => `${index === 0 ? `${tuiTheme.muted}⎿${tuiTheme.reset} ` : '  '}${tuiTheme.muted}${line}${tuiTheme.reset}`);
    if (options.verbose) lines.push(...wrapTerminal(entry.detail.trim(), inner - 6).map((line) => `    ${tuiTheme.dim}${line}${tuiTheme.reset}`));
    else lines.push(`${tuiTheme.muted}  Ctrl+O to view full diagnostic details${tuiTheme.reset}`);
    return lines;
  }
  if (entry.role === 'queued') return [`${tuiTheme.muted}  ⏳ Queued: ${truncateTerminal(entry.text, inner - 12)}${tuiTheme.reset}`];
  if (entry.role === 'error') {
    const detail = (entry.detail ?? entry.text).trim();
    const summary = entry.text.trim().split(/\r?\n/, 1)[0] || 'Unknown error';
    const source = options.verbose ? detail : summary;
    const lines = wrapTerminal(source, inner - 4).map((line, index) => `${index === 0 ? `${tuiTheme.error}×${tuiTheme.reset} ` : '  '}${line}`);
    if (!options.verbose && detail !== summary) lines.push(`${tuiTheme.muted}  Ctrl+O to view full error details${tuiTheme.reset}`);
    return lines;
  }
  const marker = entry.role === 'command' ? '>' : '⎿';
  return wrapTerminal(entry.text, inner - 4).map((line, index) => `${index === 0 ? `${tuiTheme.muted}${marker}${tuiTheme.reset} ` : '  '}${tuiTheme.muted}${line}${tuiTheme.reset}`);
}

/** Add a Claude-style right-side scroll rail without consuming transcript content width. */
export function renderTranscriptScrollbar(lines: readonly string[], width: number, totalLines: number, offsetFromBottom: number): string[] {
  if (lines.length < 3 || totalLines <= lines.length) return [...lines];
  const track = lines.length;
  const maximumOffset = Math.max(1, totalLines - track);
  const fromTop = maximumOffset - Math.max(0, Math.min(maximumOffset, offsetFromBottom));
  const thumbSize = Math.max(1, Math.min(track, Math.round(track * track / totalLines)));
  const thumbStart = Math.round((track - thumbSize) * fromTop / maximumOffset);
  return lines.map((line, index) => {
    const glyph = index >= thumbStart && index < thumbStart + thumbSize ? '█' : '│';
    const safe = stringWidth(line) >= width ? truncateTerminal(line, width - 1) : line;
    return `${safe}${' '.repeat(Math.max(0, width - stringWidth(safe) - 1))}${tuiTheme.border}${glyph}${tuiTheme.reset}`;
  });
}

export function renderWelcome(version: string, model: string, cwd: string, width: number): string[] {
  const logo = ['    █████    ', '  ██ █ █ ██  ', '█████████████', '  ██ █ █ ██  ', '  ██     ██  '];
  const details = [`CCPT v${version}`, `${model} · API Usage Billing`, cwd, '', ''];
  const logoWidth = Math.max(...logo.map(stringWidth));
  return logo.map((line, index) => {
    const detail = truncateTerminal(details[index] ?? '', Math.max(10, width - logoWidth - 3));
    const output = `${tuiTheme.accent}${line}${tuiTheme.reset}   ${index === 0 ? tuiTheme.bold : tuiTheme.muted}${detail}${tuiTheme.reset}`;
    return `${output}${' '.repeat(Math.max(0, width - stringWidth(output)))}`;
  });
}

export function renderPromptBox(input: string, cursor: number, width: number, hint: string): { lines: string[]; cursorRow: number; cursorColumn: number } {
  const boxWidth = Math.max(30, width);
  const contentWidth = Math.max(8, boxWidth - 6);
  const logical = input.split('\n');
  const rows: Array<{ text: string; sourceStart: number }> = [];
  let sourceOffset = 0;
  for (const line of logical) {
    if (!line.length) rows.push({ text: '', sourceStart: sourceOffset });
    else {
      const segments = typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)].map((part) => ({ text: part.segment, index: part.index }))
        : [...line].map((text, index, values) => ({ text, index: values.slice(0, index).join('').length }));
      let row = '';
      let rowStart = sourceOffset;
      for (const segment of segments) {
        if (row && stringWidth(row) + stringWidth(segment.text) > contentWidth) {
          rows.push({ text: row, sourceStart: rowStart });
          row = '';
          rowStart = sourceOffset + segment.index;
        }
        row += segment.text;
      }
      rows.push({ text: row, sourceStart: rowStart });
    }
    sourceOffset += line.length + 1;
  }
  let absoluteCursorRow = rows.length - 1;
  rows.forEach((row, index) => {
    const end = row.sourceStart + row.text.length;
    if (cursor >= row.sourceStart && cursor <= end) absoluteCursorRow = index;
  });
  const visibleStart = Math.max(0, Math.min(absoluteCursorRow - 4, rows.length - 5));
  const visible = rows.slice(visibleStart, visibleStart + 5);
  let cursorRow = Math.max(0, absoluteCursorRow - visibleStart);
  // Terminal coordinates are one-based. The input begins after `│ > `, at
  // column 5, and its visual width may differ from its UTF-16 length.
  let cursorColumn = 5;
  visible.forEach((row, index) => {
    const end = row.sourceStart + row.text.length;
    if (cursor >= row.sourceStart && cursor <= end) {
      cursorRow = index;
      cursorColumn = 5 + stringWidth(row.text.slice(0, Math.min(row.text.length, cursor - row.sourceStart)));
    }
  });
  const lines = [
    `${tuiTheme.border}╭${'─'.repeat(boxWidth - 2)}╮${tuiTheme.reset}`,
    ...visible.map((row, index) => `${tuiTheme.border}│${tuiTheme.reset} ${index === 0 ? `${tuiTheme.user}>${tuiTheme.reset}` : ' '} ${row.text}${' '.repeat(Math.max(0, contentWidth - stringWidth(row.text)))} ${tuiTheme.border}│${tuiTheme.reset}`),
    `${tuiTheme.border}╰${'─'.repeat(boxWidth - 2)}╯${tuiTheme.reset}`,
    `${tuiTheme.muted}${truncateTerminal(hint, boxWidth)}${tuiTheme.reset}`,
  ];
  // `lines` starts with the top border, so the first input row is index 1.
  // Adding two placed the native cursor on the lower border for an empty input.
  return { lines, cursorRow: cursorRow + 1, cursorColumn };
}
