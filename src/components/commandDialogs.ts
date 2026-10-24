import type { PermissionMode, PlatformConfig } from '../types.js';
import { stripAnsi, terminalWidth } from '../ink.js';
import { truncateTerminal, tuiTheme } from '../tui/presentation.js';
import type { MarketplaceDialogState } from './marketplaceDialog.js';
import type { ResourceDialogState } from './resourceDialog.js';
import type { QuestionDialogState } from './questionDialog.js';
import type { UsageSummary } from '../usage.js';
import type { ApprovalDialogState } from './permissionDialog.js';
import type { PermissionDenial } from '../permissionHistory.js';
import { API_PRESET_LABELS, apiPresetPatch, connectionPresetForModel, nextApiPreset, usesMessagesApi, resolveModelProtocol } from '../modelConnection.js';

export const CONFIG_TABS = ['Settings', 'Status', 'Config', 'Usage', 'Stats'] as const;
export type ConfigTab = typeof CONFIG_TABS[number];
export type ReasoningEffort = PlatformConfig['model']['reasoningEffort'];

export interface ConfigDialogState {
  type: 'config';
  tab: ConfigTab;
  query: string;
  selected: number;
  scroll: number;
  focus?: 'search' | 'rows' | 'tabs';
  draft?: PlatformConfig;
  pending?: Record<string, unknown>;
  editing?: { row: ConfigDialogRow; value: string };
  error?: string;
}

export interface ConfigDialogFacts {
  cwd: string;
  version: string;
  plugins: number;
  skills: number;
  agents: number;
  activeAgents: number;
  tasks: number;
  sessionMessages: number;
  estimatedTokens: number;
  usage?: UsageSummary;
}

export interface ConfigDialogRow {
  id: string;
  label: string;
  value: string | number | boolean;
  description?: string;
  editable?: 'boolean' | 'permission' | 'worktree-base' | 'text' | 'number';
  field?: [string, string];
  patch?: Record<string, unknown>;
}

export interface ModelChoice {
  id: string;
  label: string;
  model: string;
  description: string;
  current: boolean;
  isDefault: boolean;
}

export interface ModelDialogState {
  type: 'model';
  selected: number;
  effort: ReasoningEffort;
  choices: ModelChoice[];
}

export interface EffortDialogState {
  type: 'effort';
  effort: ReasoningEffort;
}

export interface SkillsDialogItem {
  disableModelInvocation?: boolean;
  name: string;
  description: string;
  path: string;
  source: string;
  instructions: string;
  enabled?: boolean;
  mode?: 'auto' | 'manual' | 'disabled';
  visibility?: import('../skills.js').SkillVisibility;
  userInvocable?: boolean;
  argumentHint?: string;
  context?: 'inline' | 'fork';
  locked?: boolean;
}

export interface SkillsDialogState {
  type: 'skills';
  selected: number;
  expanded: boolean;
  skills: SkillsDialogItem[];
  workspaceDirectory?: string;
  query?: string;
  searching?: boolean;
  sort?: 'name' | 'source';
  pending?: Record<string, boolean>;
  pendingModes?: Record<string, 'auto' | 'manual' | 'disabled'>;
  pendingOverrides?: Record<string, import('../skills.js').SkillVisibility>;
  detailScroll?: number;
  status?: string;
}

export const PERMISSION_TABS = ['Mode', 'Allow', 'Ask', 'Deny', 'Directories', 'Recent'] as const;
export type PermissionTab = typeof PERMISSION_TABS[number];

export interface PermissionsDialogState {
  type: 'permissions';
  tab: PermissionTab;
  selected: number;
  adding: boolean;
  input: string;
  query?: string;
  searching?: boolean;
  recent?: PermissionDenial[];
  managedFields?: string[];
}

export type CommandDialogState = ConfigDialogState | ModelDialogState | EffortDialogState | PermissionsDialogState | SkillsDialogState | MarketplaceDialogState | ResourceDialogState | QuestionDialogState | ApprovalDialogState;

const permissionLabel = (mode: PermissionMode): string => ({ normal: 'Default', acceptEdits: 'Accept edits', restricted: 'Plan', bypass: 'Bypass permissions', sandbox: 'Sandbox' } as Record<PermissionMode, string>)[mode];

