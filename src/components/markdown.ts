import { stringWidth } from '../ink/stringWidth.js';

export interface MarkdownRenderOptions { width?: number; color?: boolean }
const ansi = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', cyan: '\u001b[36m', code: '\u001b[38;5;215m' };
const paint = (value: string, prefix: string, enabled: boolean): string => enabled ? `${prefix}${value}${ansi.reset}` : value;

function pad(value: string, width: number): string { return `${value}${' '.repeat(Math.max(0, width - stringWidth(value)))}`; }

export function renderMarkdownTable(lines: readonly string[], width = 100, color = true): string[] {
  const rows = lines.map((line) => { const trimmed = line.trim(); const inner = trimmed.startsWith('|') && trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed; return inner.split('|').map((cell) => cell.trim()); });
  if (rows.length < 2) return [...lines];
  const header = rows[0] ?? []; const body = rows.slice(2);
  const columns = Math.max(header.length, ...body.map((row) => row.length));
  const available = Math.max(columns * 3, width - columns - 1);
  const widths = Array.from({ length: columns }, (_, column) => Math.max(3, Math.min(36, Math.max(...[header, ...body].map((row) => stringWidth(row[column] ?? ''))))));
  while (widths.reduce((sum, value) => sum + value, 0) > available) {
    const largest = widths.indexOf(Math.max(...widths));
    if ((widths[largest] ?? 3) <= 3) break;
    widths[largest]!--;
  }
  const border = `+${widths.map((value) => '-'.repeat(value + 2)).join('+')}+`;
  const renderRow = (row: readonly string[]) => `|${widths.map((columnWidth, column) => ` ${pad((row[column] ?? '').slice(0, columnWidth), columnWidth)} `).join('|')}|`;
  return [border, paint(renderRow(header), ansi.bold, color), border, ...body.map(renderRow), border];
}

export function renderMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string[] {
  const width = Math.max(20, options.width ?? 100); const color = options.color ?? true;
  const source = markdown.split(/\r?\n/); const output: string[] = [];
  let code = false; let table: string[] = [];
  const flushTable = (): void => { if (table.length) { output.push(...renderMarkdownTable(table, width, color)); table = []; } };
  for (const raw of source) {
    if (/^```/.test(raw.trim())) { flushTable(); code = !code; continue; }
    if (code) { output.push(paint(`  ${raw}`, ansi.code, color)); continue; }
    if (/^\s*\|.+\|\s*$/.test(raw)) { table.push(raw); continue; }
    flushTable();
    const heading = raw.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { output.push(paint(heading[2] ?? '', ansi.bold, color)); continue; }
    const bullet = raw.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) { output.push(`  ${paint('•', ansi.cyan, color)} ${inline(bullet[1] ?? '', color)}`); continue; }
    const ordered = raw.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ordered) { output.push(`  ${ordered[1]}. ${inline(ordered[2] ?? '', color)}`); continue; }
    if (/^>\s?/.test(raw)) { output.push(paint(`│ ${raw.replace(/^>\s?/, '')}`, ansi.dim, color)); continue; }
    output.push(inline(raw, color));
  }
  flushTable();
  return output;
}

function inline(value: string, color: boolean): string {
  return value.replace(/`([^`]+)`/g, (_, body: string) => paint(body, ansi.code, color)).replace(/\*\*([^*]+)\*\*/g, (_, body: string) => paint(body, ansi.bold, color)).replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 <$2>');
}
