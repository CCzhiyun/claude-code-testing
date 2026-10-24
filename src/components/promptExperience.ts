import { stringWidth } from '../ink/stringWidth.js';
import { truncateTerminal, tuiTheme } from '../tui/presentation.js';
import { paletteViewport } from './paletteViewport.js';

interface PaletteItem { name: string; description: string; argument?: string; kind?: string }

export function renderPromptPalette(items: readonly PaletteItem[], selected: number, width: number, maxRows: number): string[] {
  if (!items.length) return [];
  const current = items[Math.max(0, Math.min(selected, items.length - 1))]!;
  const viewport = paletteViewport(items, selected, Math.max(1, maxRows - 2));
  const nameWidth = Math.min(Math.floor(width * 0.4), Math.max(16, ...viewport.items.map(item => stringWidth(item.name))));
  const lines = viewport.items.map((item, offset) => {
    const name = truncateTerminal(item.name, nameWidth);
    const marker = viewport.start + offset === selected ? '›' : ' ';
    const line = `${marker} ${name}${' '.repeat(Math.max(1, nameWidth - stringWidth(name) + 2))}${truncateTerminal(item.description, width - nameWidth - 4)}`;
    return `${viewport.start + offset === selected ? tuiTheme.selected : tuiTheme.muted}${truncateTerminal(line, width)}${tuiTheme.reset}`;
  });
  lines.push(`${tuiTheme.muted}${truncateTerminal(current.kind === 'command' ? `Usage: ${current.name}${current.argument ? ` ${current.argument}` : ''}` : current.description, width)}${tuiTheme.reset}`);
  lines.push(`${tuiTheme.muted}${truncateTerminal(`${selected + 1}/${items.length} · ↑/↓ select · Tab fill · Enter ${current.kind === 'command' ? 'run' : 'choose'}${viewport.above ? ' · ↑ more' : ''}${viewport.below ? ' · ↓ more' : ''}`, width)}${tuiTheme.reset}`);
  return lines;
}

export function renderIdleHint(mode: string, effort: string, width: number, flags: string[] = []): string {
  return truncateTerminal([mode, effort, ...flags, '? shortcuts', '/ commands'].filter(Boolean).join(' · '), width);
}

export function renderShortcutHelp(width: number): string[] {
  return [
    'Default shortcuts · /keybindings to customize',
    'Enter send · Tab complete · ↑/↓ history or selection',
    'Ctrl+J / Shift+Enter newline · Ctrl+R search history',
    'Esc interrupt · Ctrl+B background · Ctrl+T tasks',
    'Ctrl+O transcript · Alt+P model · Shift+Tab permissions',
    'Ctrl+S stash · Ctrl+G editor · @ files · ! shell',
    '? / Esc close · typing continues your prompt',
  ].map(line => `${tuiTheme.muted}${truncateTerminal(line, width)}${tuiTheme.reset}`);
}