function technicalConfigRows(config: PlatformConfig): ConfigDialogRow[] {
  return [
    { id: 'autoCompact', label: 'Auto-compact', value: config.ui.autoCompact, editable: 'boolean', patch: { ui: { autoCompact: !config.ui.autoCompact } } },
    { id: 'semanticCompact', label: 'Automatic summary mode (paid if semantic)', value: config.contextCompaction?.mode ?? 'extractive', editable: 'boolean', patch: { contextCompaction: { mode: config.contextCompaction?.mode === 'semantic' ? 'extractive' : 'semantic' } }, description: 'Semantic adds a bounded call to the same model after archiving. Failure falls back to excerpts; manual /compact remains local. Review cost and data policy before enabling.' },
    { id: 'showTips', label: 'Show tips', value: config.ui.showTips, editable: 'boolean', patch: { ui: { showTips: !config.ui.showTips } } },
    { id: 'reduceMotion', label: 'Reduce motion', value: config.ui.reduceMotion, editable: 'boolean', patch: { ui: { reduceMotion: !config.ui.reduceMotion } } },
    { id: 'thinking', label: 'Thinking mode', value: config.model.thinkingEnabled, editable: 'boolean', patch: { model: { thinkingEnabled: !config.model.thinkingEnabled } } },
    { id: 'fast', label: `Fast mode (${sanitizeModelName(config.model.name)})`, value: config.model.fastMode, editable: 'boolean', patch: { model: { fastMode: !config.model.fastMode } } },
    { id: 'sessionRecap', label: 'Session recap', value: config.ui.sessionRecap, editable: 'boolean', patch: { ui: { sessionRecap: !config.ui.sessionRecap } } },
    { id: 'rewindCode', label: 'Rewind code (checkpoints)', value: config.ui.rewindCode, editable: 'boolean', patch: { ui: { rewindCode: !config.ui.rewindCode } } },
    { id: 'verboseOutput', label: 'Verbose output', value: config.ui.verboseOutput, editable: 'boolean', patch: { ui: { verboseOutput: !config.ui.verboseOutput } } },
    { id: 'progress', label: 'Terminal progress bar', value: config.ui.terminalProgressBar, editable: 'boolean', patch: { ui: { terminalProgressBar: !config.ui.terminalProgressBar } } },
    { id: 'duration', label: 'Show turn duration', value: config.ui.showTurnDuration, editable: 'boolean', patch: { ui: { showTurnDuration: !config.ui.showTurnDuration } } },
    { id: 'permission', label: 'Default permission mode', value: permissionLabel(config.policy.mode), editable: 'permission' },
    { id: 'baseRef', label: 'Worktree base ref', value: config.ui.worktreeBaseRef, editable: 'worktree-base', patch: { ui: { worktreeBaseRef: config.ui.worktreeBaseRef === 'fresh' ? 'current' : 'fresh' } } },
    { id: 'autoPlan', label: 'Use auto mode during plan', value: config.ui.useAutoModeDuringPlan, editable: 'boolean', patch: { ui: { useAutoModeDuringPlan: !config.ui.useAutoModeDuringPlan } } },
    { id: 'gitignore', label: 'Respect .gitignore in file picker', value: config.ui.respectGitignore, editable: 'boolean', patch: { ui: { respectGitignore: !config.ui.respectGitignore } } },
    { id: 'marketplace', label: 'Marketplace enabled', value: config.marketplaceEnabled !== false, editable: 'boolean', patch: { marketplaceEnabled: config.marketplaceEnabled === false } },
    { id: 'mcpCredentialBackend', label: 'MCP credential storage', value: config.mcpCredentialBackend ?? 'file', ...(process.platform === 'win32' ? { editable: 'permission' as const } : {}), patch: { mcpCredentialBackend: config.mcpCredentialBackend === 'windows-dpapi' ? 'file' : 'windows-dpapi' }, description: 'Windows user-bound DPAPI; migrate existing tokens with ccpt mcp migrate-credentials.' },
    { id: 'caFile', label: 'Custom CA certificate file (PEM)', value: config.network.caFile ?? '', editable: 'text', field: ['network', 'caFile'] },
    { id: 'apiPreset', label: 'API connection preset (resets URL/auth)', value: API_PRESET_LABELS[connectionPresetForModel(config.model)], editable: 'boolean', patch: { model: apiPresetPatch(nextApiPreset(config.model)) }, description: 'Cycles Messages → Chat (Bearer) → Responses (Bearer) → Azure Chat (api-key) → Azure Responses (api-key). Resets URL/auth; configure the destination and deployment before chatting.' },
    { id: 'apiProtocol', label: 'API protocol (same gateway only)', value: resolveModelProtocol(config.model), editable: 'boolean', patch: { model: { responsesTransport: 'native', apiProtocol: usesMessagesApi(config.model) ? 'chat-completions' : resolveModelProtocol(config.model) === 'responses' ? 'messages' : 'responses' } }, description: 'Keeps the current URL/auth. Only use if the same trusted gateway supports this protocol; otherwise select a connection preset.' },
    { id: 'responsesTransport', label: 'Responses transport', value: config.model.responsesTransport ?? 'native', description: 'native = actual /responses; chat-completions = explicit vendor adapter, not native Responses. Configure a matching endpoint; no automatic fallback.' },
    { id: 'chatToolReasoning', label: 'Chat tools: reasoning compatibility', value: config.model.chatToolReasoning ?? 'preserve', editable: 'boolean', patch: { model: { chatToolReasoning: ({ preserve: 'none', none: 'omit', omit: 'responses-only', 'responses-only': 'preserve' } as const)[config.model.chatToolReasoning ?? 'preserve'] } }, description: 'Cycles preserve / explicit none / omit parameter / require Responses. Applies only to Chat requests with tools; never changes endpoint or removes tools.' },
    { id: 'responsesStore', label: 'Responses: server-side conversation storage', value: config.model.responsesStore === true, editable: 'boolean', patch: { model: { responsesStore: !config.model.responsesStore } }, description: 'Opt-in provider storage and previous_response_id. Off by default; local transcripts are retained independently.' },
    { id: 'apiAuth', label: 'API authentication header', value: config.model.apiKeyHeader ?? 'authorization', editable: 'boolean', patch: { model: { apiKeyHeader: config.model.apiKeyHeader === 'api-key' ? 'x-api-key' : config.model.apiKeyHeader === 'x-api-key' ? 'authorization' : 'api-key', apiKeyPrefix: config.model.apiKeyHeader === 'x-api-key' ? 'Bearer ' : '' } } },
    { id: 'apiKeyEnv', label: 'API key environment variable (not key)', value: config.model.apiKeyEnv ?? '', editable: 'text', field: ['model', 'apiKeyEnv'] },
    { id: 'credentialRef', label: 'Protected model credential reference (not key)', value: config.model.credentialRef ?? '', editable: 'text', field: ['model', 'credentialRef'] },
    { id: 'tokenField', label: 'Completion token limit field', value: config.model.completionTokenField ?? 'max_tokens', editable: 'boolean', patch: { model: { completionTokenField: config.model.completionTokenField === 'max_completion_tokens' ? 'max_tokens' : 'max_completion_tokens' } } },
    { id: 'model', label: 'Default model / Azure deployment', value: sanitizeModelName(config.model.name), editable: 'text', field: ['model', 'name'] },
    { id: 'effort', label: 'Reasoning effort', value: config.model.reasoningEffort },
    { id: 'context', label: 'Maximum context tokens', value: config.model.maxContextTokens, editable: 'number', field: ['model', 'maxContextTokens'] },
    { id: 'output', label: 'Maximum output tokens', value: config.model.maxOutputTokens, editable: 'number', field: ['model', 'maxOutputTokens'] },
    { id: 'modelRetries', label: 'Model transient retries (0 disables)', value: config.modelRetry?.maxRetries ?? 3, editable: 'number', field: ['modelRetry', 'maxRetries'] },
    { id: 'modelRetryWait', label: 'Maximum model retry wait (ms)', value: config.modelRetry?.maxWaitMs ?? 120000, editable: 'number', field: ['modelRetry', 'maxWaitMs'] },
    { id: 'modelRpm', label: 'Model requests per minute (local shared pacing)', value: config.modelRetry?.requestsPerMinute ?? 'not configured', editable: 'number', field: ['modelRetry', 'requestsPerMinute'] },
    { id: 'modelTpm', label: 'Model tokens per minute (estimated local pacing)', value: config.modelRetry?.tokensPerMinute ?? 'not configured', editable: 'number', field: ['modelRetry', 'tokensPerMinute'] },
    { id: 'requestCap', label: 'Team model request budget', value: config.spending?.maxRequests ?? 'not configured', editable: 'number', field: ['spending', 'maxRequests'] },
    { id: 'costCap', label: 'Team cost budget (configured price estimate)', value: config.spending?.maxCostUsd ?? 'not configured' },
    { id: 'pluginLocks', label: 'Require approved plugin version/digest locks', value: config.requirePluginLocks ?? false, editable: 'boolean', patch: { requirePluginLocks: !config.requirePluginLocks } },
    { id: 'pluginSignatures', label: 'Require trusted plugin publisher signatures', value: config.requirePluginSignatures ?? false, editable: 'boolean', patch: { requirePluginSignatures: !config.requirePluginSignatures } },
    { id: 'endpoint', label: 'Complete API endpoint URL', value: config.model.endpointUrl ?? '', editable: 'text', field: ['model', 'endpointUrl'] },
    { id: 'baseUrl', label: 'API base URL (when endpoint empty)', value: config.model.baseUrl ?? '', editable: 'text', field: ['model', 'baseUrl'] },
    { id: 'vim', label: 'Vim input mode', value: config.vimMode, editable: 'boolean', patch: { vimMode: !config.vimMode } },
    { id: 'coordinator', label: 'Coordinator mode', value: config.coordinatorMode, editable: 'boolean', patch: { coordinatorMode: !config.coordinatorMode } },
    { id: 'network', label: 'External network access', value: config.policy.allowNetwork },
    { id: 'tls', label: 'Verify TLS certificates', value: config.network.rejectUnauthorized },
    { id: 'timeout', label: 'Network timeout', value: `${config.network.timeoutMs} ms` },
    { id: 'concurrency', label: 'Maximum concurrent Agents', value: config.agents.maxConcurrent },
    { id: 'isolation', label: 'Default Agent isolation', value: config.agents.defaultIsolation },
    { id: 'cleanup', label: 'Worktree cleanup', value: config.agents.worktreeCleanup },
  ];
}

