import { stringWidth } from '../ink/stringWidth.js';
import { truncateTerminal, tuiTheme, wrapTerminal } from '../tui/presentation.js';

export interface WorkspaceTrustDialogState {
  selected: 0 | 1;
}

function padVisible(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - stringWidth(value)))}`;
}

export function renderWorkspaceTrustDialog(cwd: string, state: WorkspaceTrustDialogState, width: number, height: number): string[] {
  const safeWidth = Math.max(50, width);
  const contentWidth = Math.max(30, safeWidth - 4);
  const body = wrapTerminal("Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team.) If not, take a moment to review what's in this folder first.", contentWidth);
  const option = (index: 0 | 1, label: string): string => {
    const marker = state.selected === index ? '>' : ' ';
    const raw = `${marker} ${index + 1}. ${label}`;
    return state.selected === index
      ? `${tuiTheme.user}${tuiTheme.bold}${padVisible(raw, Math.min(contentWidth, stringWidth(raw)))}${tuiTheme.reset}`
      : `${tuiTheme.muted}${raw}${tuiTheme.reset}`;
  };
  return [
    `${tuiTheme.warning}${'─'.repeat(safeWidth)}${tuiTheme.reset}`,
    `${tuiTheme.warning}${tuiTheme.bold}Accessing workspace:${tuiTheme.reset}`,
    '',
    `${tuiTheme.assistant}${truncateTerminal(cwd, contentWidth)}${tuiTheme.reset}`,
    '',
    ...body.map((line) => `${tuiTheme.assistant}${line}${tuiTheme.reset}`),
    '',
    `${tuiTheme.assistant}CCPT will be able to read, edit, and execute files here.${tuiTheme.reset}`,
    '',
    `${tuiTheme.muted}Security guide${tuiTheme.reset}`,
    '',
    option(0, 'Yes, I trust this folder'),
    option(1, 'No, exit'),
    '',
    `${tuiTheme.muted}↑/↓ to select · Enter to confirm · Esc to cancel${tuiTheme.reset}`,
  ].slice(0, Math.max(1, height));
}
