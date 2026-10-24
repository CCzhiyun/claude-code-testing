import type { PermissionRequestPayload } from '../permissionApprovals.js';
import type { ComponentAction, ComponentModel } from './types.js';
import { tuiTheme, truncateTerminal, wrapTerminal } from '../tui/presentation.js';

export type PermissionChoice = 'allow_once' | 'allow_session' | 'deny';
export interface PermissionDialogState { request: PermissionRequestPayload; selected: number; choices: readonly PermissionChoice[] }
export interface ApprovalDialogState extends PermissionDialogState { type: 'approval'; agentId: string; scroll: number }

const labels: Record<PermissionChoice, string> = { allow_once: 'Yes, allow once (exact arguments)', allow_session: 'Yes, allow this tool + subject for this session', deny: 'No, deny this tool + subject for this session' };

export function navigateApproval(state: ApprovalDialogState, key: string, text = '', ctrl = false): 'render' | 'cancel' | 'submit' {
  if (key === 'escape' || (ctrl && ['c', 'd'].includes(key))) return 'cancel';
  if (ctrl) return 'render';
  if (key === 'up' || key === 'down' || key === 'tab') state.selected = movePermissionSelection(state, key === 'up' ? -1 : 1).selected;
  else if (key === 'pageup') state.scroll = Math.max(0, state.scroll - 6);
  else if (key === 'pagedown') state.scroll += 6;
  else if (/^[1-3]$/.test(text)) state.selected = Math.min(Number(text) - 1, state.choices.length - 1);
  else if (key === 'return' || key === 'enter') return 'submit';
  return 'render';
}

export function renderApprovalDialog(state: ApprovalDialogState, width: number, height: number): string[] {
  const clean = (value: string) => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '  ');
  const line = (value: string) => truncateTerminal(value, Math.max(10, width - 2));
  if (height < 16) return [line(`Permission · ${clean(state.request.tool)}`), line(clean(state.request.subject)),
    ...state.choices.map((choice, index) => line(`${index === state.selected ? '>' : ' '} ${index + 1}. ${labels[choice]}`)),
    line('Enter confirm · Esc dismiss · ↑/↓ select'), line('Enlarge terminal to see the file preview.')].slice(0, height);
  const body = wrapTerminal(clean(state.request.preview ?? JSON.stringify(state.request.input, null, 2)), Math.max(10, width - 4));
  const room = Math.max(1, height - 10 - state.choices.length);
  state.scroll = Math.min(state.scroll, Math.max(0, body.length - room));
  const rows = body.slice(state.scroll, state.scroll + room).map((value) => {
    const color = value.startsWith('+') ? tuiTheme.success : value.startsWith('-') ? tuiTheme.error : tuiTheme.muted;
    return `${color}${line(value)}${tuiTheme.reset}`;
  });
  return [line(`Permission required · ${clean(state.request.tool)}`), line(clean(state.request.subject)), line(clean(state.request.reason)), '', ...rows,
    line(`Preview ${state.scroll + 1}-${Math.min(body.length, state.scroll + room)}/${body.length} · PgUp/PgDn scroll`), '',
    ...state.choices.map((choice, index) => `${index === state.selected ? tuiTheme.selected : tuiTheme.muted}${line(`${index === state.selected ? '>' : ' '} ${index + 1}. ${labels[choice]}`)}${tuiTheme.reset}`), '',
    line('↑/↓ or 1-3 select · Enter confirm · Esc dismiss (no decision)'),
    line('Session scope allows changed arguments for the same subject; policy still applies.'),
  ].slice(0, height);
}

export function permissionChoices(request: PermissionRequestPayload, canRemember = true): readonly PermissionChoice[] {
  return canRemember && !/^mcp_auth$/i.test(request.tool) ? ['allow_once', 'allow_session', 'deny'] : ['allow_once', 'deny'];
}

export function createPermissionDialog(request: PermissionRequestPayload, canRemember = true): PermissionDialogState {
  return { request, selected: 0, choices: permissionChoices(request, canRemember) };
}

export function movePermissionSelection(state: PermissionDialogState, delta: number): PermissionDialogState {
  const selected = (state.selected + (delta < 0 ? -1 : 1) + state.choices.length) % state.choices.length;
  return { ...state, selected };
}

export function permissionDialogModel(state: PermissionDialogState): ComponentModel {
  const actions: ComponentAction[] = state.choices.map((choice) => ({ id: choice, label: labels[choice], tone: choice === 'deny' ? 'danger' : 'success' }));
  return { id: state.request.id, kind: 'permission', title: `${state.request.tool} needs permission`, body: `${state.request.subject}\n${state.request.reason}`, tone: 'warning', selected: state.selected, actions, metadata: { tool: state.request.tool } };
}

export function parsePermissionChoice(value: string, state: PermissionDialogState): PermissionChoice | undefined {
  const normalized = value.trim().toLowerCase();
  if (/^(?:1|y|yes|allow|allow once)$/.test(normalized)) return 'allow_once';
  if (/^(?:2|session|allow session|always)$/.test(normalized) && state.choices.includes('allow_session')) return 'allow_session';
  if (/^(?:2|3|n|no|deny)$/.test(normalized)) return 'deny';
  return undefined;
}