export function configDialogRows(config: PlatformConfig, tab: ConfigTab, facts: ConfigDialogFacts): ConfigDialogRow[] {
  if (tab === 'Config') return technicalConfigRows(config);
  if (tab === 'Settings') return technicalConfigRows(config).filter((row) => row.editable);
  if (tab === 'Status') return [
    { id: 'version', label: 'Version', value: facts.version }, { id: 'cwd', label: 'Working directory', value: facts.cwd },
    { id: 'model', label: 'Model', value: sanitizeModelName(config.model.name) }, { id: 'permission', label: 'Permission mode', value: permissionLabel(config.policy.mode) },
    { id: 'plugins', label: 'Loaded Plugins', value: facts.plugins }, { id: 'skills', label: 'Loaded Skills', value: facts.skills },
    { id: 'mcp', label: 'Configured MCP servers', value: Object.keys(config.mcpServers).length }, { id: 'hooks', label: 'Configured Hooks', value: config.hooks.length },
  ];
  if (tab === 'Usage') return [
    { id: 'requests', label: 'Session API requests', value: facts.usage?.records ?? 0 },
    { id: 'input', label: 'Cumulative input (cache included in v2)', value: facts.usage?.inputTokens ?? 0 },
    { id: 'output', label: 'Cumulative output tokens', value: facts.usage?.outputTokens ?? 0 },
    { id: 'reasoning', label: 'Reported reasoning (subset of output)', value: facts.usage?.reasoningReportedRecords ? facts.usage.reasoningTokens : 'unavailable' },
    { id: 'reported', label: 'Server-reported tokens', value: facts.usage?.reportedTokens ?? 0 },
    { id: 'estimated', label: 'Estimated usage tokens', value: facts.usage?.estimatedTokens ?? 0 },
    { id: 'unknown', label: 'Unknown-source / legacy tokens', value: facts.usage?.unknownTokens ?? 0 },
    { id: 'cache-read', label: 'Cache read subset', value: facts.usage?.cacheReadTokens ?? 0 },
    { id: 'cache-write', label: 'Cache write subset', value: facts.usage?.cacheWriteTokens ?? 0 },
    { id: 'tokens', label: 'Conversation only (~, excludes system/tools)', value: facts.estimatedTokens },
    { id: 'budget', label: 'Configured context budget (not usage)', value: config.model.maxContextTokens },
    { id: 'cost', label: 'Cost estimate (not provider billing)', value: facts.usage?.records && !facts.usage.unknownCostRecords ? `$${facts.usage.costUsd.toFixed(4)} at configured prices` : 'Unavailable / incomplete; consult endpoint' },
  ];
  return [
    { id: 'agents', label: 'Agent records', value: facts.agents }, { id: 'active', label: 'Active Agents', value: facts.activeAgents },
    { id: 'tasks', label: 'Active tasks', value: facts.tasks }, { id: 'plugins', label: 'Plugins', value: facts.plugins }, { id: 'skills', label: 'Skills', value: facts.skills },
  ];
}

