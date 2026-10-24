import { resolve } from 'node:path';
import type { AgentRecord, SessionRecord } from '../types.js';
import { stripAnsi, truncateTerminal, wrapTerminal, tuiTheme } from '../tui/presentation.js';

export type ResourceAction = 'stop' | 'attach' | 'inspect';
export interface ResourceItem { id: string; label: string; description: string; detail?: string; cwd?: string; actions?: ResourceAction[]; repository?: string; branch?: string }
export interface ResourceDialogState {
  type: 'resource';
  kind: 'resume' | 'agents' | 'teams' | 'theme' | 'hooks' | 'mcp' | 'tasks' | 'notifications';
  title: string;
  query: string;
  selected: number;
  tab: number;
  tabs: string[];
  groups: ResourceItem[][];
  expanded: boolean;
  detailScroll?: number;
  cwd: string;
  allProjects: boolean;
  repository?: string;
  currentBranch?: string;
  allWorktrees?: boolean;
  branchOnly?: boolean;
  confirmation?: { id: string; action: ResourceAction };
  busy?: boolean;
  status?: string;
  searchMode?: boolean;
  renaming?: { id: string; value: string };
  notificationOffset?: number;
}

export function agentResourceItem(agent: AgentRecord): ResourceItem {
  const running = ['working', 'queued'].includes(agent.status);
  const stoppable = running || agent.status === 'waiting_for_input';
  return { id: agent.id, label: `${agent.role} · ${agent.status}`, description: agent.goal, cwd: agent.cwd,
    detail: `${agent.id}\nSession: ${agent.sessionId}\n${agent.goal}\n${agent.result ?? agent.error ?? agent.status}${agent.worktree ? `\nWorktree: ${agent.worktree}` : ''}`,
    actions: [...(stoppable ? ['stop' as const] : []), 'attach'] };
}