export function filteredConfigRows(config: PlatformConfig, state: ConfigDialogState, facts: ConfigDialogFacts): ConfigDialogRow[] {
  const query = state.query.trim().toLocaleLowerCase();
  return configDialogRows(config, state.tab, facts).filter((row) => !query || `${row.label} ${row.value} ${row.description ?? ''}`.toLocaleLowerCase().includes(query));
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode { const values: PermissionMode[] = ['normal', 'acceptEdits', 'restricted', 'bypass']; return values[(values.indexOf(mode) + 1) % values.length]!; }

export function rowPatch(row: ConfigDialogRow, config: PlatformConfig): Record<string, unknown> | undefined {
  if (row.editable === 'permission') { const mode = nextPermissionMode(config.policy.mode); return { policy: { mode, ...(mode === 'restricted' ? { allowNetwork: false } : {}) } }; }
  return row.patch;
}

function padVisible(value: string, width: number): string { return `${value}${' '.repeat(Math.max(0, width - terminalWidth(value)))}`; }

export function renderConfigDialog(config: PlatformConfig, state: ConfigDialogState, facts: ConfigDialogFacts, width: number, height: number): { lines: string[]; visibleRows: ConfigDialogRow[] } {
  if (state.editing) return { visibleRows: [], lines: [
    `Edit: ${state.editing.row.label}`, '',
    `> ${state.editing.value || '(empty)'}`, '',
    'Enter stage value · Esc discard edit · Ctrl+U clear',
    'Then Enter in the settings list to save all changes.',
    ...(state.error ? [`Error: ${state.error}`] : []),
    ...(state.editing.row.id === 'caFile' ? ['Use an absolute certificate file path. TLS verification stays enabled.'] : []),
  ].map((line) => truncateTerminal(line, width)).slice(0, height) };
  config = state.draft ?? config;
  const rows = filteredConfigRows(config, state, facts);
  const contentWidth = Math.max(42, width - 4);
  // Reserve search/header rows plus the overflow and keyboard-help footer so
  // navigation guidance never disappears on shorter terminals.
  const bodyHeight = Math.max(4, height - 11);
  const maximumScroll = Math.max(0, rows.length - bodyHeight);
  state.scroll = Math.max(0, Math.min(state.scroll, maximumScroll));
  if (state.selected < state.scroll) state.scroll = state.selected;
  if (state.selected >= state.scroll + bodyHeight) state.scroll = state.selected - bodyHeight + 1;
  const visibleRows = rows.slice(state.scroll, state.scroll + bodyHeight);
  const tabs = CONFIG_TABS.map((tab) => tab === state.tab ? `${tuiTheme.selected} ${tab} ${tuiTheme.reset}` : `${tuiTheme.bold} ${tab} ${tuiTheme.reset}`).join(' ');
  const query = state.query || 'Search settings…';
  const searchTone = state.query ? tuiTheme.user : tuiTheme.muted;
  const lines = [
    tabs,
    state.error ? `${tuiTheme.error}${truncateTerminal(state.error, width)}${tuiTheme.reset}` : '',
    `${tuiTheme.border}╭${'─'.repeat(contentWidth + 2)}╮${tuiTheme.reset}`,
    `${tuiTheme.border}│${tuiTheme.reset} ${searchTone}⌕ ${padVisible(truncateTerminal(query, contentWidth - 2), contentWidth - 2)}${tuiTheme.reset} ${tuiTheme.border}│${tuiTheme.reset}`,
    `${tuiTheme.border}╰${'─'.repeat(contentWidth + 2)}╯${tuiTheme.reset}`,
    '',
  ];
  if (!visibleRows.length) lines.push(`${tuiTheme.muted}  No settings match “${state.query}”${tuiTheme.reset}`);
  for (const [index, row] of visibleRows.entries()) {
    const absolute = state.scroll + index;
    const selected = absolute === state.selected && (state.focus ?? 'rows') === 'rows';
    const marker = selected ? (tuiTheme.selected.startsWith('\u001b') ? '>' : '') : ' ';
    const labelWidth = Math.max(24, Math.min(46, Math.floor(contentWidth * 0.52)));
    const raw = `${marker} ${truncateTerminal(row.label, labelWidth).padEnd(labelWidth)} ${String(row.value)}`;
    const suffix = row.editable ? '  ↵' : '';
    lines.push(selected ? `${tuiTheme.selected}${padVisible(truncateTerminal(`${raw}${suffix}`, contentWidth + 2), contentWidth + 2)}${tuiTheme.reset}` : `${tuiTheme.muted}${marker}${tuiTheme.reset} ${tuiTheme.bold}${truncateTerminal(row.label, labelWidth).padEnd(labelWidth)}${tuiTheme.reset} ${String(row.value)}${row.editable ? ` ${tuiTheme.muted}↵${tuiTheme.reset}` : ''}`);
  }
  const below = Math.max(0, rows.length - state.scroll - visibleRows.length);
  if (below) lines.push('', `${tuiTheme.muted}↓ ${below} more below${tuiTheme.reset}`);
  const help = state.focus === 'search' ? 'Type to filter · Enter/↓ select · ↑ tabs · Esc clear/back'
    : state.focus === 'tabs' ? '←/→ tabs · ↓ search · Esc cancel'
    : 'Space change · Enter save · / search · Esc cancel';
  lines.push('', `${tuiTheme.muted}${help}${tuiTheme.reset}`);
  return { lines: lines.slice(0, height).map((line) => truncateTerminal(line, width)), visibleRows };
}

/** Changes are staged in memory; only an explicit save action writes settings. */
export function navigateConfig(state: ConfigDialogState, config: PlatformConfig, facts: ConfigDialogFacts, key: string, text = ''): 'save' | 'close' | undefined {
  if (state.editing) {
    if (key === 'escape') delete state.editing;
    else if (key === 'return' || key === 'enter') {
      const { row, value } = state.editing;
      if (row.editable === 'number' && (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < (row.id === 'modelRetries' ? 0 : 1))) {
        state.error = 'Enter a positive whole number of tokens.'; return;
      }
      if (row.field) stageConfigPatch(state, config, { [row.field[0]]: { [row.field[1]]: row.editable === 'number' ? Number(value) : value.trim() } });
      delete state.editing;
    } else if (key === 'backspace') state.editing.value = [...state.editing.value].slice(0, -1).join('');
    else if (key === 'u' && !text) state.editing.value = '';
    else if (text && !/[\u0000-\u001f\u007f]/.test(text)) state.editing.value += text;
    return;
  }
  state.focus ??= 'search';
  const rows = () => filteredConfigRows(state.draft ?? config, state, facts);
  if (key === 'escape') {
    if (state.focus === 'search') {
      if (state.query) { state.query = ''; state.selected = 0; state.scroll = 0; }
      else state.focus = 'rows';
    } else return 'close';
  } else if (['tab', 'left', 'right'].includes(key)) {
    const index = CONFIG_TABS.indexOf(state.tab);
    state.tab = CONFIG_TABS[(index + (key === 'left' ? -1 : 1) + CONFIG_TABS.length) % CONFIG_TABS.length]!;
    state.selected = 0; state.scroll = 0;
  } else if (state.focus === 'tabs') {
    if (['down', 'return', 'enter'].includes(key)) state.focus = 'search';
  } else if (state.focus === 'search') {
    if (['return', 'enter', 'down'].includes(key)) state.focus = 'rows';
    else if (key === 'up') state.focus = 'tabs';
    else if (key === 'backspace') { state.query = [...state.query].slice(0, -1).join(''); state.selected = 0; }
    else if (text && !/[\u0000-\u001f\u007f]/.test(text)) { state.query += text; state.selected = 0; state.scroll = 0; }
  } else if (key === 'up' || key === 'down') {
    if (key === 'up' && state.selected === 0) state.focus = 'search';
    else state.selected = Math.max(0, Math.min(rows().length - 1, state.selected + (key === 'up' ? -1 : 1)));
  } else if (text === '/') state.focus = 'search';
  else if (key === 'return' || key === 'enter') return 'save';
  else if (key === 'space' || text === ' ') {
    const row = rows()[state.selected];
    if (row?.editable === 'text' || row?.editable === 'number') { state.editing = { row, value: String(row.value) }; return; }
    const patch = row && rowPatch(row, state.draft ?? config);
    if (patch) {
      state.draft ??= structuredClone(config);
      state.pending ??= {};
      // Editable rows only patch top-level scalars or one-level settings groups.
      for (const [name, value] of Object.entries(patch)) {
        const draft = state.draft as unknown as Record<string, unknown>;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          draft[name] = { ...(draft[name] as object), ...value };
          state.pending[name] = { ...(state.pending[name] as object ?? {}), ...value };
        } else { draft[name] = value; state.pending[name] = value; }
      }
    }
  }
}

function stageConfigPatch(state: ConfigDialogState, config: PlatformConfig, patch: Record<string, unknown>): void {
  delete state.error;
  state.draft ??= structuredClone(config);
  state.pending ??= {};
  const draft = state.draft as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(patch)) {
    if (value && typeof value === 'object') {
      draft[name] = { ...(draft[name] as object), ...value };
      state.pending[name] = { ...(state.pending[name] as object ?? {}), ...value };
    } else { draft[name] = value; state.pending[name] = value; }
  }
}

export function sanitizeModelName(value: string): string { return stripAnsi(value).replace(/\[(?:\d+;)*\d*m\]?/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim(); }

export function buildModelChoices(config: PlatformConfig, environmentModels: readonly string[] = []): ModelChoice[] {
  const current = sanitizeModelName(config.model.name) || 'ccpt-model';
  const models = [...new Set([current, ...(config.model.availableModels ?? []), ...environmentModels].map(sanitizeModelName).filter(Boolean))];
  return [
    { id: 'default', label: 'Default (recommended)', model: current, description: `Use the default model (currently ${current})`, current: true, isDefault: true },
    ...models.map((model) => ({ id: `model:${model}`, label: model, model, description: model === current ? 'Current configured model' : 'Compatible configured model', current: model === current, isDefault: false })),
  ];
}

export function cycleEffort(effort: ReasoningEffort, delta: number): ReasoningEffort { const efforts: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']; return efforts[Math.max(0, Math.min(efforts.length - 1, efforts.indexOf(effort) + Math.sign(delta)))]!; }

export function renderModelDialog(state: ModelDialogState, config: PlatformConfig, width: number, height: number): string[] {
  const inner = Math.max(42, width - 4);
  const lines = [
    `${tuiTheme.border}${'─'.repeat(width)}${tuiTheme.reset}`,
    `${tuiTheme.bold}${tuiTheme.accent}Select model${tuiTheme.reset}`,
    ...wrapDescription('Switch between configured models. Your pick becomes the default for new sessions. For other model names, specify with --model.', inner).map((line) => `${tuiTheme.muted}${line}${tuiTheme.reset}`),
    '',
  ];
  const maximumChoices = Math.max(2, height - 12);
  const start = Math.max(0, state.selected - maximumChoices + 1);
  state.choices.slice(start, start + maximumChoices).forEach((choice, offset) => {
    const index = start + offset;
    const selected = index === state.selected;
    const marker = selected && tuiTheme.selected.startsWith('\u001b') ? '>' : ' ';
    const check = choice.current && !choice.isDefault ? ' √' : '';
    const number = `${index + 1}.`;
    const labelWidth = Math.max(22, Math.min(40, Math.floor(inner * 0.38)));
    const raw = `${marker} ${number.padStart(3)} ${truncateTerminal(`${choice.label}${check}`, labelWidth).padEnd(labelWidth)} ${truncateTerminal(choice.description, inner - labelWidth - 7)}`;
    lines.push(selected ? `${tuiTheme.user}${raw}${tuiTheme.reset}` : `${tuiTheme.muted}${marker} ${number.padStart(3)} ${tuiTheme.success}${truncateTerminal(`${choice.label}${check}`, labelWidth).padEnd(labelWidth)}${tuiTheme.reset} ${tuiTheme.muted}${truncateTerminal(choice.description, inner - labelWidth - 7)}${tuiTheme.reset}`);
  });
  lines.push('', `${tuiTheme.accent}●${tuiTheme.reset} ${capitalize(state.effort)} effort${state.effort === 'high' ? ' (default)' : ''} ${tuiTheme.muted}←/→ to adjust${tuiTheme.reset}`);
  if (!config.model.fastMode) lines.push('', `${tuiTheme.muted}Use ${tuiTheme.bold}/fast${tuiTheme.reset}${tuiTheme.muted} to turn on Fast mode.${tuiTheme.reset}`);
  lines.push('', `${tuiTheme.muted}Enter/d to set as default · s to use this session only · Esc to cancel${tuiTheme.reset}`);
  return lines.slice(0, height);
}

export function renderEffortDialog(state: EffortDialogState, width: number, height: number): string[] {
  const efforts: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  const track = efforts.map((effort) => effort === state.effort ? `${tuiTheme.selected} ${capitalize(effort)} ${tuiTheme.reset}` : `${tuiTheme.muted} ${capitalize(effort)} ${tuiTheme.reset}`).join(`${tuiTheme.border} ─ ${tuiTheme.reset}`);
  return [
    `${tuiTheme.border}${'─'.repeat(width)}${tuiTheme.reset}`,
    `${tuiTheme.bold}${tuiTheme.accent}Set effort${tuiTheme.reset}`,
    `${tuiTheme.muted}Control how much reasoning the active model uses for this session.${tuiTheme.reset}`,
    '', track, '',
    `${tuiTheme.muted}←/→ adjust · Enter apply · Esc cancel${tuiTheme.reset}`,
    `${tuiTheme.muted}d to save as default · Provider must support the selected effort${tuiTheme.reset}`,
  ].slice(0, height);
}

export { renderSkillsManager as renderSkillsDialog } from './skillsManager.js';

export function permissionDialogItems(config: PlatformConfig, tab: PermissionTab): string[] {
  if (tab === 'Mode') return ['Default', 'Accept edits', 'Plan', 'Bypass permissions', 'Sandbox'];
  if (tab === 'Allow') return config.policy.permissionRules.allow;
  if (tab === 'Ask') return config.policy.permissionRules.ask;
  if (tab === 'Deny') return config.policy.permissionRules.deny;
  if (tab === 'Recent') return [];
  return config.policy.workspaceRoots;
}

export function permissionModeAt(index: number): PermissionMode | undefined {
  return (['normal', 'acceptEdits', 'restricted', 'bypass', 'sandbox'] as PermissionMode[])[index];
}

export function permissionDialogEntries(config: PlatformConfig, state: PermissionsDialogState): Array<{ value: string; index: number }> {
  const query = (state.query ?? '').trim().toLowerCase();
  const values = state.tab === 'Recent' ? (state.recent ?? []).map((entry) => `${entry.timestamp} [${entry.source}] ${entry.tool}(${entry.subject}) — ${entry.reason}`) : permissionDialogItems(config, state.tab);
  return values.map((value, index) => ({ value, index })).filter((item) => !query || item.value.toLowerCase().includes(query));
}

export function permissionTabLocked(state: PermissionsDialogState): boolean {
  const field = state.tab === 'Mode' ? 'mode' : state.tab === 'Directories' ? 'workspaceRoots' : `permissionRules.${state.tab.toLowerCase()}`;
  return state.tab === 'Recent' || Boolean(state.managedFields?.includes(field));
}

export function renderPermissionsDialog(config: PlatformConfig, state: PermissionsDialogState, width: number, height: number): string[] {
  const items = permissionDialogEntries(config, state);
  const contentWidth = Math.max(42, width - 4);
  const tabs = PERMISSION_TABS.map((tab) => tab === state.tab ? `${tuiTheme.selected} ${tab} ${tuiTheme.reset}` : `${tuiTheme.bold} ${tab} ${tuiTheme.reset}`).join(' ');
  const lines = [
    `${tuiTheme.border}${'─'.repeat(width)}${tuiTheme.reset}`,
    `${tuiTheme.bold}${tuiTheme.accent}Permissions${tuiTheme.reset}`,
    `${tuiTheme.muted}Manage permission modes and project-scoped allow, ask and deny rules.${tuiTheme.reset}`,
    '', tabs, `⌕ ${state.query || 'Search rules…'}${state.searching ? ' [typing]' : ''}`,
    `${tuiTheme.muted}${state.tab === 'Recent' ? 'Recent denials in this workspace · read only · newest first' : permissionTabLocked(state) ? 'Managed by your administrator · this tab is read only' : state.managedFields?.length ? 'Managed policy active; administrator settings take precedence.' : 'Project settings · administrator policy takes precedence'}${tuiTheme.reset}`,
  ];
  if (!items.length && !state.adding) lines.push(`${tuiTheme.muted}  No ${state.tab.toLowerCase()} entries.${tuiTheme.reset}`);
  const count = Math.max(1, height - (state.adding ? 17 : 12));
  const start = Math.max(0, state.selected - count + 1);
  items.slice(start, start + count).forEach((item, offset) => {
    const index = start + offset;
    const activeMode = state.tab === 'Mode' && permissionModeAt(item.index) === config.policy.mode;
    const marker = index === state.selected && tuiTheme.selected.startsWith('\u001b') ? '>' : ' ';
    const raw = `${marker} ${(index + 1).toString().padStart(2)}. ${truncateTerminal(item.value, contentWidth - 10)}${activeMode ? ' √' : ''}`;
    lines.push(index === state.selected ? `${tuiTheme.selected}${raw}${tuiTheme.reset}` : `${tuiTheme.muted}${raw}${tuiTheme.reset}`);
  });
  if (state.adding) {
    lines.push('', `${tuiTheme.border}╭${'─'.repeat(contentWidth + 2)}╮${tuiTheme.reset}`,
      `${tuiTheme.border}│${tuiTheme.reset} ${tuiTheme.user}+ ${padVisible(truncateTerminal(state.input || `Add ${state.tab.toLowerCase()} entry…`, contentWidth - 2), contentWidth - 2)}${tuiTheme.reset} ${tuiTheme.border}│${tuiTheme.reset}`,
      `${tuiTheme.border}╰${'─'.repeat(contentWidth + 2)}╯${tuiTheme.reset}`);
  }
  const help = state.searching ? 'Type to filter · Enter/↓ select · Esc clear/back' : permissionTabLocked(state) ? '←/→/tab switch · ↑/↓ move · Ctrl+R refresh · Esc close' : state.tab === 'Mode'
    ? '←/→/tab switch · ↑/↓ move · Enter select · Esc close'
    : state.adding ? 'Type entry · Enter save · Esc cancel' : '←/→/tab switch · ↑/↓ move · a add · d delete · Esc close';
  lines.push('', `${tuiTheme.muted}${help}${tuiTheme.reset}`, `${items.length} entries · / search · PageUp/PageDown scroll`);
  return lines.slice(0, height).map((line) => truncateTerminal(line, width));
}

function capitalize(value: string): string { return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`; }
function wrapDescription(value: string, width: number): string[] { const words = value.split(/\s+/); const lines: string[] = []; let line = ''; for (const word of words) { if (line && terminalWidth(`${line} ${word}`) > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; } if (line) lines.push(line); return lines; }