export function sameWorkspace(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

export function sessionItems(sessions: SessionRecord[], agents: AgentRecord[] = []): ResourceItem[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((session) => ({
    id: session.id, label: session.title, cwd: session.cwd,
    description: `${session.updatedAt.slice(0, 16).replace('T', ' ')} · ${session.messages.length} messages${session.git?.branch ? ` · [${session.git.branch}]` : ''}${agents.some(agent => agent.sessionId === session.id && ['working', 'queued', 'waiting_for_input'].includes(agent.status)) ? ' · bg' : ''} · ${session.cwd}`,
    ...(session.git ? { repository: session.git.repository, ...(session.git.branch ? { branch: session.git.branch } : {}) } : {}),
    detail: sessionPreview(session),
  }));
}

/** Bounded, local transcript preview. Never display hidden reasoning or image payloads. */
export function sessionPreview(session: SessionRecord): string {
  const total = (session.archivedMessages?.length ?? 0) + session.messages.length;
  const archivedCount = Math.max(0, 40 - session.messages.length);
  const messages = [...(archivedCount ? session.archivedMessages?.slice(-archivedCount) ?? [] : []), ...session.messages.slice(-40)];
  const lines = messages.map(message => {
    let text = typeof message.content === 'string' ? message.content.slice(0, 1200) : '';
    if (Array.isArray(message.content)) for (const block of message.content.slice(0, 80)) {
      if (text.length >= 1200) break;
      const part = block.type === 'text' ? block.text ?? '' : block.type === 'tool_result' ? block.content ?? '' : block.type === 'tool_use' ? `[tool: ${block.name ?? 'unknown'}]` : block.type === 'image' ? '[image attachment]' : '';
      if (part) text += `${text ? '\n' : ''}${part.slice(0, 1200 - text.length)}`;
    }
    return `${message.role}: ${text.slice(0, 1200)}`;
  });
  return [session.id, ...(total > 40 ? ['[Earlier messages omitted from preview; retained on disk]'] : []), ...lines, 'No tools are replayed and no model request is sent by previewing.'].join('\n');
}

export function resourceItems(state: ResourceDialogState): ResourceItem[] {
  const query = state.query.trim().toLowerCase();
  return (state.groups[state.tab] ?? []).filter((item) =>
    (state.kind !== 'resume' || (state.allProjects || (state.allWorktrees && state.repository ? item.repository === state.repository : item.cwd && sameWorkspace(item.cwd, state.cwd)))
      && (!state.branchOnly || (item.repository === state.repository && item.branch === state.currentBranch)))
    && (!query || `${item.label} ${item.description} ${item.id}`.toLowerCase().includes(query)));
}

/** Preserve logical selection when fresh members/plans are inserted or removed.
 * Approval-version receipts are deliberately NOT updated by a background refresh. */
export function refreshResourceGroups(state: ResourceDialogState, groups: ResourceItem[][]): void {
  const selectedId = resourceItems(state)[state.selected]?.id;
  state.groups = groups;
  const index = resourceItems(state).findIndex(item => item.id === selectedId);
  state.selected = index >= 0 ? index : 0;
  if (index < 0) { state.expanded = false; state.detailScroll = 0; }
}

/** Pure navigation reducer shared by the TUI and interaction tests. */
export function navigateResource(state: ResourceDialogState, key: string, text = '', ctrl = false): 'select' | 'close' | 'action' | 'rename' | undefined {
  if (state.busy) return;
  if (state.renaming) {
    if (key === 'escape') { delete state.renaming; delete state.status; }
    else if (key === 'return' || key === 'enter') return 'rename';
    else if (ctrl && key === 'u') state.renaming.value = '';
    else if (key === 'backspace') state.renaming.value = deleteLastGrapheme(state.renaming.value);
    else if (!ctrl && text && !/[\x00-\x1f\x7f-\x9f]/.test(text)) state.renaming.value = Array.from(state.renaming.value + text).slice(0, 120).join('');
    return;
  }
  if (state.confirmation) {
    if (key === 'escape') delete state.confirmation;
    else if (key === 'return' || key === 'enter') return 'action';
    return;
  }
  const action: ResourceAction | undefined = text === 'x' ? 'stop' : text === 'a' ? 'attach' : text === 't' ? 'inspect' : undefined;
  const selected = resourceItems(state)[state.selected];
  if (state.kind === 'resume') {
    if (ctrl && (key === 'w' || key === 'b')) {
      if (!state.repository) { state.status = 'Git repository information is unavailable for this directory.'; return; }
      if (key === 'b' && !state.currentBranch) { state.status = 'Detached HEAD has no current branch to filter.'; return; }
      if (key === 'w') { state.allWorktrees = !state.allWorktrees; state.allProjects = false; }
      else state.branchOnly = !state.branchOnly;
      state.selected = 0; state.expanded = false; state.detailScroll = 0; delete state.status; return;
    }
    if (ctrl && key === 'r' && selected) { state.renaming = { id: selected.id, value: selected.label }; delete state.status; return; }
    if ((!state.searchMode && !ctrl && (key === 'space' || text === ' ')) || (ctrl && key === 'v')) {
      if (selected) { state.expanded = !state.expanded; state.detailScroll = 0; } return;
    }
    if (!ctrl && !state.searchMode && !state.expanded && /^[1-9]$/.test(text)) {
      const index = Number(text) - 1;
      if (resourceItems(state)[index]) { state.selected = index; return 'select'; } return;
    }
    if (!ctrl && !state.searchMode && !state.expanded && (text === 'j' || text === 'k')) { key = text === 'j' ? 'down' : 'up'; text = ''; }
    if (!ctrl && !state.expanded && !state.searchMode && text === '/') { state.searchMode = true; return; }
  }
  if (state.expanded && !ctrl && action && selected?.actions?.includes(action)) { state.confirmation = { id: selected.id, action }; return; }
  if (key === 'escape') {
    if (state.expanded) { state.expanded = false; state.detailScroll = 0; }
    else if (state.query || state.searchMode) { state.query = ''; state.searchMode = false; state.selected = 0; }
    else return 'close';
  } else if (ctrl && key === 'a' && state.kind === 'resume') {
    state.allProjects = !state.allProjects; state.selected = 0; state.expanded = false; state.detailScroll = 0;
  } else if (['left', 'right', 'tab'].includes(key) && state.tabs.length > 1) {
    state.tab = (state.tab + (key === 'left' ? -1 : 1) + state.tabs.length) % state.tabs.length;
    state.selected = 0; state.expanded = false; state.detailScroll = 0;
  } else if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key)) {
    if (state.expanded) {
      const item = resourceItems(state)[state.selected];
      const maximum = Math.max(0, (item?.detail ?? item?.description ?? '').split('\n').length - 1);
      const delta = key === 'up' ? -1 : key === 'pageup' ? -8 : key === 'pagedown' ? 8 : 1;
      state.detailScroll = key === 'home' ? 0 : key === 'end' ? maximum : Math.max(0, Math.min(maximum, (state.detailScroll ?? 0) + delta));
      return;
    }
    const maximum = Math.max(0, resourceItems(state).length - 1);
    const delta = key === 'up' ? -1 : key === 'pageup' ? -8 : key === 'pagedown' ? 8 : 1;
    state.selected = key === 'home' ? 0 : key === 'end' ? maximum : Math.max(0, Math.min(maximum, state.selected + delta));
  } else if (key === 'return' || key === 'enter') {
    if (resourceItems(state)[state.selected]) return 'select';
  } else if (key === 'backspace' && !state.expanded) {
    state.query = deleteLastGrapheme(state.query); state.selected = 0;
  } else if (!state.expanded && !ctrl && text && !/[\u0000-\u001f\u007f]/.test(text)) {
    state.query = Array.from(state.query + text).slice(0, 1024).join(''); state.searchMode = true; state.selected = 0;
  }
}

function deleteLastGrapheme(value: string): string {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].slice(0, -1).map(part => part.segment).join('');
}

export function renderResourceDialog(state: ResourceDialogState, width: number, height: number): string[] {
  const clean = (value: string) => stripAnsi(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '  ');
  const items = resourceItems(state);
  const available = Math.max(1, Math.floor((height - 9) / 2));
  const selected = items[state.selected];
  if (state.renaming) return [state.title, 'Rename conversation', clean(state.renaming.value) || '(empty)', '', 'Enter save · Esc cancel · Ctrl+U clear', ...(state.status ? [clean(state.status)] : [])].map(line => truncateTerminal(line, Math.max(1, width))).slice(0, height);
  if (state.confirmation) {
    const action = state.confirmation.action;
    const warning = action === 'stop' ? (state.confirmation.id.startsWith('mcpwatch_') ? 'Stop this MCP notification connection? No model or tool will be called. Buffered notifications remain in this terminal until exit.' : 'Stop this task? Already completed file edits are not reverted.') : action === 'attach' ? 'Attach this Agent conversation? No model call until you answer or send a prompt.' : 'Connect to this MCP server and discover tools? Stdio may launch a configured process. No tools/call will be sent.';
    return [state.title, `${action.toUpperCase()} · ${clean(state.confirmation.id)}`, '', ...wrapTerminal(warning, Math.max(1, width)), '', state.busy ? 'Operation in progress…' : 'Enter confirm · Esc cancel', ...(state.status ? [clean(state.status)] : [])].map((line) => truncateTerminal(line, width)).slice(0, height);
  }
  const start = Math.max(0, state.selected - available + 1);
  const lines = [
    `${tuiTheme.bold}${state.title}${tuiTheme.reset}`,
    state.tabs.map((tab, index) => index === state.tab ? `[${tab}]` : tab).join('   '),
    `⌕ ${clean(state.query) || 'Search…'}`, '',
  ];
  if (state.expanded && selected) {
    const detailLines = clean(selected.detail ?? selected.description).split('\n');
    const offset = Math.min(state.detailScroll ?? 0, Math.max(0, detailLines.length - 1));
    lines.push(clean(selected.label), ...detailLines.slice(offset, offset + Math.max(1, height - 10)));
  } else if (!items.length) {
    lines.push(state.kind === 'resume' ? `No conversations found ${state.allProjects ? 'across projects' : 'in this project'}.` : 'No items in this view.');
  } else {
    for (let index = start; index < Math.min(items.length, start + available); index++) {
      const item = items[index]!;
      lines.push(`${index === state.selected ? '>' : ' '} ${clean(item.label)}`, `  ${clean(item.description)}`);
    }
  }
  lines.push('', state.expanded ? '↑/↓ scroll · Esc back to list' : `${items.length ? `${state.selected + 1}/${items.length} · ` : ''}↑/↓ move · Enter ${state.kind === 'resume' ? 'resume' : state.kind === 'theme' ? 'apply' : 'details'} · Esc back`);
  lines.push(state.kind === 'resume' ? `Space preview · Ctrl+R rename · Ctrl+A ${state.allProjects ? 'current scope' : 'all projects'}` : `${state.tabs.length > 1 ? '←/→ tabs · ' : ''}Ctrl+R refresh`);
  if (state.kind === 'resume') lines.push('j/k move · 1–9 resume · / search · Ctrl+V preview · Ctrl+L refresh');
  if (state.kind === 'resume' && state.repository) lines.push(`Ctrl+W ${state.allWorktrees ? 'this worktree' : 'all worktrees'} · Ctrl+B ${state.branchOnly ? 'all branches' : 'current branch'}`);
  if (state.expanded && selected?.actions?.length) lines.push(selected.actions.map((action) => ({ stop: 'x stop', attach: 'a attach / answer', inspect: 't test & discover tools' })[action]).join(' · '));
  if (state.status) lines.push(clean(state.status));
  return lines.slice(0, height).map((line) => truncateTerminal(line, Math.max(1, width)));
}
