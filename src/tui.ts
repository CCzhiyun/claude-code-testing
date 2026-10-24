import { emitKeypressEvents, type Key } from 'node:readline';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { assertManagedPolicyPatch, loadConfig, managedPermissionFields, modelConfigSource, validateConfig } from './config.js';
import { readCaCertificates } from './network.js';
import { cancelAgent, continueAgent, listAgents, loadAgent, spawnAgent, waitForAgent, type AgentStreamUpdate } from './agent.js';
import { assertSessionIdle, compactSession, forkSession, listSessions, loadSession, saveSession, renameSession } from './sessions.js';
import { resolveSessionReference } from './sessionStartup.js';
import { sessionOwner, sessionResumeCommand } from './sessionRecovery.js';
import { sessionGitIdentity } from './sessionGit.js';
import { managedModelFields } from './config.js';
import { exportSession } from './sessionExport.js';
import { formatContextSnapshot, formatContextPressure, contextMessages, type ContextPressureNotice } from './contextBudget.js';
import { modelDiagnostics } from './modelDiagnostics.js';
import { listMemory, setMemory } from './memory.js';
import { configuredMcpServers, inspectMcpServer } from './mcp.js';
import { McpWatchTasks, activeMcpWatch, mcpWatchItem } from './mcpWatchTasks.js';
import { agentResourceItem, refreshResourceGroups } from './components/resourceDialog.js';
import { projectAgent, projectShellOutput, stopProjectTask } from './taskManagement.js';
import { projectStateDir, resolveWorkspacePath } from './paths.js';
import { readJson, writeJson } from './storage.js';
import { executeCommand } from './policy.js';
import type { AgentRecord, ContentBlock, PermissionMode, PlatformConfig, SessionRecord } from './types.js';
import { expandCommand, loadPlatform, type PlatformRegistry, type RegisteredCommand } from './platform.js';
import { initializePlatform, installFoundationPlugin } from './scaffold.js';
import { inspectGitConflicts, listWorktreeRecoveries, mergeWorktree, removeWorktree } from './worktree.js';
import { installVsCodeExtension } from './ide-install.js';
import { runHooks } from './hooks.js';
import { claimTask, listTasks } from './tasks.js';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './checkpoints.js';
import { discoverTeam, readTeamMailbox, sendTeamMessage, broadcastTeamMessage, requestTeamShutdown } from './mailbox.js';
import { userInvocableSkill } from './skills.js';
import { invokeUserSkill } from './skillInvocation.js';
import { createTeam, listTeams, loadTeam, deleteTeam } from './teamStore.js';
import { loadUserBindings } from './keybindings/loadUserBindings.js';
import { KeybindingResolver } from './keybindings/resolver.js';
import { VimController } from './vim/transitions.js';
import { getOutputStyleDirStyles } from './outputStyles/loadOutputStylesDir.js';
import { NATIVE_COMMANDS, resolveNativeCommand } from './commands/catalog.js';
import { localWorkflow } from './commands/localWorkflows.js';
import { BRAINSTORM_INSTRUCTIONS, BRAINSTORM_TOOLS } from './commands/brainstorm.js';
import { createQuestionDialog, navigateQuestion, questionAnswer, renderQuestionDialog } from './components/questionDialog.js';
import { usageInsights, listUsage, summarizeUsage, formatUsageSummary } from './usage.js';
import { countModelText } from './textTokenizer.js';
import { listArtifacts } from './artifacts.js';
import { listChannels } from './channels.js';
import { activeSessionGoal, cancelWakeup, listWakeups, listRoutineRuns, listRoutines, listSessionGoals, setSessionGoal, transitionSessionGoal } from './automation.js';
import { notifyLifecycle } from './lifecycleNotifications.js';
import { startHookFileWatch } from './hookFileWatch.js';
import {listGoalWorkflows} from './goalManagement.js';
import {inspectGoalWorkflow} from './goalWorkflow.js';
import {createGoalPrepareDialog,createGoalDecisionDialog,completeGoalDialog} from './components/goalRunDialog.js';
import {createConflictDialog,completeConflictDialog,createConflictRestoreDialog} from './components/conflictDialog.js';
import { listProjectNotifications, markProjectNotificationsRead } from './notifications.js';
import { exportDiagnosticBundle } from './diagnosticBundle.js';
import { applyTuiTheme, renderPromptBox, renderTranscriptEntry, renderWelcome, stripAnsi, truncateTerminal, wrapTerminal, tuiTheme, type TranscriptEntry } from './tui/presentation.js';
import { deletePromptGrapheme, movePromptCursor } from './tui/terminalText.js';
import { renderIdleHint, renderPromptPalette, renderShortcutHelp } from './components/promptExperience.js';
import { denyPermissionForSession, grantPermissionForSession, grantPermissionOnce, parsePermissionRequest, resetSessionPermissions } from './permissionApprovals.js';
import { listPermissionDenials, recordPermissionDenial } from './permissionHistory.js';
import { modelCredentialNames } from './environment.js';
import { parseSimpleCommand } from './tools/shellParsing.js';
import { loadSurfaceRegistry, surfaceHealth } from './integrations/surfaces.js';
import { activeFileMention, applyFileSuggestion, listWorkspaceFiles, PasteStore, suggestFiles } from './components/promptInput.js';
import { createPermissionDialog, navigateApproval, parsePermissionChoice, renderApprovalDialog } from './components/permissionDialog.js';
import { listThemes, type ThemeName } from './components/theme.js';
import { searchTranscript } from './components/transcript.js';
import { appendPromptHistory, clearPromptHistory, loadPromptHistory, nextPromptHistoryScope, type PromptHistoryScope } from './components/promptHistory.js';
import { editPromptExternally } from './components/externalEditor.js';
import { captureClipboardImage, type ClipboardImage } from './components/clipboardImage.js';
import { getShellTaskOutput, listShellTasks, startShellTask, stopShellTask } from './tasks/LocalShellTask/LocalShellTask.js';
import { checkRecordingAvailability } from './services/voice.js';
import { buildModelChoices, CONFIG_TABS, configDialogRows, cycleEffort, filteredConfigRows, PERMISSION_TABS, permissionDialogItems, permissionModeAt, renderConfigDialog, renderEffortDialog, renderModelDialog, renderPermissionsDialog, renderSkillsDialog, rowPatch, type CommandDialogState, type ConfigDialogFacts, type ConfigTab } from './components/commandDialogs.js';
import { commandSubmissionForEnter } from './components/paletteSelection.js';
import { renderWorkspaceTrustDialog, type WorkspaceTrustDialogState } from './components/trustDialog.js';
import { ensureProjectClaudeInstructions, ensureProjectSettings, ensureUserClaudeInstructions, ensureUserSettings, isWorkspaceTrusted, trustWorkspace, userSettingsPath } from './workspaceTrust.js';
import { createProjectPlan, listPlanRecords, loadProjectPlan, transitionProjectPlan } from './plans.js';
import { watchLocalState, projectStateWatchPaths, extensionStateWatchPaths, extensionAuthorityWatchPaths } from './localStateWatch.js';
import { DeferredStateReload } from './deferredStateReload.js';
import { executeProjectPlan, recoverProjectPlanExecution } from './planExecution.js';
import { addMarketplace, ensureOfficialMarketplace, installMarketplacePlugin, listMarketplacePlugins, listMarketplaces, marketplaceErrors, refreshMarketplace, removeMarketplace, scheduleMarketplaceAutoUpdate, setMarketplaceAutoUpdate, uninstallMarketplacePlugin, updateMarketplacePlugin } from './marketplace.js';
import { MARKETPLACE_TABS, isMarketplaceRefreshKey, marketplaceDetailActions, marketplaceDialogItems, renderMarketplaceDialog } from './components/marketplaceDialog.js';
import { renderLiveAgentActivity } from './components/liveAgentActivity.js';
import type { RuntimeEvent } from './runtimeEvents.js';
import { navigateConfig } from './components/commandDialogs.js';
import { navigateResource, renderResourceDialog, resourceItems, sameWorkspace, sessionItems, type ResourceDialogState } from './components/resourceDialog.js';
import { sessionTranscript } from './components/sessionTranscript.js';
import { navigateSkills, skillSettingsPatch } from './components/skillsManager.js';
import { permissionDialogEntries, permissionTabLocked } from './components/commandDialogs.js';

const ESC = '\u001b[';
export interface TuiInitialSession { sessionId?: string; fork: boolean; picker?: boolean; query?: string; allowActive?: boolean; modelOverride?: boolean; effortOverride?: boolean }
const color = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  cyan: `${ESC}38;5;45m`,
  orange: `${ESC}38;5;209m`,
  blue: `${ESC}38;5;111m`,
  green: `${ESC}38;5;84m`,
  yellow: `${ESC}38;5;220m`,
  red: `${ESC}38;5;203m`,
  gray: `${ESC}38;5;245m`,
  selected: `${ESC}48;5;238m${ESC}38;5;255m`,
};

interface ChatLine extends TranscriptEntry { eventId?: string }

interface PaletteCommand {
  name: string;
  description: string;
  argument?: string;
  kind?: 'command' | 'file' | 'history' | 'checkpoint' | 'model';
}

const legacyBuiltInCommands: PaletteCommand[] = [
  { name: '/add-dir', description: 'Add a permitted working directory', argument: '<path>' },
  { name: '/agent', description: 'List or run a specialized Agent', argument: '[name] [goal]' },
  { name: '/agents', description: 'Inspect, attach, wait, cancel, merge or clean Agent tasks', argument: '[attach|wait|cancel|merge|cleanup] [id]' },
  { name: '/background', description: 'Start a background agent', argument: '<goal>' },
  { name: '/branch', description: 'Fork the current conversation', argument: '[goal]' },
  { name: '/clear', description: 'Start a fresh conversation' },
  { name: '/checkpoint', description: 'Create or list recoverable code checkpoints', argument: '[list|file ...]' },
  { name: '/compact', description: 'Compact the active conversation context' },
  { name: '/config', description: 'Show the complete active configuration' },
  { name: '/context', description: 'Show active session context usage' },
  { name: '/coordinator', description: 'Enable or disable coordinator-only orchestration', argument: '[on|off]' },
  { name: '/copy', description: 'Copy the latest response to the terminal clipboard' },
  { name: '/diff', description: 'Show the current Git diff summary' },
  { name: '/doctor', description: 'Environment checks and redacted model errors', argument: '[errors [1–100]|export <file>]' },
  { name: '/endpoint', description: 'Show or set the model API endpoint', argument: '[url]' },
  { name: '/endpoint-url', description: 'Show or set a complete model request URL', argument: '[url]' },
  { name: '/effort', description: 'Adjust model reasoning effort', argument: '[low|medium|high|xhigh|max|auto]' },
  { name: '/exit', description: 'Close CCPT' },
  { name: '/export', description: 'Export full conversation including archived history', argument: '[path.md|path.json]' },
  { name: '/focus', description: 'Toggle outcome-focused conversation view' },
  { name: '/help', description: 'Show keyboard and command help' },
  { name: '/hooks', description: 'Show active lifecycle Hooks' },
  { name: '/init', description: 'Initialize the extension workspace' },
  { name: '/ide', description: 'Install the bundled VS Code extension', argument: 'install' },
  { name: '/max-context', description: 'Show or set the model context budget', argument: '[tokens]' },
  { name: '/mcp', description: 'List configured MCP servers' },
  { name: '/memory', description: 'List persistent memory keys', argument: '[scope]' },
  { name: '/mode', description: 'Show or set the permission mode', argument: '[normal|sandbox|restricted|bypass]' },
  { name: '/model', description: 'Show or set the active model', argument: '[name]' },
  { name: '/plugin', description: 'Manage Plugins and Marketplaces', argument: '[install|update|uninstall|enable|disable|marketplace]' },
  { name: '/permissions', description: 'Show or set the permission mode', argument: '[mode]' },
  { name: '/output-style', description: 'List or select an output style', argument: '[name]' },
  { name: '/reload', description: 'Reload Plugins, Skills, Agents, Hooks and MCP' },
  { name: '/reload-plugins', description: 'Reload the complete extension registry' },
  { name: '/reload-skills', description: 'Reload the complete extension registry' },
  { name: '/rename', description: 'Rename the active session', argument: '<title>' },
  { name: '/rewind', description: 'Restore a checkpoint', argument: '[checkpoint-id] [conversation]' },
  { name: '/resume', description: 'Browse or resume a saved session', argument: '[session-id-or-name]' },
  { name:'/replay',description:'Inspect captured runtime events without tool execution',argument:'[session-id] [cursor] [--include-text]' },
  { name: '/sessions', description: 'List resumable sessions' },
  { name: '/skills', description: 'List reusable skills' },
  { name: '/status', description: 'Show the active agent status' },
  { name: '/tasks', description: 'List and manage background Agent tasks' },
  { name: '/notifications', description: 'Inspect local notifications; acknowledge only a selected current version' },
  { name: '/team', description: 'Discover or message Agent teammates', argument: '[members|inbox|send <agent-id> <message>]' },
  { name: '/usage', description: 'Show context and activity statistics' },
  { name: '/vim', description: 'Enable or disable Vim input mode', argument: '[on|off]' },
  { name: '/worktree', description: 'Start an isolated worktree agent', argument: '<goal>' },
];

// The shared catalog is the canonical command surface for the TUI and SDK
// compatibility layer. Keep the legacy literal as a development-time parity
// assertion until command execution is split out of TerminalApp.
const builtInCommands: PaletteCommand[] = NATIVE_COMMANDS.flatMap(({ name, description, argument, aliases }) =>
  [name, ...(aliases ?? [])].map(entry => ({ name: entry, description: entry === name ? description : `${description} (alias of ${name})`, ...(argument ? { argument } : {}) })));
if (legacyBuiltInCommands.some((legacy) => !builtInCommands.some((current) => current.name === legacy.name))) throw new Error('Native command catalog is missing a legacy TUI command handler.');

function truncate(value: string, width: number): string {
  return truncateTerminal(value, width);
}

function wrap(value: string, width: number): string[] {
  return wrapTerminal(value, width);
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function diagnosticEntry(error: unknown, prefix = ''): ChatLine {
  const raw = error instanceof Error ? error.stack ?? error.message : String(error);
  const summary = error instanceof Error ? error.message : raw.split(/\r?\n/, 1)[0] || 'Unknown error';
  return { role: 'error', text: `${prefix}${summary}`, ...(raw !== summary || prefix ? { detail: `${prefix}${raw}` } : {}) };
}

function modelRequestDetail(config: PlatformConfig, durationMs: number): string {
  return [
    `Model: ${config.model.name}`,
    `Provider: ${config.model.provider}`,
    `Reasoning effort: ${config.model.reasoningEffort}`,
    `Thinking: ${config.model.thinkingEnabled ? 'enabled' : 'disabled'}`,
    `Fast mode: ${config.model.fastMode ? 'enabled' : 'disabled'}`,
    `Context window: ${config.model.maxContextTokens} tokens`,
    `Maximum output: ${config.model.maxOutputTokens} tokens`,
    `Endpoint: ${config.model.endpointUrl ?? config.model.baseUrl ?? 'not configured'}`,
    `Elapsed: ${(durationMs / 1_000).toFixed(1)}s`,
  ].join('\n');
}

function permissionModeLabel(mode: PermissionMode): string {
  return ({ normal: 'default', acceptEdits: 'acceptEdits', restricted: 'plan', bypass: 'bypassPermissions', sandbox: 'sandbox' } as Record<PermissionMode, string>)[mode];
}

function parsePermissionMode(value: string): PermissionMode | undefined {
  return ({ default: 'normal', normal: 'normal', acceptedits: 'acceptEdits', plan: 'restricted', restricted: 'restricted', bypasspermissions: 'bypass', bypass: 'bypass', sandbox: 'sandbox' } as Record<string, PermissionMode>)[value.toLowerCase()];
}

async function patchProjectSettings(cwd: string, patch: Record<string, unknown>): Promise<PlatformConfig> {
  const path = join(projectStateDir(cwd), 'settings.json');
  const settings = await readJson<Record<string, unknown>>(path, {});
  const current = await loadConfig(cwd);
  if (patch.policy && typeof patch.policy === 'object') assertManagedPolicyPatch(current, patch.policy as Record<string, unknown>);
  const next = { ...settings };
  const candidate = structuredClone(current) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const previous = (settings[key] ?? {}) as Record<string, unknown>;
    next[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...previous, ...(value as Record<string, unknown>) } : value;
    candidate[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...(candidate[key] as object), ...value } : value;
  }
  validateConfig(candidate as unknown as PlatformConfig);
  const modelPatch = patch.model as Record<string, unknown> | undefined;
  if (modelPatch && ('endpointUrl' in modelPatch || 'baseUrl' in modelPatch)) {
    const model = (candidate as unknown as PlatformConfig).model;
    if (!model.endpointUrl && !model.baseUrl) throw new Error('Set the new API endpoint URL before saving the connection preset.');
  }
  const ca = (patch.network as { caFile?: string } | undefined)?.caFile;
  if (ca) await readCaCertificates(resolve(cwd, ca));
  await runHooks(current, 'ConfigChange', { path, keys: Object.keys(patch) }, cwd);
  await writeJson(path, next);
  return loadConfig(cwd);
}

class TerminalApp {
  readonly #cwd: string;
  readonly #version: string;
  #input = '';
  #shortcutHelp = false;
  #cursor = 0;
  #selected = 0;
  #messages: ChatLine[] = [];
  #working = false;
  #activeAgentId: string | undefined;
  #resumedSessionId: string | undefined;
  #config?: PlatformConfig;
  #platform?: PlatformRegistry;
  #history: string[] = [];
  #historyIndex = -1;
  #scrollOffset = 0;
  #spinner = 0;
  #timer?: NodeJS.Timeout;
  #resolve?: () => void;
  #closed = false;
  #focus = false;
  #verboseTranscript = false;
  #sessionPermissionMode: PermissionMode | undefined;
  #planMode = false;
  #keybindings?: KeybindingResolver;
  #vim = new VimController();
  #queuedInputs: string[] = [];
  #seenSessionEvents = new Set<string>();
  #workingStartedAt = 0;
  #lastInterruptAt = 0;
  #workspaceFiles: string[] = [];
  #historySearch = false;
  #historyScope: PromptHistoryScope = 'project';
  readonly #historySessionKey = `terminal-${process.pid}-${Date.now()}`;
  #sessionHistory: string[] = [];
  #stashedPrompt = '';
  #showTasks = false;
  #taskPanelLines: string[] = [];
  #lastTaskRefreshAt = 0;
  #lastEscapeAt = 0;
  #lastKillAgentsAt = 0;
  #rewindChoices: PaletteCommand[] = [];
  #dialog: CommandDialogState | undefined;
  #dialogFacts: ConfigDialogFacts;
  #sessionModel: { name: string; effort: PlatformConfig['model']['reasoningEffort']; thinkingEnabled?: boolean } | undefined;
  #monitorToken: symbol | undefined;
  #shellMonitorToken: symbol | undefined;
  #activeShellTaskId: string | undefined;
  #liveStream: AgentStreamUpdate | undefined;
  #liveTaskLines: string[] = [];
  #lastLiveTaskRefreshAt = 0;
  #liveTaskRefreshPending = false;
  #imageSequence = 0;
  readonly #images = new Map<number, ClipboardImage>();
  #nativeCursorRow = 0;
  #welcomeCommitted = false;
  readonly #committedMessages = new WeakSet<ChatLine>();
  readonly #pastes = new PasteStore();
  #trustDialog: WorkspaceTrustDialogState | undefined;
  #workspaceLoading = false;
  #workspaceReady = false;
  #workspaceError: string | undefined;
  #marketplaceUpdateTimer: NodeJS.Timeout | undefined;
  readonly #mcpWatches = new McpWatchTasks();

  #pickerFork = false;
  #attachmentToken: symbol | undefined;
  #stopProjectWatch: (() => void) | undefined;
  #stopExtensionWatch: (() => void) | undefined;
  #stopHookFileWatch:(()=>void)|undefined;
  #extensionReload: DeferredStateReload | undefined;
  #teamRefreshPending = false;
  #teamRefreshing = false;
  #platformReloads = 0;
  #reviewedPlanVersions = new Map<string, number>();
  constructor(cwd: string, version: string, private readonly initialSession?: TuiInitialSession) {
    this.#cwd = cwd;
    this.#version = version;
    this.#dialogFacts = { cwd, version, plugins: 0, skills: 0, agents: 0, activeAgents: 0, tasks: 0, sessionMessages: 0, estimatedTokens: 0 };
  }

  async start(): Promise<void> {
    applyTuiTheme();
    await Promise.all([ensureUserSettings(), ensureUserClaudeInstructions()]);
    if (!(await isWorkspaceTrusted(this.#cwd))) this.#trustDialog = { selected: 0 };
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    // Stay in the terminal's main screen. Completed messages can then enter
    // native scrollback and remain reachable through the window scrollbar or
    // a two-finger trackpad gesture.
    process.stdout.write(`${ESC}?7l${ESC}?25h`);
    process.stdin.on('keypress', this.#onKeypress);
    process.stdout.on('resize', this.#render);
    this.#timer = setInterval(() => {
      void this.#extensionReload?.flush();
      if (this.#teamRefreshPending && !this.#teamRefreshing) void this.#refreshTeamResources();
      if (this.#working) { this.#spinner += 1; this.#render(); }
      if (this.#working && this.#activeAgentId && Date.now() - this.#lastLiveTaskRefreshAt > 500) void this.#refreshLiveTasks();
      if (this.#showTasks && Date.now() - this.#lastTaskRefreshAt > 1_000) void this.#refreshTaskPanel().then(() => { if (!this.#working) this.#render(); });
    }, 120);
    const closed = new Promise<void>((resolvePromise) => { this.#resolve = resolvePromise; });
    this.#render();
    if (!this.#trustDialog) await this.#attemptWorkspaceInitialization(false);
    await closed;
    await this.#mcpWatches.close();
  }

  async #attemptWorkspaceInitialization(persistTrust: boolean): Promise<void> {
    this.#workspaceError = undefined;
    try {
      await this.#initializeWorkspace();
      if(this.#config?.pluginRollout?.checkOnStartup)void(await import('./pluginRollout.js')).checkPluginRollouts(this.#cwd).catch(()=>{});
      if (!this.#stopProjectWatch) this.#stopProjectWatch = watchLocalState(projectStateWatchPaths(this.#cwd), () => { this.#teamRefreshPending = true; }, { recursive: true });
      if (persistTrust) await trustWorkspace(this.#cwd);
      if (this.#config?.marketplaceEnabled !== false&&!this.#config?.pluginRollout&&!this.#config?.usePluginSets) void ensureOfficialMarketplace(this.#cwd).catch(() => { /* /plugin surfaces catalog errors without blocking startup. */ });
      if (this.#config?.marketplaceEnabled !== false&&!this.#config?.pluginRollout&&!this.#config?.usePluginSets && !this.#marketplaceUpdateTimer) this.#marketplaceUpdateTimer = scheduleMarketplaceAutoUpdate(this.#cwd, (result) => {
        if (this.#closed || (!result.refreshed.length && !result.errors.length)) return;
        const summary = result.updated.length
          ? `Plugin auto-update downloaded ${result.updated.length} update(s). Run /reload-plugins to activate them in this session.`
          : `Plugin marketplaces auto-updated: ${result.refreshed.join(', ')}.`;
        this.#messages.push({ role: result.errors.length ? 'error' : 'system', text: `${summary}${result.errors.length ? `\n${result.errors.map((item) => `${item.source}: ${item.message}`).join('\n')}` : ''}` });
        this.#render();
      });
    } catch (error) {
      this.#workspaceLoading = false;
      this.#workspaceReady = false;
      this.#workspaceError = error instanceof Error ? error.message : String(error);
      this.#render();
    }
  }

  async #refreshTeamResources(): Promise<void> {
    if (this.#closed || this.#working || this.#teamRefreshing) return;
    this.#teamRefreshing = true;
    try {
        const dialog = this.#dialog;
        if (dialog?.type === 'resource' && dialog.kind === 'notifications' && !dialog.busy && !dialog.confirmation && !dialog.searchMode) {
          this.#teamRefreshPending=false;
          const page=await listProjectNotifications(this.#cwd,{offset:dialog.notificationOffset ?? 0,limit:100});
          if (this.#closed || this.#working || this.#dialog!==dialog || dialog.searchMode) {this.#teamRefreshPending=true;return;}
          refreshResourceGroups(dialog,[page.items.map(item=>({id:item.id,label:item.title,description:`${item.readAt ? 'read' : 'unread'} · ${item.level}`,detail:`${item.createdAt}\n\n${item.body}\n\nViewing does not mark read.\n/notifications read ${item.id} ${page.version}${page.nextOffset===null ? '' : `\nOlder: /notifications ${page.nextOffset}`}`}))]);
          dialog.status='Notifications refreshed without marking read or granting permission.';
          this.#render();
        }
        if (dialog?.type === 'resource' && dialog.kind === 'teams' && !dialog.busy && !dialog.confirmation && !dialog.searchMode && !dialog.renaming) {
          this.#teamRefreshPending = false;
          const [plans, agents] = await Promise.all([listPlanRecords(this.#cwd), listAgents()]);
          if (this.#closed || this.#dialog !== dialog || dialog.busy) { this.#teamRefreshPending = true; return; }
          const active = agents.find(agent => agent.id === this.#activeAgentId);
          const teamSessionId = active ? active.teamSessionId ?? active.sessionId : undefined;
          const members = agents.filter(agent => (agent.teamSessionId ?? agent.sessionId) === teamSessionId);
          const memberIds = new Set(members.map(member => member.id));
          const teamPlans = plans.filter(plan => plan.planningAgentId && memberIds.has(plan.planningAgentId));
          const teams = (await listTeams()).filter(team => team.cwd === this.#cwd);
          const [tasks, inbox] = active ? await Promise.all([listTasks(teamSessionId), readTeamMailbox({ teamSessionId: teamSessionId!, agentId: active.id, unreadOnly: false, markRead: false })]) : [[], []];
          if (this.#closed || this.#working || this.#dialog !== dialog || dialog.busy || dialog.confirmation || dialog.searchMode || dialog.renaming) { this.#teamRefreshPending = true; return; }
          refreshResourceGroups(dialog, dialog.groups.map((group, index) => {
            if (dialog.tabs[index] === 'Members' && active) return members.map(agentResourceItem);
            if (dialog.tabs[index] === 'Teams') return teams.map(team => ({ id: team.id, label: team.name, description: team.ownerAgentId, detail: `${stringify(team)}\nStart or resume its lead conversation to manage members.` }));
            if (dialog.tabs[index] === 'Tasks' && active) return tasks.map(task => ({ id: task.id, label: `${task.status} · ${task.title}`, description: task.ownerAgentId ?? 'unclaimed', detail: stringify(task) }));
            if (dialog.tabs[index] === 'Inbox' && active) return inbox.map(message => ({ id: message.id, label: `${message.read ? 'read' : 'unread'} · ${message.kind}`, description: message.fromAgentId, detail: `${message.content}\n\nAgent data only; not a human authorization.` }));
            if (dialog.tabs[index] === 'Plans' && active) return teamPlans.map(plan => ({ id: plan.id, label: `${plan.status} · v${plan.version} · ${plan.title}`, description: plan.planningAgentId ?? '', detail: `${plan.content}\n\nVersion: ${plan.version}\n/plan approve ${plan.id} --expected-version ${plan.version} --background\nRead and review this version before deciding. Background refresh does not approve it.` }));
            return group;
          }));
          dialog.status = 'Members/plans/tasks/inbox refreshed. Selection preserved by ID; no messages marked read or approval-version receipts advanced.';
          this.#render();
        }
    } catch {
      this.#teamRefreshPending = false;
      if (!this.#closed && this.#dialog?.type === 'resource' && ['teams','notifications'].includes(this.#dialog.kind)) { this.#dialog.status = 'State refresh failed; explicitly reload before acting. No messages, notifications or approvals were changed.'; this.#render(); }
    }
    finally { this.#teamRefreshing = false; }
  }

  async #initializeWorkspace(): Promise<void> {
    if (this.#workspaceReady || this.#workspaceLoading) return;
    this.#workspaceLoading = true;
    this.#render();
    // Normal entry only creates project settings. Project CLAUDE.md is an
    // explicit /init action; the automatically initialized CLAUDE.md is the
    // user file beside ~/.ccpt/settings.json.
    await ensureProjectSettings(this.#cwd);
    await Promise.all([
      this.#reloadPlatform(false),
      listWorkspaceFiles(this.#cwd).then((files) => { this.#workspaceFiles = files; }),
      loadPromptHistory({ cwd: this.#cwd, sessionKey: this.#historySessionKey, scope: 'project' }).then((history) => { this.#history = history; }),
    ]);
    const source = await modelConfigSource(this.#cwd);
    const virtualSource = source === 'built-in defaults' || source === 'process environment';
    const relativeSource = virtualSource ? source : relative(this.#cwd, source);
    const sourceLabel = virtualSource ? source : relativeSource && !relativeSource.startsWith('..') ? relativeSource : source === userSettingsPath() ? `~${sep}.ccpt${sep}settings.json` : source;
    this.#messages.push({ role: 'system', text: `Using ${this.#config?.model.name ?? 'not configured'} (from ${sourceLabel}) · /model to change` });
    if (this.#config?.model.provider === 'anthropic' && !(this.#config.model.apiKeyEnv && process.env[this.#config.model.apiKeyEnv]) && !Object.keys(this.#config.model.headersFromEnvironment ?? {}).length && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY && !process.env.CCPT_API_KEY) {
      this.#messages.push({ role: 'question', text: `Model credential is not configured. Set CCPT_API_KEY in your environment, or configure model.apiKeyEnv in ${userSettingsPath()}, then use /reload.` });
    }
    this.#workspaceLoading = false;
    this.#workspaceReady = true;
    if (this.initialSession?.sessionId) {
      if (this.initialSession.fork || this.initialSession.allowActive === false) await assertSessionIdle(this.initialSession.sessionId);
      const source = await loadSession(this.initialSession.sessionId);
      if (!sameWorkspace(source.cwd, this.#cwd)) throw new Error('Resumed session belongs to another workspace');
      await this.#attachSession(this.initialSession.fork ? (await forkSession(source.id)).id : source.id);
    }
    if (this.initialSession?.picker) {
      await this.#openResumePicker(this.initialSession.query);
      this.#pickerFork = this.initialSession.fork;
    }
    this.#render();
  }

  #palette(): PaletteCommand[] {
    if (this.#rewindChoices.length) return this.#rewindChoices;
    if (this.#historySearch) return [...this.#history].reverse().filter((item) => !this.#input || item.toLowerCase().includes(this.#input.toLowerCase())).slice(0, 12).map((item) => ({ name: item, description: `History · ${this.#historyScope}`, kind: 'history' as const }));
    const mention = activeFileMention(this.#input, this.#cursor);
    if (mention) return suggestFiles(this.#workspaceFiles, mention.query).map(({ path }) => ({ name: `@${path}`, description: 'Workspace file', kind: 'file' as const }));
    if (!this.#input.startsWith('/') || this.#input.includes(' ')) return [];
    const query = this.#input.toLowerCase();
    const available = this.#commands();
    const direct = available.filter((command) => command.name.startsWith(query));
    const related = available.filter((command) => !direct.includes(command) && command.description.toLowerCase().includes(query.slice(1)));
    return [...direct, ...related].map((item) => ({ ...item, kind: 'command' as const }));
  }

  #commands(): PaletteCommand[] {
    const extensions = (this.#platform?.commands ?? []).map((command) => ({
      name: command.name,
      description: `${command.description}  [${command.plugin}]`,
      argument: '[arguments]',
    }));
    const skills = (this.#platform?.skills ?? []).filter(userInvocableSkill).map((skill) => ({
      name: `/${skill.name}`,
      description: `${skill.description}  [${skill.plugin ?? skill.source}]`,
      argument: skill.argumentHint ?? '[request]',
    }));
    const names = new Set(builtInCommands.map((command) => command.name));
    const dynamic = [...extensions, ...skills].filter((command) => {
      if (names.has(command.name)) return false;
      names.add(command.name);
      return true;
    });
    return [...builtInCommands, ...dynamic].sort((a, b) => a.name.localeCompare(b.name));
  }

  async #reloadPlatform(announce = true): Promise<void> {
    this.#platformReloads++;
    try {
    const platform = await loadPlatform(this.#cwd);
    if (this.#sessionModel) {
      const managed = managedModelFields();
      platform.config.model = { ...platform.config.model, ...(!managed.includes('name') ? { name: this.#sessionModel.name } : {}), ...(!managed.includes('reasoningEffort') ? { reasoningEffort: this.#sessionModel.effort } : {}), ...(!managed.includes('thinkingEnabled') ? { thinkingEnabled: this.#sessionModel.thinkingEnabled ?? true } : {}) };
    }
    if (this.#sessionPermissionMode && !managedPermissionFields().includes('mode')) platform.config.policy = { ...platform.config.policy, mode: this.#sessionPermissionMode };
    const bindings = await loadUserBindings(this.#cwd);
    this.#extensionReload?.setPaths(extensionStateWatchPaths(platform.config));
    this.#platform = platform;
    this.#config = platform.config;
    this.#stopHookFileWatch?.();this.#stopHookFileWatch=startHookFileWatch(this.#config,this.#cwd,{}, {active:()=>!this.#working&&!this.#closed});
    this.#mcpWatches.reconcile(this.#config);
    this.#keybindings = bindings;
    if (announce) {
      const { plugins, skills, agents, commands: extensionCommands, diagnostics } = this.#platform;
      this.#messages.push({ role: 'system', text: `✓ Reloaded ${plugins.length} Plugins · ${skills.length} Skills · ${agents.length} Agents · ${extensionCommands.length} commands · ${Object.keys(this.#config.mcpServers).length} MCP servers` });
      if (diagnostics.length) {
        const errors = diagnostics.filter((item) => item.severity === 'error').length;
        const warnings = diagnostics.length - errors;
        this.#messages.push({
          role: 'system',
          text: `Plugin diagnostics: ${errors} errors · ${warnings} warnings`,
          detail: diagnostics.map((item) => `${item.severity.toUpperCase()} · ${item.component} · ${item.source}\n${item.message}`).join('\n\n'),
        });
      }
    }
    } finally { this.#platformReloads--; }
  }

  #chatLines(width: number): string[] {
    const output: string[] = [];
    const visible = this.#focus ? this.#messages.filter((message) => ['user', 'assistant', 'error', 'question'].includes(message.role)) : this.#messages;
    for (const message of visible) {
      output.push(...renderTranscriptEntry(message, width, { verbose: this.#verboseTranscript }));
      output.push('');
    }
    return output;
  }

  #liveActivityLines(width: number, spinner: string): string[] {
    const stream = this.#liveStream;
    if (!this.#working || !stream) return [];
    return renderLiveAgentActivity(stream, width, spinner, Date.now(), this.#liveTaskLines);
  }

  #clearDynamicOutput(): string {
    const moveToStart = this.#nativeCursorRow > 0 ? `${ESC}${this.#nativeCursorRow}A` : '';
    this.#nativeCursorRow = 0;
    return `\r${moveToStart}${ESC}J`;
  }

  #paintNative(staticLines: readonly string[], dynamicLines: readonly string[], cursorRow = Math.max(0, dynamicLines.length - 1), cursorColumn = 1): void {
    const width = Math.max(50, (process.stdout.columns ?? 100) - 1);
    const clean = (line: string): string => `${truncate(line, width)}${ESC}K`;
    const stable = staticLines.map(clean);
    const dynamic = (dynamicLines.length ? dynamicLines : ['']).map(clean);
    let output = `${ESC}?25l${this.#clearDynamicOutput()}`;
    if (stable.length) output += `${stable.join('\r\n')}\r\n`;
    output += dynamic.join('\r\n');
    const safeCursorRow = Math.max(0, Math.min(dynamic.length - 1, cursorRow));
    const moveUp = dynamic.length - 1 - safeCursorRow;
    if (moveUp > 0) output += `${ESC}${moveUp}A`;
    output += `\r${ESC}${Math.max(1, cursorColumn)}G${ESC}?25h`;
    this.#nativeCursorRow = safeCursorRow;
    process.stdout.write(output);
  }

  #newStaticLines(width: number): string[] {
    const lines: string[] = [];
    if (this.#workspaceReady && !this.#welcomeCommitted) {
      lines.push(...renderWelcome(this.#version, this.#config?.model.name ?? 'not configured', this.#cwd, width), '');
      this.#welcomeCommitted = true;
    }
    for (const message of this.#messages) {
      if (this.#committedMessages.has(message)) continue;
      lines.push(...renderTranscriptEntry(message, width), '');
      this.#committedMessages.add(message);
    }
    return lines;
  }

  #render = (): void => {
    if (this.#closed) return;
    if (this.#config) this.#mcpWatches.reconcile(this.#config);
    const width = Math.max(50, (process.stdout.columns ?? 100) - 1);
    const height = Math.max(18, process.stdout.rows ?? 30);
    if (this.#trustDialog) {
      this.#paintNative([], renderWorkspaceTrustDialog(this.#cwd, this.#trustDialog, width, height), 0, 1);
      return;
    }
    const config = this.#config;
    const palette = this.#palette();
    if (this.#selected >= palette.length) this.#selected = Math.max(0, palette.length - 1);
    const paletteHeight = palette.length ? Math.min(palette.length + 2, Math.max(4, Math.floor(height * 0.32))) : 0;
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][this.#spinner % 10];
    const mode = permissionModeLabel(config?.policy.mode ?? 'normal');
    if (this.#workspaceError) {
      this.#paintNative([], [
        `${tuiTheme.error}× Workspace initialization failed${tuiTheme.reset}`,
        `${tuiTheme.muted}${truncate(this.#workspaceError, width)}${tuiTheme.reset}`,
        '',
        `${tuiTheme.muted}Enter to retry · Esc to exit${tuiTheme.reset}`,
      ], 3, 1);
      return;
    }
    if (this.#workspaceLoading || !this.#workspaceReady) {
      this.#paintNative([], [`${tuiTheme.muted}Initializing ${join(projectStateDir(this.#cwd), 'settings.json')}…${tuiTheme.reset}`]);
      return;
    }
    const staticLines = this.#newStaticLines(width);
    if (this.#dialog && config) {
      const availableHeight = Math.max(8, height - 2);
      const dialogLines = this.#dialog.type === 'config'
        ? renderConfigDialog(config, this.#dialog, this.#dialogFacts, width, availableHeight).lines
        : this.#dialog.type === 'model' ? renderModelDialog(this.#dialog, config, width, availableHeight)
        : this.#dialog.type === 'effort' ? renderEffortDialog(this.#dialog, width, availableHeight)
        : this.#dialog.type === 'skills' ? renderSkillsDialog(this.#dialog, width, availableHeight)
        : this.#dialog.type === 'marketplace' ? renderMarketplaceDialog(this.#dialog, width, availableHeight)
        : this.#dialog.type === 'resource' ? renderResourceDialog(this.#dialog, width, availableHeight)
        : this.#dialog.type === 'question' ? renderQuestionDialog(this.#dialog, width, availableHeight)
        : this.#dialog.type === 'approval' ? renderApprovalDialog(this.#dialog, width, availableHeight)
        : renderPermissionsDialog(config, this.#dialog, width, availableHeight);
      this.#paintNative(staticLines, dialogLines.slice(0, height));
      return;
    }
    const elapsed = this.#working ? Math.max(0, Math.floor((Date.now() - this.#workingStartedAt) / 1_000)) : 0;
    const hint = this.#working
      ? `${spinner} Working… (${elapsed}s · esc interrupt · ctrl+b background)${this.#queuedInputs.length ? ` · ${this.#queuedInputs.length} queued` : ''}`
      : this.#verboseTranscript ? 'Transcript · ↑/↓ scroll · PageUp/PageDown · Ctrl+O/Esc close'
        : this.#historySearch ? `ctrl+r older · ctrl+s scope:${this.#historyScope} · tab accept · esc close`
        : renderIdleHint(mode, config?.model.reasoningEffort ?? 'auto', width, [config?.vimMode ? `VIM:${this.#vim.state.mode}` : '', this.#focus ? 'Focus' : '', config?.model.fastMode ? 'Fast' : '']);
    const prompt = renderPromptBox(this.#input, this.#cursor, width, hint);
    const taskLines = this.#showTasks ? this.#taskPanelLines.slice(0, Math.max(2, Math.floor(height * 0.22))) : [];
    const paletteLines = this.#shortcutHelp ? renderShortcutHelp(width) : renderPromptPalette(palette, this.#selected, width, paletteHeight);
    if (this.#verboseTranscript) {
      const allChat = this.#chatLines(width);
      const transcriptHeight = Math.max(3, height - 2);
      const chatEnd = Math.max(0, allChat.length - this.#scrollOffset);
      const chat = allChat.slice(Math.max(0, chatEnd - transcriptHeight), chatEnd);
      this.#paintNative(staticLines, [...chat, `${tuiTheme.muted}Transcript · ↑/↓ scroll · PageUp/PageDown · Ctrl+O/Esc close${tuiTheme.reset}`]);
      return;
    }
    const taskOutput = taskLines.map((line) => `${tuiTheme.muted}${truncate(line, width)}${tuiTheme.reset}`);
    const liveOutput = this.#liveActivityLines(width, spinner ?? '✻');
    const dynamic = [...taskOutput, ...liveOutput, ...prompt.lines, ...paletteLines].slice(-height);
    const promptStart = Math.max(0, dynamic.length - paletteLines.length - prompt.lines.length);
    this.#paintNative(staticLines, dynamic, promptStart + prompt.cursorRow, prompt.cursorColumn);
  };

  #insert(value: string): void {
    this.#input = `${this.#input.slice(0, this.#cursor)}${value}${this.#input.slice(this.#cursor)}`;
    this.#cursor += value.length;
    this.#selected = 0;
  }

  #onKeypress = (text: string, key: Key): void => {
    if (this.#trustDialog) { void this.#handleWorkspaceTrustKey(text, key); return; }
    if (!this.#workspaceReady) {
      if (key.name === 'escape' || (key.ctrl && (key.name === 'c' || key.name === 'd'))) this.#close();
      else if (this.#workspaceError && (key.name === 'return' || key.name === 'enter' || text === '\r')) void this.#attemptWorkspaceInitialization(false);
      return;
    }
    if (this.#dialog) { void this.#handleDialogKey(text, key).catch((error) => { this.#dialog = undefined; this.#messages.push(diagnosticEntry(error)); this.#render(); }); return; }
    if (this.#config?.vimMode && !key.ctrl && !key.meta && (this.#vim.state.mode === 'NORMAL' || key.name === 'escape')) {
      const vimInput = key.name === 'escape' ? 'escape' : text || key.name || '';
      const edited = this.#vim.handle(vimInput, this.#input, this.#cursor);
      if (edited.handled) {
        this.#input = edited.text;
        this.#cursor = edited.cursor;
        this.#selected = 0;
        this.#render();
        return;
      }
    }
    const resolved = this.#keybindings?.resolve(text, key, ['Chat']);
    if (resolved?.type === 'chord_started' || resolved?.type === 'unbound') { this.#render(); return; }
    const action = key.sequence === '\u001b[Z' ? 'permission:cycleMode' : resolved?.type === 'match' ? resolved.action : undefined;
    if (this.#shortcutHelp) {
      this.#shortcutHelp = false;
      if (key.name === 'escape' || action === 'chat:submit' || text === '?') { this.#render(); return; }
    } else if (!action && text === '?' && !this.#input && !this.#historySearch && !this.#verboseTranscript && !key.ctrl && !key.meta) {
      this.#shortcutHelp = true; this.#render(); return;
    }
    if (this.#verboseTranscript && key.name === 'escape') { this.#verboseTranscript = false; this.#scrollOffset = 0; this.#render(); return; }
    if (action === 'app:exit') { this.#close(); return; }
    if (action === 'app:redraw') { this.#render(); return; }
    if (action === 'app:toggleTasks') { void this.#toggleTaskPanel(); return; }
    if (action === 'task:background') { void this.#backgroundActiveTask(); return; }
    if (action === 'chat:interrupt' && key.name === 'escape') { void this.#escape(); return; }
    if (action === 'chat:interrupt') { void this.#interrupt(); return; }
    if (action === 'chat:cancel') { this.#cancelInput(); this.#render(); return; }
    if (action === 'chat:newline') { this.#insert('\n'); this.#render(); return; }
    if (action === 'chat:externalEditor') { void this.#openExternalEditor(); return; }
    if (action === 'chat:imagePaste') { void this.#pasteImage(); return; }
    if (action === 'chat:modelPicker') { this.#openModelPicker(); return; }
    if (action === 'chat:thinkingToggle') { void this.#toggleThinking(); return; }
    if (action === 'chat:fastMode') { void this.#toggleFastMode(); return; }
    if (action === 'chat:killAgents') { void this.#killBackgroundAgents(); return; }
    if (action === 'chat:stash') { if (this.#historySearch) void this.#cycleHistoryScope(); else this.#stashPrompt(); return; }
    if (action === 'transcript:toggle') { this.#verboseTranscript = !this.#verboseTranscript; this.#scrollOffset = 0; this.#render(); return; }
    if (action === 'permission:cycleMode') { void this.#cyclePermissionMode(); return; }
    if (action === 'history:search') {
      if (this.#historySearch) { const matches = this.#palette(); if (matches.length) this.#selected = (this.#selected + 1) % matches.length; }
      else { this.#historySearch = true; this.#selected = 0; }
      this.#render(); return;
    }
    if (action === 'transcript:search') { this.#input = '/search '; this.#cursor = this.#input.length; this.#selected = 0; this.#render(); return; }
    if (action === 'file:search') { this.#input = '@'; this.#cursor = 1; this.#selected = 0; this.#render(); return; }
    if (action?.startsWith('command:')) {
      const command = `/${action.slice('command:'.length)}`;
      this.#history.push(command);
      void this.#submit(command);
      this.#render();
      return;
    }
    const palette = this.#palette();
    if (action === 'history:previous') {
      if (this.#verboseTranscript && !palette.length) this.#scrollOffset += 1;
      else if (palette.length) this.#selected = (this.#selected - 1 + palette.length) % palette.length;
      else if (this.#history.length) { this.#historyIndex = Math.min(this.#history.length - 1, this.#historyIndex + 1); this.#input = this.#history[this.#history.length - 1 - this.#historyIndex] ?? ''; this.#cursor = this.#input.length; }
    } else if (action === 'history:next') {
      if (this.#verboseTranscript && !palette.length) this.#scrollOffset = Math.max(0, this.#scrollOffset - 1);
      else if (palette.length) this.#selected = (this.#selected + 1) % palette.length;
      else if (this.#historyIndex >= 0) { this.#historyIndex -= 1; this.#input = this.#historyIndex >= 0 ? this.#history[this.#history.length - 1 - this.#historyIndex] ?? '' : ''; this.#cursor = this.#input.length; }
    } else if (action === 'transcript:pageUp') this.#scrollOffset += Math.max(3, Math.floor((process.stdout.rows ?? 24) / 2));
    else if (action === 'transcript:pageDown') this.#scrollOffset = Math.max(0, this.#scrollOffset - Math.max(3, Math.floor((process.stdout.rows ?? 24) / 2)));
    else if (action === 'chat:left') this.#cursor = movePromptCursor(this.#input, this.#cursor, -1);
    else if (action === 'chat:right') this.#cursor = movePromptCursor(this.#input, this.#cursor, 1);
    else if (action === 'chat:home') this.#cursor = 0;
    else if (action === 'chat:end') this.#cursor = this.#input.length;
    else if (action === 'chat:backspace' || action === 'chat:delete') {
      const edited = deletePromptGrapheme(this.#input, this.#cursor, action === 'chat:backspace');
      this.#input = edited.text; this.#cursor = edited.cursor;
    }
    else if (action === 'autocomplete:accept') {
      const selected = palette[this.#selected];
      const command = (key.name === 'return' || key.name === 'enter' || text === '\r') ? commandSubmissionForEnter(this.#input, selected) : undefined;
      if (command) {
        this.#input = ''; this.#cursor = 0; this.#selected = 0; this.#historyIndex = -1;
        void this.#recordAndSubmit(command);
      } else if (selected?.kind === 'file') {
        const mention = activeFileMention(this.#input, this.#cursor);
        if (mention) { const applied = applyFileSuggestion(this.#input, mention, selected.name.slice(1)); this.#input = applied.text; this.#cursor = applied.cursor; }
      } else if (selected?.kind === 'history') { this.#input = selected.name; this.#cursor = this.#input.length; this.#historySearch = false; }
      else if (selected?.kind === 'checkpoint') { this.#input = selected.name; this.#cursor = this.#input.length; this.#rewindChoices = []; }
      else if (selected) { this.#input = `${selected.name}${selected.argument ? ' ' : ''}`; this.#cursor = this.#input.length; }
    } else if (action === 'chat:submit') {
      const selected = palette[this.#selected];
      const command = commandSubmissionForEnter(this.#input, selected);
      if (command) {
        this.#input = ''; this.#cursor = 0; this.#selected = 0; this.#historyIndex = -1;
        void this.#recordAndSubmit(command);
      } else if (selected?.kind === 'file') {
        const mention = activeFileMention(this.#input, this.#cursor);
        if (mention) { const applied = applyFileSuggestion(this.#input, mention, selected.name.slice(1)); this.#input = applied.text; this.#cursor = applied.cursor; }
      } else if (selected?.kind === 'history') {
        this.#input = selected.name;
        this.#cursor = this.#input.length;
        this.#historySearch = false;
        const submitted = this.#input.trim();
        this.#input = ''; this.#cursor = 0; this.#selected = 0;
        if (submitted) void this.#recordAndSubmit(submitted);
      } else if (selected?.kind === 'checkpoint') {
        const submitted = selected.name;
        this.#rewindChoices = []; this.#selected = 0;
        void this.#recordAndSubmit(submitted);
      } else if (selected && this.#input !== selected.name && !this.#input.includes(' ')) {
        this.#input = `${selected.name}${selected.argument ? ' ' : ''}`;
        this.#cursor = this.#input.length;
      } else {
        const submitted = this.#input.trim();
        this.#input = '';
        this.#cursor = 0;
        this.#selected = 0;
        this.#historyIndex = -1;
        if (submitted) {
          if (submitted.endsWith('\\')) { this.#input = `${submitted.slice(0, -1)}\n`; this.#cursor = this.#input.length; }
          else void this.#recordAndSubmit(submitted);
        }
      }
    } else if (!action && !key.ctrl && !key.meta && text) this.#insert(this.#pastes.capture(text).display);
    this.#render();
  };

  async #handleWorkspaceTrustKey(text: string, key: Key): Promise<void> {
    const dialog = this.#trustDialog;
    if (!dialog) return;
    if (key.name === 'escape' || text === '\u001b' || (key.ctrl && (key.name === 'c' || key.name === 'd'))) { this.#close(); return; }
    if (key.name === 'up' || key.name === 'down' || key.name === 'tab') {
      dialog.selected = dialog.selected === 0 ? 1 : 0;
      this.#render();
      return;
    }
    if (text === '1') dialog.selected = 0;
    else if (text === '2') dialog.selected = 1;
    else if (key.name !== 'return' && key.name !== 'enter' && text !== '\r') { this.#render(); return; }
    if (text === '1' || text === '2') { this.#render(); return; }
    if (dialog.selected === 1) { this.#close(); return; }
    this.#trustDialog = undefined;
    await this.#attemptWorkspaceInitialization(true);
  }

  #cancelInput(): void {
    this.#input = '';
    this.#cursor = 0;
    this.#selected = 0;
    this.#historySearch = false;
    this.#rewindChoices = [];
    this.#dialog = undefined;
  }

  async #recordAndSubmit(value: string): Promise<void> {
    this.#sessionHistory.push(value);
    this.#history.push(value);
    await appendPromptHistory({ cwd: this.#cwd, sessionKey: this.#historySessionKey, text: value });
    await this.#submit(this.#pastes.expand(value));
  }

  #stashPrompt(): void {
    if (this.#input) {
      this.#stashedPrompt = this.#input;
      this.#input = '';
      this.#cursor = 0;
      this.#messages.push({ role: 'system', text: 'Prompt stashed. Press Ctrl+S on an empty prompt to restore it.' });
    } else if (this.#stashedPrompt) {
      this.#input = this.#stashedPrompt;
      this.#stashedPrompt = '';
      this.#cursor = this.#input.length;
    } else this.#messages.push({ role: 'system', text: 'No stashed prompt.' });
    this.#render();
  }

  async #cycleHistoryScope(): Promise<void> {
    this.#historyScope = nextPromptHistoryScope(this.#historyScope);
    this.#history = this.#historyScope === 'session'
      ? [...this.#sessionHistory]
      : await loadPromptHistory({ cwd: this.#cwd, sessionKey: this.#historySessionKey, scope: this.#historyScope });
    this.#selected = 0;
    this.#render();
  }

  async #openExternalEditor(): Promise<void> {
    const previous = [...this.#messages].reverse().find((message) => message.role === 'assistant')?.text;
    process.stdin.setRawMode?.(false);
    process.stdout.write(`${color.reset}${this.#clearDynamicOutput()}${ESC}?25h${ESC}?7h`);
    try {
      this.#input = await editPromptExternally(this.#input, { cwd: this.#cwd, ...(process.env.CCPT_EDITOR_INCLUDE_LAST_RESPONSE === '1' && previous ? { previousResponse: previous } : {}) });
      this.#cursor = this.#input.length;
    } catch (error) {
      this.#messages.push(diagnosticEntry(error, 'External editor: '));
    } finally {
      process.stdout.write(`${ESC}?7l${ESC}?25h`);
      process.stdin.setRawMode?.(true);
      this.#render();
    }
  }

  async #pasteImage(): Promise<void> {
    try {
      const image = await captureClipboardImage(this.#cwd);
      const id = ++this.#imageSequence;
      this.#images.set(id, image);
      this.#insert(`[Image #${id}]`);
    } catch (error) {
      this.#messages.push(diagnosticEntry(error, 'Image paste: '));
    }
    this.#render();
  }

  #promptContent(value: string): ContentBlock[] | undefined {
    const ids = [...value.matchAll(/\[Image #(\d+)\]/g)].map((match) => Number(match[1])).filter((id) => this.#images.has(id));
    if (!ids.length) return undefined;
    return [
      { type: 'text', text: value },
      ...ids.map((id): ContentBlock => {
        const image = this.#images.get(id)!;
        return { type: 'image', media_type: image.mediaType, data: image.data };
      }),
    ];
  }

  async #openConfigDialog(tab: ConfigTab = 'Config'): Promise<void> {
    await this.#refreshDialogFacts();
    this.#dialog = { type: 'config', tab, query: '', selected: 0, scroll: 0, focus: 'search' };
    this.#rewindChoices = [];
    this.#render();
  }

  #openResource(kind: ResourceDialogState['kind'], title: string, tabs: string[], groups: ResourceDialogState['groups']): void {
    this.#dialog = { type: 'resource', kind, title, tabs, groups, tab: 0, query: '', selected: 0, expanded: false, cwd: this.#cwd, allProjects: false };
    this.#rewindChoices = [];
    this.#render();
  }

  async #openResumePicker(query = ''): Promise<void> {
    this.#pickerFork = false;
    const [sessions, agents, git] = await Promise.all([listSessions(), listAgents(), sessionGitIdentity(this.#cwd)]);
    const directories = [...new Set(sessions.filter(session => !session.git).map(session => session.cwd))].slice(0, 16);
    const identities = new Map<string, Awaited<ReturnType<typeof sessionGitIdentity>>>();
    for (let start = 0; start < directories.length; start += 4) await Promise.all(directories.slice(start, start + 4).map(async directory => identities.set(directory, await sessionGitIdentity(directory))));
    const items = sessionItems(sessions.map(session => {
      const known = identities.get(session.cwd);
      return !session.git && known ? { ...session, git: { repository: known.repository, worktree: known.worktree } } : session;
    }), agents);
    this.#openResource('resume', 'Resume session', ['Conversations'], [items]);
    if (this.#dialog?.type === 'resource') {
      this.#dialog.query = query; this.#dialog.searchMode = Boolean(query);
      if (git) { this.#dialog.repository = git.repository; if (git.branch) this.#dialog.currentBranch = git.branch; }
    }
  }

  async #restoreSessionPreferences(session: SessionRecord, owner?: AgentRecord): Promise<void> {
    const saved = session.resume;
    if (owner ? owner.planMode || owner.pendingPlanId : saved?.planMode) this.#planMode = true;
    if (saved?.modelName && !this.initialSession?.modelOverride) {
      this.#sessionModel = { name: saved.modelName, effort: this.initialSession?.effortOverride ? this.#config!.model.reasoningEffort ?? 'high' : saved.effort ?? this.#config!.model.reasoningEffort ?? 'high', thinkingEnabled: this.initialSession?.effortOverride ? this.#config!.model.thinkingEnabled : saved.thinkingEnabled ?? this.#config!.model.thinkingEnabled };
      await this.#reloadPlatform(false);
    }
  }

  async #currentSession(): Promise<SessionRecord | undefined> {
    const id = this.#activeAgentId ? (await loadAgent(this.#activeAgentId)).sessionId : this.#resumedSessionId;
    return id ? loadSession(id) : undefined;
  }

  async #attachSession(id: string): Promise<void> {
    if (this.#working) throw new Error('Finish or background the current task before resuming a conversation.');
    const session = await loadSession(id);
    // Never silently execute a restored conversation in another workspace.
    if (!sameWorkspace(session.cwd, this.#cwd)) {
      const command = sessionResumeCommand(session);
      this.#messages.push({ role: 'system', text: `This conversation belongs to a different workspace. Your current session is unchanged.\nRun in PowerShell to resume with the destination's trust/settings checks:\n${command}\nNo worker or tools were started.` });
      return;
    }
    const owner = sessionOwner(session, await listAgents());
    if (owner) {
      await this.#attachAgent(owner.id);
      this.#messages.push({ role: 'system', text: `Resumed: ${session.title}\nSession: ${session.id}\nNo new model request has been sent by attaching.` });
      return;
    }
    await this.#restoreSessionPreferences(session);
    this.#monitorToken = undefined;
    this.#activeAgentId = undefined;
    this.#resumedSessionId = session.id;
    this.#liveStream = undefined;
    this.#seenSessionEvents.clear();
    this.#messages = sessionTranscript(session);
    await this.#syncSession(session, false);
    this.#messages.push({ role: 'system', text: `Resumed: ${session.title}\nSession: ${session.id}\nEnter your next prompt to continue. No model request has been sent.` });
    this.#scrollOffset = 0;
  }

  async #attachAgent(id: string): Promise<void> {
    if (this.#working) throw new Error('Finish or background the foreground task before attaching another Agent.');
    const agent = await projectAgent(this.#cwd, id);
    if (['queued', 'working'].includes(agent.status) && this.initialSession?.allowActive === false) throw new Error('This launch has session overrides. Attach without overrides to inspect the running worker; no prompt was sent.');
    const session = await loadSession(agent.sessionId);
    if (!sameWorkspace(session.cwd, agent.cwd) && (!agent.worktree || !sameWorkspace(session.cwd, agent.worktree))) throw new Error('Agent session workspace does not match its record.');
    const owner = sessionOwner(session, await listAgents());
    if (owner && owner.id !== agent.id && ['queued', 'working', 'waiting_for_input'].includes(owner.status)) throw new Error('Another active Agent owns this session; attach its owner instead.');
    await this.#restoreSessionPreferences(session, agent);
    this.#monitorToken = undefined; this.#resumedSessionId = undefined; this.#activeAgentId = agent.id;
    this.#liveStream = undefined; this.#seenSessionEvents.clear(); this.#messages = sessionTranscript(session);
    await this.#syncSession(session, false);
    this.#messages.push({ role: 'system', text: `Attached Agent ${agent.id} (${agent.status}). No model request sent.\n${agent.worktree ? `Changes remain in ${agent.worktree}.` : 'Enter an answer or next prompt to continue.'}` });
    this.#dialog = undefined;
    if (agent.status === 'waiting_for_input') this.#showPendingInput(agent);
    if (['queued', 'working'].includes(agent.status)) void this.#observeAttachedAgent(agent.id);
    this.#scrollOffset = 0;
  }

  async #observeAttachedAgent(id: string): Promise<void> {
    const token = Symbol(id); this.#attachmentToken = token;
    this.#working = true; this.#workingStartedAt = Date.now();
    try { await this.#monitorAgent(id, true); }
    catch (error) { if (this.#attachmentToken === token) this.#messages.push(diagnosticEntry(error)); }
    finally {
      if (this.#attachmentToken === token) {
        this.#attachmentToken = undefined; this.#working = false; this.#liveStream = undefined; this.#liveTaskLines = [];
        this.#render();
        const record = await loadAgent(id).catch(() => undefined);
        if (record?.status === 'completed' && this.#activeAgentId === id && !this.#working && !this.#closed) {
          const next = this.#queuedInputs.shift();
          if (next && !this.#closed) queueMicrotask(() => { void this.#submit(next); });
        }
      }
    }
  }

  async #refreshDialogFacts(): Promise<void> {
    const agents = await listAgents();
    const activeAgents = agents.filter((agent) => resolve(agent.cwd) === resolve(this.#cwd) && ['queued', 'working', 'waiting_for_input'].includes(agent.status));
    const active = this.#activeAgentId ? await loadAgent(this.#activeAgentId).catch(() => undefined) : undefined;
    const tasks = await listTasks(active?.teamSessionId ?? active?.sessionId).catch(() => []);
    const session = await this.#currentSession().catch(() => undefined);
    const platform = this.#platform;
    this.#dialogFacts = {
      cwd: this.#cwd,
      version: this.#version,
      plugins: platform?.plugins.length ?? 0,
      skills: platform?.skills.length ?? 0,
      agents: agents.filter((agent) => resolve(agent.cwd) === resolve(this.#cwd)).length,
      activeAgents: activeAgents.length,
      tasks: tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status)).length,
      sessionMessages: session?.messages.length ?? 0,
      estimatedTokens: session ? countModelText(this.#config?.model,contextMessages(session.messages)) : 0,
      usage: summarizeUsage(session ? await listUsage({ sessionId: session.id }) : []),
    };
  }

  async #handleDialogKey(text: string, key: Key): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog) return;
    if (dialog.type === 'approval') {
      const action = navigateApproval(dialog, key.name ?? '', key.meta ? '' : text, key.ctrl);
      if (action === 'cancel') {
        this.#dialog = undefined;
        this.#messages.push({ role: 'system', text: 'Permission dismissed; no decision sent. Use /questions to reopen.' });
      } else if (action === 'submit' && !this.#working) {
        const current = await loadAgent(dialog.agentId);
        const request = parsePermissionRequest(current.result);
        if (this.#activeAgentId !== dialog.agentId || current.status !== 'waiting_for_input' || request?.id !== dialog.request.id) throw new Error('Permission request is stale. Reopen /questions.');
        this.#dialog = undefined;
        const choice = dialog.choices[dialog.selected]!;
        await this.#submit(choice === 'allow_once' ? 'allow once' : choice === 'allow_session' ? 'allow session' : 'deny', `Permission: ${choice} · ${request.tool}(${request.subject})`);
      }
      this.#render(); return;
    }
    if (dialog.type === 'question') {
      const action = navigateQuestion(dialog, key.name ?? '', key.meta ? '' : text, key.ctrl);
      if (action === 'cancel') {
        this.#dialog = undefined;
        this.#messages.push({ role: 'system', text: dialog.localConflict?'Conflict dialog dismissed; no files/index changed.':dialog.localGoal?'Goal workflow dismissed; no action sent. Reopen /goal-run to review again.':'Question dismissed; no answer sent. Use /questions to reopen, or type your answer.' });
      } else if (action === 'submit') {
        if (this.#working) return;
        if(dialog.localConflict){const completed=await completeConflictDialog(this.#cwd,dialog,await loadConfig(this.#cwd));this.#dialog=completed.dialog;if(completed.result!==undefined)this.#messages.push({role:'system',text:typeof completed.result==='string'?completed.result:stringify(completed.result)});this.#render();return;}
        if(dialog.localGoal){const completed=await completeGoalDialog(this.#cwd,dialog,process.env.CCPT_CLI_ENTRY??process.argv[1]!);this.#dialog=completed.dialog;if(completed.result!==undefined)this.#messages.push({role:'system',text:typeof completed.result==='string'?completed.result:stringify(completed.result)});this.#render();return;}
        if (this.#activeAgentId !== dialog.agentId) throw new Error('This question belongs to another Agent. Reopen /questions.');
        this.#dialog = undefined;
        await this.#submit(questionAnswer(dialog), dialog.questions.map((q) => `${q.question}\n→ ${(dialog.answers[q.id] ?? []).join('; ')}`).join('\n'));
      }
      this.#render(); return;
    }
    if (dialog.type === 'skills') {
      const action = navigateSkills(dialog, key.name ?? '', key.meta ? '' : text, key.ctrl);
      try {
        if (action === 'close') { this.#dialog = undefined; this.#messages.push({ role: 'system', text: 'Skills dialog dismissed. Unsaved changes discarded.' }); }
        else if (action === 'refresh') await this.#openSkillsDialog();
        else if (action === 'save') {
          if (Object.keys(dialog.pending ?? {}).length || Object.keys(dialog.pendingModes ?? {}).length || Object.keys(dialog.pendingOverrides ?? {}).length) {
            const current = await loadConfig(this.#cwd);
            this.#config = await patchProjectSettings(this.#cwd, skillSettingsPatch(dialog, current.disabledSkills, current.skillModes, current.skillOverrides));
            await this.#reloadPlatform(false);
          }
          this.#dialog = undefined;
          this.#messages.push({ role: 'system', text: 'Skill settings saved. Active policy is applied to subsequent Agent turns.' });
        }
      } catch (error) { dialog.status = error instanceof Error ? error.message : String(error); }
      this.#render(); return;
    }
    if (dialog.type === 'resource') {
      if (dialog.busy) return;
      if (key.ctrl && !dialog.renaming && (dialog.kind === 'resume' ? key.name === 'l' : key.name === 'r') && !dialog.confirmation) {
        const pickerFork = this.#pickerFork;
        await this.#command(dialog.title === 'MCP notification listeners' ? '/mcp watches' : `/${dialog.kind}`);
        const refreshed = this.#dialog;
        if (refreshed?.type === 'resource') {
          refreshed.tab = dialog.tab; refreshed.query = dialog.query; refreshed.allProjects = dialog.allProjects;
          refreshed.searchMode = Boolean(dialog.searchMode);
          refreshed.allWorktrees = Boolean(dialog.allWorktrees); refreshed.branchOnly = Boolean(dialog.branchOnly);
          refreshed.selected = Math.min(dialog.selected, Math.max(0, resourceItems(refreshed).length - 1));
        }
        this.#pickerFork = pickerFork;
        this.#render(); return;
      }
      const action = navigateResource(dialog, key.name ?? '', key.meta ? '' : text, key.ctrl);
      if (action === 'rename' && dialog.renaming) {
        dialog.busy = true;
        try {
          const renamed = await renameSession(dialog.renaming.id, dialog.renaming.value);
          const item = dialog.groups.flat().find(entry => entry.id === renamed.id);
          if (item) item.label = renamed.title;
          delete dialog.renaming; dialog.query = ''; dialog.searchMode = false;
          dialog.selected = Math.max(0, resourceItems(dialog).findIndex(entry => entry.id === renamed.id));
          dialog.status = 'Session renamed. No model request sent.';
        } catch (error) { dialog.status = error instanceof Error ? error.message : String(error); }
        finally { dialog.busy = false; }
      }
      if (action === 'action' && dialog.confirmation) {
        const target = dialog.confirmation;
        const item = dialog.groups.flat().find((entry) => entry.id === target.id && entry.actions?.includes(target.action));
        if (!item) throw new Error('Selected action is stale; refresh the view.');
        dialog.busy = true; delete dialog.status; this.#render();
        try {
          if (target.action === 'attach') await this.#attachAgent(target.id);
          else if (target.action === 'stop') {
            const stopped = target.id.startsWith('mcpwatch_') ? await this.#mcpWatches.stop(target.id) : await stopProjectTask(this.#cwd, target.id);
            await this.#command(dialog.title === 'MCP notification listeners' ? '/mcp watches' : `/${dialog.kind}`);
            if (this.#dialog?.type === 'resource') this.#dialog.status = `${target.id}: ${stopped.status}`;
          } else {
            const current = (await loadPlatform(this.#cwd)).config;
            const server = current.mcpServers[target.id]; if (!server) throw new Error('MCP server is no longer configured.');
            const startedAt = Date.now();
            const result = await inspectMcpServer(target.id, server, { ...current, network: { ...current.network, timeoutMs: Math.min(current.network.timeoutMs, 15000) } });
            item.detail = `Discovery succeeded in ${Date.now() - startedAt} ms\nNo tools/call executed.\n${stringify(result).slice(0, 24000)}`;
            dialog.status = 'MCP discovery complete'; dialog.detailScroll = 0;
          }
        } catch (error) { dialog.status = error instanceof Error ? error.message : String(error); }
        finally { dialog.busy = false; delete dialog.confirmation; }
        this.#render(); return;
      }
      if (action === 'close') { this.#dialog = undefined; this.#messages.push({ role: 'system', text: `${dialog.title} dismissed.` }); }
      if (action === 'select') {
        const item = resourceItems(dialog)[dialog.selected]!;
        dialog.busy = true;
        try {
          if (dialog.kind === 'resume') {
            if (this.#pickerFork) {
              if (this.#working) throw new Error('Finish or background the current task before branching.');
              await assertSessionIdle(item.id);
              const source = await loadSession(item.id);
              if (!sameWorkspace(source.cwd, this.#cwd)) throw new Error('Open CCPT in the original workspace before branching this conversation.');
              await this.#attachSession((await forkSession(item.id)).id);
            } else await this.#attachSession(item.id);
            this.#pickerFork = false; if (this.#dialog === dialog) this.#dialog = undefined;
          }
          else if (dialog.kind === 'theme') {
            process.env.CCPT_THEME = item.id; applyTuiTheme(item.id); this.#dialog = undefined;
            this.#messages.push({ role: 'system', text: `Terminal theme changed to ${item.id} for this session.` });
          } else {
            if (dialog.kind === 'tasks' && item.id.startsWith('shell_') && !dialog.expanded) item.detail = stringify(await projectShellOutput(this.#cwd, item.id));
            dialog.expanded = !dialog.expanded;
          }
        } catch (error) { this.#dialog = undefined; this.#messages.push(diagnosticEntry(error)); }
        finally { dialog.busy = false; }
      }
      this.#render(); return;
    }
    if (dialog.type === 'config') {
      const action = navigateConfig(dialog, this.#config!, this.#dialogFacts, key.name ?? '', key.ctrl || key.meta ? '' : text);
      if (action === 'close') { this.#dialog = undefined; this.#messages.push({ role: 'system', text: 'Config dialog dismissed. Unsaved changes were discarded.' }); }
      if (action === 'save') {
        try {
          if (dialog.pending) this.#config = await patchProjectSettings(this.#cwd, dialog.pending);
          await this.#reloadPlatform(false);
          if (this.#config?.marketplaceEnabled === false && this.#marketplaceUpdateTimer) { clearTimeout(this.#marketplaceUpdateTimer); this.#marketplaceUpdateTimer = undefined; }
          this.#dialog = undefined;
          this.#messages.push({ role: 'system', text: 'Settings saved.' });
        } catch (error) { dialog.error = error instanceof Error ? error.message : String(error); }
      }
      this.#render(); return;
    }
    if (dialog.type === 'permissions' && dialog.adding && (key.name === 'escape' || text === '\u001b')) { dialog.adding = false; dialog.input = ''; this.#render(); return; }
    if (dialog.type === 'permissions' && dialog.searching && !dialog.adding) {
      if (key.name === 'escape') { if (dialog.query) { dialog.query = ''; dialog.selected = 0; } else dialog.searching = false; }
      else if (['return', 'enter', 'down'].includes(key.name ?? '')) dialog.searching = false;
      else if (key.name === 'backspace') { dialog.query = [...(dialog.query ?? '')].slice(0, -1).join(''); dialog.selected = 0; }
      else if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/.test(text)) { dialog.query = (dialog.query ?? '') + text; dialog.selected = 0; }
      this.#render(); return;
    }
    if (dialog.type === 'marketplace' && dialog.expanded && (key.name === 'escape' || text === '\u001b')) { dialog.expanded = false; dialog.detailAction = 0; delete dialog.status; this.#render(); return; }
    if (key.name === 'escape' || text === '\u001b') { this.#dialog = undefined; this.#render(); return; }
    if (dialog.type === 'permissions') {
      if (key.ctrl && key.name === 'r') {
        dialog.recent = await listPermissionDenials(this.#cwd); dialog.managedFields = managedPermissionFields();
        this.#config = await loadConfig(this.#cwd); dialog.selected = 0; this.#render(); return;
      }
      if (dialog.adding) {
        if (key.name === 'backspace') dialog.input = [...dialog.input].slice(0, -1).join('');
        else if (key.name === 'return' || key.name === 'enter' || text === '\r') {
          const value = dialog.input.trim();
          if (value) {
            if (dialog.tab === 'Directories') {
              const path = resolve(this.#cwd, value);
              this.#config = await patchProjectSettings(this.#cwd, { policy: { workspaceRoots: [...new Set([...this.#config!.policy.workspaceRoots, path])] } });
            } else if (dialog.tab !== 'Mode') {
              const keyName = dialog.tab.toLowerCase() as 'allow' | 'ask' | 'deny';
              const rules = this.#config!.policy.permissionRules;
              this.#config = await patchProjectSettings(this.#cwd, { policy: { permissionRules: { ...rules, [keyName]: [...new Set([...rules[keyName], value])] } } });
            }
          }
          dialog.adding = false; dialog.input = '';
        } else if (!key.ctrl && !key.meta && text && !/^[\u0000-\u001f]$/.test(text)) dialog.input += text;
        this.#render(); return;
      }
      if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
        const direction = key.name === 'left' || key.shift ? -1 : 1;
        const index = PERMISSION_TABS.indexOf(dialog.tab);
        dialog.tab = PERMISSION_TABS[(index + direction + PERMISSION_TABS.length) % PERMISSION_TABS.length]!;
        dialog.selected = 0; dialog.query = '';
      } else {
        const items = permissionDialogEntries(this.#config!, dialog);
        const selectedIndex = items[dialog.selected]?.index;
        if (text === '/') { dialog.searching = true; }
        else if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key.name ?? '')) {
          const maximum = Math.max(0, items.length - 1);
          const delta = key.name === 'up' ? -1 : key.name === 'pageup' ? -8 : key.name === 'pagedown' ? 8 : 1;
          dialog.selected = key.name === 'home' ? 0 : key.name === 'end' ? maximum : Math.max(0, Math.min(maximum, dialog.selected + delta));
        }
        else if (/^[1-9]$/.test(text)) dialog.selected = Math.min(Math.max(0, items.length - 1), Number(text) - 1);
        else if ((key.name === 'return' || key.name === 'enter' || text === '\r') && dialog.tab === 'Mode' && !permissionTabLocked(dialog)) {
          const mode = selectedIndex === undefined ? undefined : permissionModeAt(selectedIndex);
          if (mode) this.#config = await patchProjectSettings(this.#cwd, { policy: { mode, ...(mode === 'restricted' ? { allowNetwork: false } : {}) } });
        } else if ((text ?? '').toLowerCase() === 'a' && dialog.tab !== 'Mode' && !permissionTabLocked(dialog)) { dialog.adding = true; dialog.input = ''; }
        else if ((text ?? '').toLowerCase() === 'd' && dialog.tab !== 'Mode' && !permissionTabLocked(dialog) && items[dialog.selected]) {
          if (dialog.tab === 'Directories') {
            const roots = this.#config!.policy.workspaceRoots.filter((_, index) => index !== selectedIndex);
            if (roots.length) this.#config = await patchProjectSettings(this.#cwd, { policy: { workspaceRoots: roots } });
          } else {
            const keyName = dialog.tab.toLowerCase() as 'allow' | 'ask' | 'deny';
            const rules = this.#config!.policy.permissionRules;
            this.#config = await patchProjectSettings(this.#cwd, { policy: { permissionRules: { ...rules, [keyName]: rules[keyName].filter((_, index) => index !== selectedIndex) } } });
          }
          dialog.selected = Math.max(0, dialog.selected - 1);
        }
      }
      this.#render(); return;
    }
    if (dialog.type === 'marketplace') {
      if (isMarketplaceRefreshKey(text, key)) {
        try {
          dialog.status = 'Refreshing marketplaces…'; this.#render();
          await refreshMarketplace(this.#cwd);
          await this.#refreshMarketplaceDialog('Marketplace catalogs refreshed.');
        } catch (error) {
          dialog.status = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
          this.#render();
        }
        return;
      }
      const selectedItem = marketplaceDialogItems(dialog)[dialog.selected];
      if (dialog.expanded && selectedItem?.kind === 'plugin') {
        const actions = marketplaceDetailActions(selectedItem.plugin);
        if (key.name === 'up' || key.name === 'down') {
          dialog.detailAction = ((dialog.detailAction ?? 0) + (key.name === 'up' ? -1 : 1) + actions.length) % actions.length;
        } else if (key.name === 'return' || key.name === 'enter' || text === '\r') {
          const action = actions[dialog.detailAction ?? 0]?.id;
          try {
            if (action === 'back') { dialog.expanded = false; dialog.detailAction = 0; delete dialog.status; }
            else if (action === 'homepage') dialog.status = selectedItem.plugin.homepage ?? 'No homepage is declared for this Plugin.';
            else if (action === 'install-project' || action === 'install-local') {
              const scope = action === 'install-local' ? 'local' : 'project';
              dialog.status = `Installing ${selectedItem.plugin.name}@${selectedItem.plugin.marketplace} (${scope} scope)…`; this.#render();
              await installMarketplacePlugin(this.#cwd, `${selectedItem.plugin.name}@${selectedItem.plugin.marketplace}`, { scope });
              this.#dialog = undefined;
              this.#messages.push({ role: 'system', text: `✓ Installed ${selectedItem.plugin.name}. Run /reload-plugins to activate its Skills, Agents and slash commands.` });
            } else if (action === 'update') {
              dialog.status = `Updating ${selectedItem.plugin.name}@${selectedItem.plugin.marketplace}…`; this.#render();
              const updated = await updateMarketplacePlugin(this.#cwd, `${selectedItem.plugin.name}@${selectedItem.plugin.marketplace}`);
              this.#dialog = undefined;
              this.#messages.push({ role: 'system', text: `✓ Updated ${updated.name} ${updated.previousVersion} → ${updated.version}. Run /reload-plugins to activate it.` });
            } else if (action === 'reload') {
              this.#dialog = undefined;
              await this.#reloadPlatform(true);
            } else if (action === 'uninstall') {
              await uninstallMarketplacePlugin(this.#cwd, selectedItem.plugin.name);
              this.#dialog = undefined;
              this.#messages.push({ role: 'system', text: `Uninstalled Plugin ${selectedItem.plugin.name}. Run /reload-plugins to update this session.` });
            }
          } catch (error) { dialog.status = `Install failed: ${error instanceof Error ? error.message : String(error)}`; }
        }
        this.#render(); return;
      }
      if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
        const direction = key.name === 'left' || key.shift ? -1 : 1;
        const index = MARKETPLACE_TABS.indexOf(dialog.tab);
        dialog.tab = MARKETPLACE_TABS[(index + direction + MARKETPLACE_TABS.length) % MARKETPLACE_TABS.length]!;
        dialog.selected = 0; dialog.scroll = 0; dialog.expanded = false; dialog.query = '';
      } else if (key.name === 'up' || key.name === 'down') {
        const items = marketplaceDialogItems(dialog);
        if (items.length) dialog.selected = (dialog.selected + (key.name === 'up' ? -1 : 1) + items.length) % items.length;
        dialog.expanded = false;
      } else if (key.name === 'backspace') {
        dialog.query = [...dialog.query].slice(0, -1).join(''); dialog.selected = 0; dialog.scroll = 0;
      } else if (key.name === 'return' || key.name === 'enter' || text === '\r') {
        const item = marketplaceDialogItems(dialog)[dialog.selected];
        if (item?.kind === 'plugin') { dialog.expanded = true; dialog.detailAction = 0; delete dialog.status; }
      } else if (key.name === 'space' || text === ' ') {
        const item = marketplaceDialogItems(dialog)[dialog.selected];
        if (item?.kind === 'plugin') {
          dialog.expanded = true; dialog.detailAction = 0; delete dialog.status;
        } else if (item?.kind === 'marketplace') {
          try {
            const enabled = !item.marketplace.autoUpdate;
            await setMarketplaceAutoUpdate(this.#cwd, item.marketplace.name, enabled);
            await this.#refreshMarketplaceDialog(`${enabled ? 'Enabled' : 'Disabled'} auto-update for ${item.marketplace.name}.`);
            return;
          } catch (error) { dialog.status = `Error: ${error instanceof Error ? error.message : String(error)}`; }
        }
      } else if ((text ?? '').toLowerCase() === 'u' && dialog.tab === 'Installed') {
        const item = marketplaceDialogItems(dialog)[dialog.selected];
        if (item?.kind === 'plugin') {
          try {
            dialog.status = `Updating ${item.plugin.name}@${item.plugin.marketplace}…`; this.#render();
            const updated = await updateMarketplacePlugin(this.#cwd, `${item.plugin.name}@${item.plugin.marketplace}`);
            await this.#refreshMarketplaceDialog(`Updated ${updated.name} ${updated.previousVersion} → ${updated.version}. Run /reload-plugins to activate it.`);
            return;
          } catch (error) { dialog.status = `Error: ${error instanceof Error ? error.message : String(error)}`; }
        }
      } else if (!key.ctrl && !key.meta && text && !/^[\u0000-\u001f]$/.test(text)) {
        dialog.query += text; dialog.selected = 0; dialog.scroll = 0; dialog.expanded = false;
      }
      const items = marketplaceDialogItems(dialog);
      dialog.selected = Math.max(0, Math.min(dialog.selected, Math.max(0, items.length - 1)));
      this.#render(); return;
    }
    if (dialog.type === 'effort') {
      if (key.name === 'left' || key.name === 'right') dialog.effort = cycleEffort(dialog.effort, key.name === 'left' ? -1 : 1);
      else if ((text ?? '').toLowerCase() === 'd') await this.#applyEffortDialog(true);
      else if (key.name === 'return' || key.name === 'enter' || text === '\r') await this.#applyEffortDialog(false);
      this.#render(); return;
    }
    if (key.name === 'up' || key.name === 'down') dialog.selected = (dialog.selected + (key.name === 'up' ? -1 : 1) + dialog.choices.length) % dialog.choices.length;
    else if (key.name === 'left' || key.name === 'right') dialog.effort = cycleEffort(dialog.effort, key.name === 'left' ? -1 : 1);
    else if (/^[1-9]$/.test(text)) dialog.selected = Math.min(dialog.choices.length - 1, Number(text) - 1);
    else if ((text ?? '').toLowerCase() === 'd' || key.name === 'return' || key.name === 'enter' || text === '\r') await this.#applyModelDialog(true);
    else if ((text ?? '').toLowerCase() === 's') await this.#applyModelDialog(false);
    this.#render();
  }

  async #applyModelDialog(persist: boolean): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog || dialog.type !== 'model') return;
    const choice = dialog.choices[dialog.selected];
    if (!choice) return;
    await runHooks(this.#config!, 'PreModelSwitch', { old_model: this.#config!.model.name, new_model: choice.model, source: 'user', persist }, this.#cwd);
    if (persist) {
      this.#sessionModel = undefined;
      this.#config = await patchProjectSettings(this.#cwd, { model: { name: choice.model, provider: this.#config?.model.provider ?? 'compatible', reasoningEffort: dialog.effort, thinkingEnabled: true } });
      this.#messages.push({ role: 'system', text: `Default model set to ${choice.model} · ${dialog.effort} effort.` });
    } else {
      this.#sessionModel = { name: choice.model, effort: dialog.effort };
      if (this.#config) this.#config.model = { ...this.#config.model, name: choice.model, reasoningEffort: dialog.effort, thinkingEnabled: true };
      this.#messages.push({ role: 'system', text: `Using ${choice.model} · ${dialog.effort} effort for this session only.` });
    }
    await runHooks(this.#config!, 'PostModelSwitch', { new_model: choice.model, source: 'user', persist }, this.#cwd);
    this.#dialog = undefined;
  }

  async #applyEffortDialog(persist: boolean): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog || dialog.type !== 'effort' || !this.#config) return;
    if (persist) {
      this.#sessionModel = undefined;
      this.#config = await patchProjectSettings(this.#cwd, { model: { reasoningEffort: dialog.effort, thinkingEnabled: true } });
      this.#messages.push({ role: 'system', text: `Default effort set to ${dialog.effort}.` });
    } else {
      this.#sessionModel = { name: this.#config.model.name, effort: dialog.effort };
      this.#config.model = { ...this.#config.model, reasoningEffort: dialog.effort, thinkingEnabled: true };
      this.#messages.push({ role: 'system', text: `Using ${dialog.effort} effort for this session only.` });
    }
    this.#dialog = undefined;
  }

  #openModelPicker(): void {
    const current = this.#config?.model.name ?? 'ccpt-model';
    const configured = this.#config?.model.availableModels ?? [];
    const environment = (process.env.CCPT_MODELS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    const config = this.#config;
    if (!config) return;
    this.#dialog = { type: 'model', selected: 0, effort: config.model.reasoningEffort, choices: buildModelChoices(config, [current, ...configured, ...environment]) };
    this.#rewindChoices = [];
    this.#selected = 0;
    this.#render();
  }

  #openEffortPicker(): void {
    if (!this.#config) return;
    this.#dialog = { type: 'effort', effort: this.#config.model.reasoningEffort };
    this.#rewindChoices = [];
    this.#render();
  }

  async #openPermissionsDialog(recent = false): Promise<void> {
    if (!this.#config) return;
    this.#config = await loadConfig(this.#cwd);
    this.#dialog = { type: 'permissions', tab: recent ? 'Recent' : 'Mode', selected: 0, adding: false, input: '', recent: await listPermissionDenials(this.#cwd), managedFields: managedPermissionFields() };
    this.#rewindChoices = [];
    this.#render();
  }

  async #openSkillsDialog(): Promise<void> {
    await this.#reloadPlatform(false);
    const active = new Set((this.#platform?.skills ?? []).map((skill) => skill.name));
    const skills = (this.#platform?.availableSkills ?? this.#platform?.skills ?? []).filter((skill) => skill.source !== 'plugin' || skill.name.includes(':')).map((skill) => ({ ...skill, enabled: active.has(skill.name), locked: false }));
      this.#dialog = {
        type: 'skills', selected: 0, expanded: false, skills, query: '', searching: false, sort: 'name', pending: {},
        workspaceDirectory: join(this.#cwd, '.ccpt', 'skills', '<name>', 'SKILL.md'),
      };
    this.#rewindChoices = [];
    this.#render();
  }

  async #openMarketplaceDialog(): Promise<void> {
    if ((await loadConfig(this.#cwd)).marketplaceEnabled === false) {
      this.#messages.push({ role: 'system', text: 'Marketplace is disabled in Settings. No catalog loading, install or update will run. Existing local Plugins, Skills and Agents remain available.' });
      return;
    }
    this.#dialog = {
      type: 'marketplace', tab: 'Discover', query: '', selected: 0, scroll: 0, expanded: false,
      plugins: [], marketplaces: [], errors: [], status: 'Loading cached plugin catalog…',
    };
    this.#rewindChoices = [];
    this.#render();
    const [plugins, marketplaces, errors] = await Promise.all([listMarketplacePlugins(this.#cwd), listMarketplaces(this.#cwd), marketplaceErrors(this.#cwd)]);
    if (this.#dialog?.type !== 'marketplace') return;
    this.#dialog.plugins = plugins;
    this.#dialog.marketplaces = marketplaces;
    this.#dialog.errors = errors;
    const official = marketplaces.find((item) => item.name === 'claude-plugins-official');
    if (official?.catalogOrigin === 'bundled') this.#dialog.status = 'Official catalog loaded from the bundled snapshot; background refresh remains enabled.';
    else delete this.#dialog.status;
    this.#render();
    if (!official) {
      this.#dialog.status = 'Loading the bundled official plugin catalog in the background…';
      this.#render();
      void ensureOfficialMarketplace(this.#cwd).then(async (record) => {
        if (this.#dialog?.type !== 'marketplace') return;
        await this.#refreshMarketplaceDialog(record.catalogOrigin === 'bundled'
          ? 'Official catalog is ready from the bundled snapshot; background refresh remains enabled.'
          : 'Configured plugin marketplace is ready.');
      }).catch(async (error) => {
        if (this.#dialog?.type !== 'marketplace') return;
        await this.#refreshMarketplaceDialog(`Official catalog setup failed: ${error instanceof Error ? error.message : String(error)}. Press r to retry.`);
      });
    }
  }

  async #refreshMarketplaceDialog(status?: string): Promise<void> {
    const previous = this.#dialog?.type === 'marketplace' ? this.#dialog : undefined;
    this.#dialog = {
      type: 'marketplace', tab: previous?.tab ?? 'Discover', query: previous?.query ?? '', selected: previous?.selected ?? 0,
      scroll: previous?.scroll ?? 0, expanded: false,
      plugins: await listMarketplacePlugins(this.#cwd), marketplaces: await listMarketplaces(this.#cwd), errors: await marketplaceErrors(this.#cwd),
      ...(status ? { status } : {}),
    };
    this.#render();
  }

  async #toggleThinking(): Promise<void> {
    if (!this.#config) return;
    const enabled = !this.#config.model.thinkingEnabled;
    this.#config = await patchProjectSettings(this.#cwd, { model: { thinkingEnabled: enabled } });
    if (this.#sessionModel) this.#sessionModel.thinkingEnabled = enabled;
    this.#messages.push({ role: 'system', text: `Extended thinking ${enabled ? 'enabled' : 'disabled'}.` });
    this.#render();
  }

  async #toggleFastMode(): Promise<void> {
    if (!this.#config) return;
    const enabled = !this.#config.model.fastMode;
    this.#config = await patchProjectSettings(this.#cwd, { model: { fastMode: enabled } });
    this.#messages.push({ role: 'system', text: `Fast mode ${enabled ? 'enabled' : 'disabled'}.` });
    this.#render();
  }

  async #toggleTaskPanel(): Promise<void> {
    this.#showTasks = !this.#showTasks;
    if (this.#showTasks) await this.#refreshTaskPanel();
    this.#render();
  }

  async #refreshTaskPanel(): Promise<void> {
    this.#lastTaskRefreshAt = Date.now();
    const active = this.#activeAgentId ? await loadAgent(this.#activeAgentId).catch(() => undefined) : undefined;
    const [agents, tasks, shells] = await Promise.all([listAgents(), listTasks(active?.teamSessionId ?? active?.sessionId), listShellTasks({ cwd: this.#cwd, limit: 12 })]);
    const activeAgents = agents.filter((agent) => resolve(agent.cwd) === resolve(this.#cwd) && ['queued', 'working', 'waiting_for_input'].includes(agent.status));
    const activeTasks = tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status)).slice(0, 8);
    const activeShells = shells.filter((task) => ['queued', 'running'].includes(task.status));
    const watches = this.#mcpWatches.list().filter(activeMcpWatch);
    this.#taskPanelLines = [
      `Tasks (${activeAgents.length + activeTasks.length + activeShells.length + watches.length}) · Ctrl+T hide`,
      ...watches.map(task => `  ○ MCP ${task.server} · ${task.status} · ${task.notifications} notifications`),
      ...activeAgents.map((agent) => `  ${agent.status === 'working' ? '●' : '○'} ${agent.id}  ${agent.role}  ${agent.goal.slice(0, 70)}`),
      ...activeShells.map((task) => `  ${task.status === 'running' ? '●' : '○'} ${task.id}  ! ${task.command} ${task.args.join(' ')}`),
      ...activeTasks.map((task) => `  ${task.status === 'in_progress' ? '●' : '○'} ${task.id}  ${task.title}`),
    ];
    if (this.#taskPanelLines.length === 1) this.#taskPanelLines.push('  No active tasks');
  }

  async #backgroundActiveTask(): Promise<void> {
    if (this.#activeShellTaskId && this.#working) {
      const id = this.#activeShellTaskId;
      this.#shellMonitorToken = undefined;
      this.#messages.push({ role: 'system', text: `Backgrounded ${id}. Use /tasks output ${id} to inspect it.` });
      this.#render();
      return;
    }
    if (this.#activeAgentId && this.#working) {
      const id = this.#activeAgentId;
      const record = await loadAgent(id);
      if (this.#queuedInputs.length) {
        this.#messages.push({ role: 'system', text: `${this.#queuedInputs.length} queued prompt(s) were not sent. They remain visible above; re-enter them after attaching the intended conversation.` });
        this.#queuedInputs = [];
      }
      this.#monitorToken = undefined;
      if (this.#attachmentToken) { this.#attachmentToken = undefined; this.#working = false; this.#liveStream = undefined; this.#liveTaskLines = []; }
      this.#activeAgentId = undefined;
      this.#messages.push({ role: 'system', text: `Backgrounded ${id}. Resume conversation ${record.sessionId} with /resume ${record.sessionId}.` });
      this.#render();
      return;
    }
    this.#messages.push({ role: 'system', text: 'No foreground task is running.' });
    this.#render();
  }

  async #killBackgroundAgents(): Promise<void> {
    const running = (await listAgents()).filter((agent) => resolve(agent.cwd) === resolve(this.#cwd) && ['queued', 'working', 'waiting_for_input'].includes(agent.status));
    if (!running.length) { this.#messages.push({ role: 'system', text: 'No running Agents.' }); this.#render(); return; }
    const now = Date.now();
    if (now - this.#lastKillAgentsAt > 3_000) {
      this.#lastKillAgentsAt = now;
      this.#messages.push({ role: 'system', text: `Press Ctrl+X Ctrl+K again within 3 seconds to stop ${running.length} running Agent${running.length === 1 ? '' : 's'}.` });
      this.#render(); return;
    }
    await Promise.all(running.map((agent) => cancelAgent(agent.id)));
    this.#monitorToken = undefined;
    this.#messages.push({ role: 'system', text: `Stopped ${running.length} running Agent${running.length === 1 ? '' : 's'}.` });
    this.#render();
  }

  async #escape(): Promise<void> {
    if (this.#working) { await this.#interrupt(); return; }
    if (this.#input || this.#historySearch || this.#rewindChoices.length || this.#dialog) { this.#cancelInput(); this.#render(); return; }
    const now = Date.now();
    if (now - this.#lastEscapeAt <= 900) {
      this.#lastEscapeAt = 0;
      const checkpoints = await listCheckpoints(this.#cwd);
      if (!checkpoints.length) this.#messages.push({ role: 'system', text: 'No checkpoint is available to rewind.' });
      else this.#rewindChoices = checkpoints.slice(0, 12).map((checkpoint, index) => ({ name: `/rewind ${checkpoint.id} conversation`, description: `${index === 0 ? 'Latest · ' : ''}${checkpoint.reason} · ${checkpoint.entries.length} files`, kind: 'checkpoint' }));
      this.#selected = 0;
      this.#render(); return;
    }
    this.#lastEscapeAt = now;
    this.#messages.push({ role: 'system', text: 'Press Esc again to rewind.' });
    this.#render();
  }

  async #submit(value: string, displayValue = value): Promise<void> {
    await this.#extensionReload?.settled();
    if (this.#closed) return;
    if (value.startsWith('/')) {
      this.#messages.push({ role: 'command', text: value });
      await this.#command(value);
      this.#render();
      return;
    }
    if (this.#working) {
      this.#queuedInputs.push(value);
      this.#messages.push({ role: 'queued', text: value });
      this.#render();
      return;
    }
    if (value.startsWith('!')) {
      this.#messages.push({ role: 'command', text: value });
      this.#working = true;
      this.#workingStartedAt = Date.now();
      try {
        const invocation = parseSimpleCommand(value.slice(1));
        const config = (await loadPlatform(this.#cwd)).config;
        const task = await startShellTask({ command: invocation.command, args: invocation.args, cwd: this.#cwd, config, actor: this.#activeAgentId ?? 'terminal' });
        this.#activeShellTaskId = task.id;
        this.#messages.push({ role: 'tool', text: '', name: 'Bash', input: { command: `${invocation.command} ${invocation.args.join(' ')}`.trim(), taskId: task.id } });
        await this.#monitorShellTask(task.id);
      } catch (error) { this.#messages.push(diagnosticEntry(error)); }
      finally {
        this.#working = false;
        this.#activeShellTaskId = undefined;
        this.#render();
        const next = this.#queuedInputs.shift();
        if (next && !this.#closed) queueMicrotask(() => { void this.#submit(next); });
      }
      this.#render();
      return;
    }
    if (value.startsWith('#') && value.slice(1).trim()) {
      const memory = value.slice(1).trim();
      const key = `note-${new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()}`;
      await setMemory('project', key, memory);
      this.#messages.push({ role: 'system', text: `Saved project memory: ${key}` });
      this.#render();
      return;
    }
    const queuedIndex = this.#messages.findIndex((message) => message.role === 'queued' && message.text === value);
    if (queuedIndex >= 0) this.#messages.splice(queuedIndex, 1);
    this.#messages.push({ role: 'user', text: displayValue });
    let agentInput = value;
    const promptContent = this.#promptContent(value);
    if (this.#activeAgentId) {
      const pending = await loadAgent(this.#activeAgentId);
      const request = pending.status === 'waiting_for_input' ? parsePermissionRequest(pending.result) : undefined;
      if (request) {
        if (request.sessionId !== pending.sessionId) throw new Error('Permission request belongs to another session; no decision recorded.');
        const choice = parsePermissionChoice(value, createPermissionDialog(request));
        if (choice === 'allow_once') {
          await grantPermissionOnce(request);
          agentInput = `Permission approved once for ${request.tool}(${request.subject}). Retry the exact requested tool call.`;
        } else if (choice === 'allow_session') {
          await grantPermissionForSession(request);
          agentInput = `Permission approved for this session for ${request.tool}(${request.subject}). Retry the exact requested tool call.`;
        } else {
          await denyPermissionForSession(request);
          await recordPermissionDenial({ cwd: pending.cwd, sessionId: request.sessionId, tool: request.tool, subject: request.subject, reason: 'User declined the pending operation', source: 'user' }, modelCredentialNames(this.#config!).map((key) => process.env[key] ?? ''));
          agentInput = `Permission denied for ${request.tool}(${request.subject}) for this session. Do not retry it. User feedback: ${value}`;
        }
      }
    }
    this.#scrollOffset = 0;
    this.#working = true;
    this.#workingStartedAt = Date.now();
    this.#render();
    try {
      const platform = await loadPlatform(this.#cwd);
      if (this.#sessionModel) {
        const managed = managedModelFields();
        platform.config.model = { ...platform.config.model, ...(!managed.includes('name') ? { name: this.#sessionModel.name } : {}), ...(!managed.includes('reasoningEffort') ? { reasoningEffort: this.#sessionModel.effort } : {}), ...(!managed.includes('thinkingEnabled') ? { thinkingEnabled: this.#sessionModel.thinkingEnabled ?? true } : {}) };
      }
      if (this.#sessionPermissionMode && !managedPermissionFields().includes('mode')) platform.config.policy = { ...platform.config.policy, mode: this.#sessionPermissionMode };
      this.#platform = platform;
      const config = platform.config;
      this.#config = config;
      if (this.#activeAgentId) {
        const current = await loadAgent(this.#activeAgentId);
        await this.#syncSession(await loadSession(current.sessionId), false);
      }
      const record = this.#activeAgentId
        ? await continueAgent(this.#activeAgentId, agentInput, { background: true, config, planMode: this.#planMode, ...(promptContent ? { content: promptContent } : {}) })
        : await spawnAgent({ goal: agentInput, cwd: this.#cwd, config, ...(!this.#resumedSessionId ? { role: 'lead' } : {}), isolation: 'none', background: true, planMode: this.#planMode, ...(this.#resumedSessionId ? { sessionId: this.#resumedSessionId } : {}), ...(promptContent ? { content: promptContent } : {}) });
      this.#activeAgentId = record.id;
      this.#resumedSessionId = undefined;
      await this.#monitorAgent(record.id);
    } catch (error) {
      this.#messages.push(diagnosticEntry(error));
    } finally {
      this.#working = false;
      this.#liveStream = undefined;
      this.#liveTaskLines = [];
      this.#scrollOffset = 0;
      await this.#reloadPlatform(false);
      this.#render();
      const next = this.#queuedInputs.shift();
      if (next && !this.#closed) queueMicrotask(() => { void this.#submit(next); });
    }
  }

  async #syncSession(session: SessionRecord, emit = true): Promise<void> {
    for (let messageIndex = 0; messageIndex < session.messages.length; messageIndex += 1) {
      const message = session.messages[messageIndex]!;
      if (!Array.isArray(message.content)) continue;
      for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
        const block = message.content[blockIndex]!;
        const key = `${messageIndex}:${blockIndex}:${block.id ?? block.tool_use_id ?? block.type}`;
        if (this.#seenSessionEvents.has(key)) continue;
        this.#seenSessionEvents.add(key);
        if (!emit) continue;
        if (block.type === 'thinking') this.#messages.push({ role: 'thinking', text: 'Thought', detail: block.text?.trim() || 'The provider returned a redacted thinking block.', eventId: key });
        else if (block.type === 'tool_use') this.#messages.push({ role: 'tool', text: '', name: block.name ?? 'Tool', input: block.input ?? {}, eventId: key });
        else if (block.type === 'tool_result') {
          const question = createQuestionDialog('', block.content ?? '');
          const approval = parsePermissionRequest(block.content);
          this.#messages.push({ role: 'tool_result', text: approval ? 'Waiting for explicit permission in the approval picker.' : question ? 'Waiting for your answer in the question picker.' : block.content ?? '', ...(block.is_error === undefined ? {} : { isError: block.is_error }), eventId: key });
        }
        else if (block.type === 'text' && block.text?.trim() && message.content.some((item) => item.type === 'tool_use')) this.#messages.push({ role: 'assistant', text: block.text.trim(), eventId: key });
      }
    }
    this.#scrollOffset = 0;
    this.#render();
  }

  #commitLiveStream(text?: string, finished = false): void {
    const stream = this.#liveStream;
    if (!stream) return;
    const durationMs = Math.max(0, Date.parse(stream.updatedAt) - Date.parse(stream.startedAt));
    if (stream.thinking?.trim()) this.#messages.push({ role: 'thinking', text: `Thought for ${Math.max(1, Math.round(durationMs / 1_000))}s`, detail: stream.thinking.trim() });
    const answer = text ?? stream.text;
    if (answer.trim()) this.#messages.push({ role: 'assistant', text: answer.trim() });
    this.#liveStream = undefined;
    if (finished) this.#liveTaskLines = [];
  }

  #applyAgentStream(update: AgentStreamUpdate, commitPrevious = true): void {
    if (update.contextPressure) this.#showContextPressure(update.agentId, update.turn, update.contextPressure);
    if (update.contextRecovery) this.#showContextRecovery(update.agentId, update.turn, update.contextRecovery);
    const previous = this.#liveStream;
    if (previous && (previous.agentId !== update.agentId || previous.turn !== update.turn)) {
      if (commitPrevious) this.#commitLiveStream();
      else this.#liveStream = undefined;
    }
    this.#liveStream = { ...update };
    this.#activeAgentId ??= update.agentId;
    this.#scrollOffset = 0;
  }

  #showContextPressure(agentId: string, turn: number, notice: ContextPressureNotice): void {
    const key = `pressure:${agentId}:${turn}:${notice.action}:${notice.before}:${notice.summaryMethod ?? ''}:${notice.summaryFallback ?? ''}`;
    if (this.#seenSessionEvents.has(key)) return;
    this.#seenSessionEvents.add(key);
    this.#messages.push({ role: 'system', text: formatContextPressure(notice) });
  }

  #showContextRecovery(agentId: string, turn: number, notice: import('./contextRecovery.js').ContextRecoveryNotice): void {
    const { attempt, before, after } = notice;
    const key = `context:${agentId}:${turn}:${attempt}:${before}`;
    if (this.#seenSessionEvents.has(key)) return;
    this.#seenSessionEvents.add(key);
    this.#messages.push({ role: 'system', text: `Context recovery ${attempt}/2: ~${before} → ~${after} conversation tokens. Original history archived; retrying the model request.` });
  }

  #applyRuntimeEvent(event: RuntimeEvent): void {
    if (event.type === 'model_retry') { this.#messages.push({ role: 'system', text: `${event.notice.reason} · ${Math.ceil(event.notice.delayMs / 1000)}s · retry ${event.notice.attempt}/${event.notice.maxRetries}. Conversation stays open; you can stop the current request.` }); this.#render(); return; }
    if (event.type === 'context_pressure') { this.#showContextPressure(event.agentId, event.turn, event.notice); this.#scrollOffset = 0; this.#render(); return; }
    if (event.type === 'context_recovery') { this.#showContextRecovery(event.agentId, event.turn, event.notice); this.#scrollOffset = 0; this.#render(); return; }
    if (event.type === 'turn_started') {
      this.#applyAgentStream({ agentId: event.agentId, turn: event.turn, text: '', phase: 'thinking', startedAt: event.at, updatedAt: event.at });
      return;
    }
    if (!('turn' in event)) return;
    const current = this.#liveStream?.agentId === event.agentId && this.#liveStream.turn === event.turn
      ? { ...this.#liveStream }
      : { agentId: event.agentId, turn: event.turn, text: '', phase: 'thinking' as const, startedAt: event.at, updatedAt: event.at };
    current.updatedAt = event.at;
    if (event.type === 'thinking_delta') {
      current.thinking = `${current.thinking ?? ''}${event.delta}`;
      current.phase = 'thinking';
    } else if (event.type === 'text_delta') {
      if(!event.displaySuppressed)current.text += event.delta;
      current.phase = 'responding';
    } else if(event.type==='display_message'){
      current.text=event.text;current.phase='responding';
    } else if (event.type === 'usage_updated') {
      current.inputTokens = event.inputTokens;
      current.outputTokens = event.outputTokens;
      if (event.inputTokenSource) current.inputTokenSource = event.inputTokenSource;
      if (event.outputTokenSource) current.outputTokenSource = event.outputTokenSource;
      current.toolCalls = event.toolCalls;
    } else if (event.type === 'tool_started') {
      current.phase = 'tool';
      current.activeTool = { name: event.name, input: event.input };
    } else if (event.type === 'tool_completed') {
      current.phase = 'working';
      delete current.activeTool;
    }
    this.#applyAgentStream(current);
  }

  async #withForegroundActivity<T>(operation: () => Promise<T>): Promise<T> {
    const ownsActivity = !this.#working;
    if (ownsActivity) {
      this.#working = true;
      this.#workingStartedAt = Date.now();
      this.#scrollOffset = 0;
      this.#render();
    }
    try {
      return await operation();
    } finally {
      if (ownsActivity) {
        this.#working = false;
        this.#liveStream = undefined;
        this.#liveTaskLines = [];
        this.#scrollOffset = 0;
        this.#render();
      }
    }
  }

  #replaceAgentStream(agentId: string, turn: number | undefined, text: string): boolean {
    if (turn === undefined) return false;
    if (this.#liveStream?.agentId === agentId && this.#liveStream.turn === turn) {
      this.#commitLiveStream(text, true);
      return true;
    }
    const existing = this.#messages.find((message) => message.role === 'assistant' && message.eventId === `stream:${agentId}:${turn}`);
    if (!existing) return false;
    existing.text = text;
    return true;
  }

  async #refreshLiveTasks(): Promise<void> {
    if (this.#liveTaskRefreshPending || !this.#activeAgentId) return;
    this.#liveTaskRefreshPending = true;
    this.#lastLiveTaskRefreshAt = Date.now();
    try {
      const agent = await loadAgent(this.#activeAgentId);
      const tasks = (await listTasks(agent.teamSessionId ?? agent.sessionId))
        .filter((task) => task.id !== agent.taskId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const visible = tasks.slice(0, 5);
      this.#liveTaskLines = visible.map((task, index) => {
        const marker = task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '◼' : task.status === 'failed' || task.status === 'cancelled' ? '×' : '◻';
        return `${index === 0 ? '  ⎿ ' : '    '}${marker} ${task.title}`;
      });
      const remaining = Math.max(0, tasks.length - visible.length);
      if (remaining) this.#liveTaskLines.push(`      … +${remaining} pending`);
    } catch { /* Agent/task files may transition atomically between refreshes. */ }
    finally { this.#liveTaskRefreshPending = false; }
  }

  async #monitorAgent(id: string, passive = false): Promise<void> {
    const token = Symbol(id);
    this.#monitorToken = token;
    while (!this.#closed && this.#monitorToken === token) {
      const record = await loadAgent(id);
      if (record.planMode || record.pendingPlanId) this.#planMode = true;
      if (record.stream) {
        const update: AgentStreamUpdate = { agentId: id, ...record.stream };
        // Once a model turn reaches tool execution its completed blocks are
        // rendered from the durable Session; keep only the live activity line.
        if (update.phase === 'tool' || update.phase === 'working') { update.text = ''; delete update.thinking; }
        this.#applyAgentStream(update, false);
      }
      const session = await loadSession(record.sessionId);
      await this.#syncSession(session);
      if (record.status === 'queued' || record.status === 'working') {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 140));
        continue;
      }
      if (record.status === 'completed') {
        const lastAssistant = [...session.messages].reverse().find((message) => message.role === 'assistant');
        const hasProviderThinking = Array.isArray(lastAssistant?.content) && lastAssistant.content.some((block) => block.type === 'thinking');
        if (hasProviderThinking && this.#liveStream?.agentId === id) delete this.#liveStream.thinking;
        const durationMs = Math.max(0, Date.now() - this.#workingStartedAt);
        if (!hasProviderThinking && this.#config) this.#messages.push({ role: 'thinking', text: `Thought for ${Math.max(1, Math.round(durationMs / 1_000))}s`, detail: modelRequestDetail(this.#config, durationMs) });
        const result = record.displayResult ?? record.result ?? 'Task completed.';
        if (!this.#replaceAgentStream(id, record.stream?.turn, result)) this.#messages.push({ role: 'assistant', text: result });
        if (!passive && this.#planMode && record.result) {
          const plan = await createProjectPlan({ cwd: this.#cwd, request: record.goal, content: record.result, sessionId: record.sessionId, planningAgentId: record.id });
          this.#reviewedPlanVersions.set(plan.id, plan.version);
          this.#messages.push({ role: 'system', text: `Plan ${plan.id} saved and awaiting approval.\n${plan.markdownPath}\n\nRun /plan approve ${plan.id} to approve and execute, or /plan changes ${plan.id} <feedback>.` });
        }
      }
      else if (record.status === 'waiting_for_input') {
        this.#showPendingInput(record);
      }
      else if (record.status === 'cancelled') this.#messages.push({ role: 'system', text: 'Interrupted by user.' });
      else this.#messages.push(diagnosticEntry(record.error ?? `Task ended with ${record.status}`));
      if (record.status !== 'completed') { this.#liveStream = undefined; this.#liveTaskLines = []; }
      return;
    }
  }

  async #monitorShellTask(id: string): Promise<void> {
    const token = Symbol(id);
    this.#shellMonitorToken = token;
    while (!this.#closed && this.#shellMonitorToken === token) {
      const output = await getShellTaskOutput(id, 200_000);
      if (output.task.status === 'queued' || output.task.status === 'running') {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 160));
        continue;
      }
      const text = [output.stdout, output.stderr, output.task.error].filter(Boolean).join('\n').trim() || `Process exited with code ${output.task.exitCode ?? 1}`;
      this.#messages.push({ role: 'tool_result', text: `${output.task.id}\n${text}`, isError: output.task.status !== 'completed' });
      return;
    }
  }

  async #interrupt(): Promise<void> {
    if (this.#working && this.#activeShellTaskId) {
      await stopShellTask(this.#activeShellTaskId);
      this.#shellMonitorToken = undefined;
      this.#queuedInputs = [];
      this.#messages = this.#messages.filter((message) => message.role !== 'queued');
      this.#render();
      return;
    }
    if (this.#working && this.#activeAgentId) {
      await cancelAgent(this.#activeAgentId);
      this.#queuedInputs = [];
      this.#messages = this.#messages.filter((message) => message.role !== 'queued');
      this.#render();
      return;
    }
    if (this.#input) {
      this.#input = '';
      this.#cursor = 0;
      this.#selected = 0;
      this.#historySearch = false;
      this.#render();
      return;
    }
    const now = Date.now();
    if (now - this.#lastInterruptAt < 900) { this.#close(); return; }
    this.#lastInterruptAt = now;
    this.#messages.push({ role: 'system', text: 'Press Ctrl+C again to exit.' });
    this.#render();
  }

  async #cyclePermissionMode(): Promise<void> {
    if (!this.#config) return;
    if (this.#working) { this.#messages.push({ role: 'system', text: 'Wait for the current turn to finish before changing execution mode.' }); this.#render(); return; }
    if (managedPermissionFields().includes('mode')) {
      this.#sessionPermissionMode = undefined;
      this.#config = await loadConfig(this.#cwd);
      this.#messages.push({ role: 'system', text: 'Permission mode is managed by your administrator; keyboard overrides are disabled.' });
      this.#render(); return;
    }
    if (['restricted', 'sandbox', 'bypass'].includes(this.#config.policy.mode) && !this.#planMode) { this.#messages.push({ role: 'system', text: 'Use /permissions to explicitly change this security mode. The shortcut cannot relax it.' }); this.#render(); return; }
    const next: PermissionMode = this.#planMode ? 'normal' : this.#config.policy.mode === 'normal' ? 'acceptEdits' : 'restricted';
    this.#planMode = !this.#planMode && next === 'restricted';
    this.#sessionPermissionMode = next;
    this.#config = { ...this.#config, policy: { ...this.#config.policy, mode: next } };
    this.#mcpWatches.reconcile(this.#config);
    if (this.#platform) this.#platform.config = this.#config;
    this.#messages.push({ role: 'system', text: this.#planMode ? 'Plan mode: read-only research; changes require explicit Plan approval.' : `Permission mode: ${permissionModeLabel(next)}` });
    this.#render();
  }

  async #command(value: string): Promise<void> {
    const [rawName, ...parts] = value.split(/\s+/);
    const name = rawName ? resolveNativeCommand(rawName)?.name ?? rawName : rawName;
    const argument = value.slice(rawName?.length ?? 0).trim();
    // Invalid settings must never prevent exiting and cleaning up owned listeners.
    if (name === '/exit' || name === '/quit') { this.#close(); return; }
    try {
    // Apply the same session overrides and managed-policy precedence as rendering.
    // A listener must not briefly start with stale disk permissions.
    await this.#reloadPlatform(false);
    const platform = this.#platform!;
    const config = platform.config;
      switch (name) {
        case '/exit':
        case '/quit': this.#close(); return;
        case '/help':
          this.#messages.push({ role: 'system', text: `Keyboard\n  Ctrl+C interrupt · Ctrl+D exit · Ctrl+B background · Ctrl+T tasks\n  Ctrl+R history · Ctrl+S stash/scope · Ctrl+O transcript · Ctrl+L redraw\n  Ctrl+J / Shift+Enter / \\+Enter newline · Ctrl+G external editor\n  Esc Esc rewind · Shift+Tab permission mode · Alt+P model · Alt+T thinking · Alt+O fast\n  Ctrl+X Ctrl+K twice stops background Agents\n\nCommands\n${this.#commands().map((command) => `${command.name} ${(command.argument ?? '').padEnd(Math.max(1, 32 - command.name.length))} ${command.description}`).join('\n')}` });
          break;
        case '/clear': {
          if (this.#working) throw new Error('Wait for or interrupt the active task before clearing the view.');
          if (argument) {
            const previous = await this.#currentSession();
            if (!previous) throw new Error('No active conversation to name. Use /clear without a name.');
            await renameSession(previous.id, argument);
          }
          this.#activeAgentId = undefined;
          this.#queuedInputs = [];
          this.#resumedSessionId = undefined;
          this.#seenSessionEvents.clear();
          this.#sessionHistory = [];
          this.#history = [];
          this.#historyScope = 'session';
          await clearPromptHistory({ cwd: this.#cwd, sessionKey: this.#historySessionKey, scope: 'session' });
          this.#messages = [{ role: 'system', text: 'Started a fresh conversation. Previous sessions remain resumable.' }];
          break;
        }
        case '/brainstorm':
        case '/brainstorming': {
          if (this.#working) throw new Error('Wait for the active task or interrupt it before starting a discussion.');
          const current = this.#activeAgentId ? await loadAgent(this.#activeAgentId) : undefined;
          if (current && ['working', 'queued', 'waiting_for_input'].includes(current.status)) throw new Error('Finish the active question or use /clear before starting a new discussion.');
          await this.#withForegroundActivity(async () => {
            this.#messages.push({ role: 'system', text: 'Brainstorm · discussion only · project write/shell/delegation tools disabled. Use /clear to leave this workflow.' });
            const sessionId = current?.sessionId ?? this.#resumedSessionId;
            const record = await spawnAgent({ goal: argument || 'Help me clarify what to design in this project. Start by asking my goal.', cwd: this.#cwd, config, role: 'lead', instructions: BRAINSTORM_INSTRUCTIONS, allowedTools: BRAINSTORM_TOOLS, isolation: 'none', background: true, ...(sessionId ? { sessionId } : {}) });
            this.#activeAgentId = record.id; this.#resumedSessionId = undefined;
            await this.#monitorAgent(record.id);
          });
          break;
        }
        case '/questions': {
          const record = this.#activeAgentId ? await loadAgent(this.#activeAgentId) : undefined;
          if (!record || record.status !== 'waiting_for_input') throw new Error('No question is waiting for an answer.');
          this.#showPendingInput(record); break;
        }
        case '/config': await this.#openConfigDialog('Config'); break;
        case '/settings': await this.#openConfigDialog('Settings'); break;
        case '/plan': {
          const [planAction, planId, ...planRest] = argument.split(/\s+/).filter(Boolean);
          if (planAction === 'list' || planAction === 'status') {
            const plans = await listPlanRecords(this.#cwd);
            for (const plan of plans) this.#reviewedPlanVersions.set(plan.id, plan.version);
            this.#messages.push({ role: 'system', text: plans.length ? plans.map((plan) => `${plan.id}  ${plan.status.padEnd(18)}  v${plan.version}  ${plan.title}`).join('\n') : 'No persistent plans in this workspace.' });
            break;
          }
          if (planAction === 'show' && planId) {
            const plan = await loadProjectPlan(this.#cwd, planId);
            this.#reviewedPlanVersions.set(plan.id, plan.version);
            this.#messages.push({ role: 'system', text: `${plan.id} · ${plan.status} · v${plan.version}\n${plan.markdownPath}\n\n${plan.content}` });
            break;
          }
          if (planAction === 'recover' && planId) {
            const plan = await recoverProjectPlanExecution(this.#cwd, planId);
            this.#messages.push({ role: 'system', text: `Plan ${plan.id}: ${plan.status}. Recovery inspection never replays work.${plan.error ? `\n${plan.error}` : ''}` });
            break;
          }
          if (['changes', 'reject', 'cancel'].includes(planAction ?? '') && planId) {
            const status = planAction === 'changes' ? 'changes_requested' : planAction === 'reject' ? 'rejected' : 'cancelled';
            const before = await loadProjectPlan(this.#cwd, planId);
            const plan = await transitionProjectPlan(this.#cwd, planId, status, { expectedVersion: before.version, comment: planRest.join(' ') || planAction || status });
            this.#messages.push({ role: 'system', text: `Plan ${plan.id}: ${plan.status}${plan.decisionComment ? `\n${plan.decisionComment}` : ''}` });
            break;
          }
          if ((planAction === 'approve' || planAction === 'execute') && planId) {
            const selectedPlan = await loadProjectPlan(this.#cwd, planId);
            const lead = this.#activeAgentId ? await loadAgent(this.#activeAgentId) : undefined;
            const planner = selectedPlan.planningAgentId ? await loadAgent(selectedPlan.planningAgentId) : undefined;
            const keepLead = planRest.includes('--background') || Boolean(lead && planner && lead.id !== planner.id && (lead.teamSessionId ?? lead.sessionId) === (planner.teamSessionId ?? planner.sessionId));
            if (planAction === 'approve') {
              const expectedIndex = planRest.indexOf('--expected-version');
              const reviewed = expectedIndex >= 0 ? Number(planRest[expectedIndex + 1]) : this.#reviewedPlanVersions.get(planId);
              if (!Number.isSafeInteger(reviewed) || reviewed !== selectedPlan.version) throw new Error('Plan changed or was not reviewed in this window. Run /plan show <id>, then approve the reviewed version.');
              const approvalComment = planRest.filter(part => part !== '--background').join(' ');
              await transitionProjectPlan(this.#cwd, planId, 'approved', { expectedVersion: reviewed!, ...(approvalComment ? { comment: approvalComment } : {}) });
            }
            if (keepLead) {
              const record = await executeProjectPlan({ cwd: this.#cwd, planId, background: true });
              this.#messages.push({ role: 'system', text: `Executing approved plan ${planId} with background Agent ${record.id}.\nLead conversation unchanged. Inspect /team plans or /tasks.` });
              break;
            }
            this.#planMode = false;
            this.#sessionPermissionMode = undefined;
            this.#working = true;
            this.#workingStartedAt = Date.now();
            this.#render();
            try {
              const record = await executeProjectPlan({ cwd: this.#cwd, planId, background: true });
              this.#activeAgentId = record.id;
              this.#messages.push({ role: 'system', text: `Executing approved plan ${planId} with Agent ${record.id}.` });
              await this.#monitorAgent(record.id);
            } finally {
              this.#working = false;
              this.#liveStream = undefined;
              this.#liveTaskLines = [];
            }
            break;
          }
          this.#planMode = true;
          this.#sessionPermissionMode = 'restricted';
          const planConfig: PlatformConfig = { ...config, policy: { ...config.policy, mode: 'restricted' } };
          this.#config = planConfig;
          if (this.#platform) this.#platform.config = planConfig;
          this.#messages.push({ role: 'system', text: `Plan mode enabled for this session.${argument ? ' Starting the supplied planning task…' : ' Your next prompt will research and propose a plan without editing files.'}` });
          if (argument) {
            const plan = await this.#runExtensionCommand(localWorkflow('/plan')!, argument, planConfig);
            if (plan) {
              const planningAgent = this.#activeAgentId ? await loadAgent(this.#activeAgentId) : undefined;
              const saved = await createProjectPlan({ cwd: this.#cwd, request: argument, content: plan, ...(planningAgent ? { sessionId: planningAgent.sessionId, planningAgentId: planningAgent.id } : {}) });
              this.#reviewedPlanVersions.set(saved.id, saved.version);
              this.#messages.push({ role: 'system', text: `Plan ${saved.id} saved and awaiting approval.\n${saved.markdownPath}\n\nRun /plan approve ${saved.id} to approve and execute, or /plan changes ${saved.id} <feedback>.` });
            }
          }
          break;
        }
        case '/model':
          if (!argument) this.#openModelPicker();
          else {
            await runHooks(config, 'PreModelSwitch', { old_model: config.model.name, new_model: argument, source: 'user' }, this.#cwd);
            this.#sessionModel = { name: argument, effort: config.model.reasoningEffort };
            this.#config = { ...config, model: { ...config.model, name: argument } };
            this.#messages.push({ role: 'system', text: `Using ${argument} for this session only.` });
            await runHooks(this.#config!, 'PostModelSwitch', { old_model: config.model.name, new_model: argument, source: 'user' }, this.#cwd);
          }
          break;
        case '/effort': {
          if (!argument) { this.#openEffortPicker(); break; }
          const effort = argument === 'auto' ? 'high' : argument;
          if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Usage: /effort [low|medium|high|xhigh|max|auto]');
          this.#sessionModel = { name: config.model.name, effort: effort as PlatformConfig['model']['reasoningEffort'] };
          this.#config = { ...config, model: { ...config.model, reasoningEffort: effort as PlatformConfig['model']['reasoningEffort'], thinkingEnabled: true } };
          this.#messages.push({ role: 'system', text: `Using ${effort} effort for this session only.` });
          break;
        }
        case '/fast': {
          const enabled = argument ? argument === 'on' : !config.model.fastMode;
          if (argument && !['on', 'off'].includes(argument)) throw new Error('Usage: /fast [on|off]');
          this.#config = await patchProjectSettings(this.#cwd, { model: { fastMode: enabled } });
          this.#messages.push({ role: 'system', text: `Fast mode ${enabled ? 'enabled' : 'disabled'}.` });
          break;
        }
        case '/endpoint':
          if (!argument) this.#messages.push({ role: 'system', text: `Endpoint: ${config.model.baseUrl ?? 'not configured'}` });
          else { new URL(argument); this.#config = await patchProjectSettings(this.#cwd, { model: { baseUrl: argument } }); this.#messages.push({ role: 'system', text: `Endpoint changed to ${argument}` }); }
          break;
        case '/endpoint-url':
          if (!argument) this.#messages.push({ role: 'system', text: `Complete endpoint: ${config.model.endpointUrl ?? 'not configured'}` });
          else { new URL(argument); this.#config = await patchProjectSettings(this.#cwd, { model: { endpointUrl: argument } }); this.#messages.push({ role: 'system', text: `Complete endpoint changed to ${argument}` }); }
          break;
        case '/max-context': {
          if (!argument) { this.#messages.push({ role: 'system', text: `Context budget: ${config.model.maxContextTokens} tokens` }); break; }
          const tokens = Number(argument);
          if (!Number.isInteger(tokens) || tokens < 1_000) throw new Error('Context budget must be an integer of at least 1000');
          this.#config = await patchProjectSettings(this.#cwd, { model: { maxContextTokens: tokens } });
          this.#messages.push({ role: 'system', text: `Context budget changed to ${tokens} tokens` });
          break;
        }
        case '/permissions': {
          if (!argument || argument === 'recent') { await this.#openPermissionsDialog(argument === 'recent'); break; }
          if (argument === 'reset') {
            if (this.#working) throw new Error('Stop the running Agent before resetting its approvals.');
            const session = await this.#currentSession(); if (!session) throw new Error('No current session.');
            await resetSessionPermissions(session.id);
            this.#messages.push({ role: 'system', text: 'Session approvals and user denials cleared. Configured and managed permission rules are unchanged.' }); break;
          }
          const selected = parsePermissionMode(argument);
          if (!selected) throw new Error('Mode must be one of: default, acceptEdits, plan, bypassPermissions, sandbox');
          this.#config = await patchProjectSettings(this.#cwd, { policy: { mode: selected, ...(selected === 'restricted' ? { allowNetwork: false } : {}) } });
          this.#messages.push({ role: 'system', text: `Permission mode changed to ${permissionModeLabel(selected)}` });
          break;
        }
        case '/mode': {
          if (!argument || argument === 'list') {
            const rules = config.policy.permissionRules;
            this.#messages.push({ role: 'system', text: `Permission mode: ${permissionModeLabel(config.policy.mode)}\n\nAllow rules (project settings):\n${rules.allow.map((rule) => `  ${rule}`).join('\n') || '  (none)'}\nAsk rules (project settings):\n${rules.ask.map((rule) => `  ${rule}`).join('\n') || '  (none)'}\nDeny rules (project settings):\n${rules.deny.map((rule) => `  ${rule}`).join('\n') || '  (none)'}\nWorking directories:\n${config.policy.workspaceRoots.map((root) => `  ${root}`).join('\n')}` });
            break;
          }
          const selected = parsePermissionMode(argument);
          if (!selected) throw new Error('Mode must be one of: default, acceptEdits, plan, bypassPermissions, sandbox');
          this.#config = await patchProjectSettings(this.#cwd, { policy: { mode: selected, ...(selected === 'restricted' ? { allowNetwork: false } : {}) } });
          this.#messages.push({ role: 'system', text: `Permission mode changed to ${permissionModeLabel(selected)}` });
          break;
        }
        case '/add-dir': {
          if (!argument) throw new Error('Usage: /add-dir <path>');
          const path = resolve(this.#cwd, argument);
          if (!(await stat(path)).isDirectory()) throw new Error('Additional workspace root must be an existing directory');
          const added = !config.policy.workspaceRoots.some(root => sameWorkspace(root, path));
          const roots = [...new Set([...config.policy.workspaceRoots, path])];
          this.#config = await patchProjectSettings(this.#cwd, { policy: { workspaceRoots: roots } });
          this.#messages.push({ role: 'system', text: `Added workspace root: ${path}` });
          if (added) {
            const notices = await notifyLifecycle(this.#config, this.#cwd, 'DirectoryAdded', { path, source: 'slash_command', sessionId: (await this.#currentSession())?.id });
            if (notices.length) this.#messages.push({ role: 'system', text: notices.join('\n') });
          }
          break;
        }
        case '/agents': {
          if (parts[0] === 'conflicts') {
            this.#messages.push({ role: 'system', text: stringify(await inspectGitConflicts(this.#cwd, config)) + '\nResolve these conflicts explicitly; no side was selected automatically.' }); break;
          }
          if (parts[0] === 'recovery-list') {
            this.#messages.push({ role: 'system', text: stringify(await listWorktreeRecoveries(this.#cwd, config)) });
            break;
          }
          const [action, id] = parts;
          if (!action) {
            const records = (await listAgents()).filter((agent) => sameWorkspace(agent.cwd, this.#cwd));
            const item = agentResourceItem;
            this.#openResource('agents', 'Agents', ['Running', 'Library', 'History'], [
              records.filter((agent) => ['queued', 'working', 'waiting_for_input'].includes(agent.status)).map(item),
              platform.agents.map((profile) => ({ id: profile.name, label: profile.name, description: profile.description, detail: `${profile.description}\nSource: ${profile.source}\nDefinition: ${profile.path}\n\nRun with /agent ${profile.name} <goal>` })),
              records.filter((agent) => !['queued', 'working', 'waiting_for_input'].includes(agent.status)).map(item),
            ]);
            break;
          }
          if (!id) throw new Error(`Usage: ${name} <attach|wait|cancel|merge|cleanup> <agent-id>`);
          await projectAgent(this.#cwd, id);
          if (action === 'wait') this.#messages.push({ role: 'system', text: stringify(await waitForAgent(id)) });
          else if (action === 'attach') await this.#attachAgent(id);
          else if (action === 'cancel') this.#messages.push({ role: 'system', text: stringify(await stopProjectTask(this.#cwd, id)) });
          else if (action === 'merge' || action === 'cleanup') {
            const agent = await loadAgent(id);
            if (['queued', 'working', 'waiting_for_input'].includes(agent.status)) throw new Error('Stop or finish the Agent before merging or removing its worktree.');
            if (!agent.worktree) throw new Error(`Agent ${id} has no worktree`);
            if (action === 'merge') await mergeWorktree(agent.cwd, agent.worktree, agent.id, config); else await removeWorktree(agent.cwd, agent.worktree, config);
            delete agent.worktree;
            const { saveAgent } = await import('./agent.js');
            await saveAgent(agent);
            this.#messages.push({ role: 'system', text: `${action === 'merge' ? 'Merged' : 'Removed'} worktree for ${id}` });
          } else throw new Error(`Unknown Agent action: ${action}`);
          break;
        }
        case '/notifications': {
          if (parts[0] === 'read') {
            if (!parts[1] || !parts[2] || parts.length !== 3) throw new Error('Usage: /notifications read <id> <version>');
            this.#messages.push({role:'system',text:stringify(await markProjectNotificationsRead(this.#cwd,[parts[1]],parts[2]))});
          } else {
            const offset = parts[0] === undefined ? 0 : Number(parts[0]);
            const page = await listProjectNotifications(this.#cwd,{offset,limit:100});
            this.#openResource('notifications','Notifications',['Latest'],[page.items.map(item=>({id:item.id,label:item.title,description:`${item.readAt ? 'read' : 'unread'} · ${item.level}`,detail:`${item.createdAt}\n\n${item.body}\n\nViewing does not mark read.\n/notifications read ${item.id} ${page.version}${page.nextOffset===null ? '' : `\nOlder: /notifications ${page.nextOffset}`}`}))]);
            if(this.#dialog?.type==='resource')this.#dialog.notificationOffset=offset;
          }
          break;
        }
        case '/tasks': {
          const active = this.#activeAgentId ? await loadAgent(this.#activeAgentId) : undefined;
          const teamSessionId = active?.teamSessionId ?? active?.sessionId;
          if (!argument) {
            const agents = (await listAgents()).filter((agent) => sameWorkspace(agent.cwd, this.#cwd));
            const shells = await listShellTasks({ cwd: this.#cwd });
            const todos = teamSessionId ? await listTasks(teamSessionId) : [];
            this.#openResource('tasks', 'Background tasks', ['Running', 'History', 'Todos'], [
              [
                ...this.#mcpWatches.list().filter(activeMcpWatch).map(mcpWatchItem),
                ...agents.filter((agent) => ['queued', 'working', 'waiting_for_input'].includes(agent.status)).map(agentResourceItem),
                ...shells.filter((task) => ['queued', 'running'].includes(task.status)).map((task) => ({ id: task.id, label: `${task.command} · ${task.status}`, description: task.id, actions: ['stop' as const] })),
              ],
              [
                ...this.#mcpWatches.list().filter(task => !activeMcpWatch(task)).map(mcpWatchItem),
                ...agents.filter((agent) => !['queued', 'working', 'waiting_for_input'].includes(agent.status)).map(agentResourceItem),
                ...shells.filter((task) => !['queued', 'running'].includes(task.status)).map((task) => ({ id: task.id, label: `${task.command} · ${task.status}`, description: task.id })),
              ],
              todos.map((task) => ({ id: task.id, label: `${task.title} · ${task.status}`, description: task.description, detail: task.result ?? task.error ?? task.description })),
            ]);
            break;
          }
          if (parts[0] === 'claim' && parts[1]) {
            if (!active || !teamSessionId) throw new Error('No active Agent team');
            this.#messages.push({ role: 'system', text: stringify(await claimTask(parts[1], teamSessionId, active.id)) });
          } else if (parts[0] === 'output' && parts[1]) this.#messages.push({ role: 'system', text: parts[1].startsWith('mcpwatch_') ? mcpWatchItem(this.#mcpWatches.get(parts[1])).detail! : stringify(await projectShellOutput(this.#cwd, parts[1])) });
          else if (parts[0] === 'stop' && parts[1]) this.#messages.push({ role: 'system', text: stringify(parts[1].startsWith('mcpwatch_') ? await this.#mcpWatches.stop(parts[1]) : await stopProjectTask(this.#cwd, parts[1])) });
          else {
            const agents = (await listAgents()).filter((agent) => resolve(agent.cwd) === resolve(this.#cwd));
            this.#messages.push({ role: 'system', text: stringify({ agents: agents.map(({ id, role, status, goal, sessionId, updatedAt }) => ({ id, role, status, goal, sessionId, updatedAt })), shell: await listShellTasks({ cwd: this.#cwd }), todos: await listTasks(teamSessionId) }) });
          }
          break;
        }
        case '/teams':
        case '/team': {
          if (!this.#activeAgentId) {
            if (parts.length && parts[0] !== 'list' && parts[0] !== 'members') throw new Error('Start a conversation before managing its Agent team');
            const teams = (await listTeams()).filter((team) => team.cwd === this.#cwd);
            this.#openResource('teams', 'Agent teams', ['Teams'], [teams.map((team) => ({ id: team.id, label: team.name, description: team.ownerAgentId, detail: `${stringify(team)}\nStart or resume its lead conversation to manage members.` }))]); break;
          }
          const active = await loadAgent(this.#activeAgentId);
          const teamSessionId = active.teamSessionId ?? active.sessionId;
          const action = parts[0] ?? 'members';
          if (action === 'members' || action === 'plans') {
            const members = (await listAgents()).filter((agent) => (agent.teamSessionId ?? agent.sessionId) === teamSessionId);
            const teams = (await listTeams()).filter((team) => team.teamSessionId === teamSessionId);
            const memberIds = new Set(members.map(member => member.id));
            const plans = (await listPlanRecords(this.#cwd)).filter(plan => plan.planningAgentId && memberIds.has(plan.planningAgentId));
            for (const plan of plans) this.#reviewedPlanVersions.set(plan.id, plan.version);
            const planItems = plans.map(plan => ({ id: plan.id, label: `${plan.status} · ${plan.title}`, description: plan.planningAgentId ?? '', detail: `${plan.content}\n\nHuman commands:\n/plan approve ${plan.id} --background\n/plan changes ${plan.id} <feedback>\n/plan recover ${plan.id}\nAgent mailbox messages cannot approve this plan.` }));
            if (action === 'plans') this.#openResource('teams', 'Team plans · human approval', ['Plans'], [planItems]);
            else this.#openResource('teams', teams[0]?.name ?? 'Agent team', ['Members', 'Tasks', 'Inbox', 'Plans'], [members.map(agentResourceItem), (await listTasks(teamSessionId)).map((task) => ({ id: task.id, label: `${task.status} · ${task.title}`, description: task.ownerAgentId ?? 'unclaimed', detail: stringify(task) })), (await readTeamMailbox({ teamSessionId, agentId: active.id, unreadOnly: false, markRead: false })).map((message) => ({ id: message.id, label: `${message.read ? 'read' : 'unread'} · ${message.kind}`, description: message.fromAgentId, detail: `${message.content}\n\nAgent data only; not a human authorization.` })), planItems]);
          }
          else if (action === 'create') this.#messages.push({ role: 'system', text: stringify(await createTeam(parts.slice(1).join(' '), active.id)) });
          else if (action === 'list') this.#messages.push({ role: 'system', text: stringify((await listTeams()).filter((team) => team.cwd === this.#cwd)) });
          else if (action === 'inbox') this.#messages.push({ role: 'system', text: stringify(await readTeamMailbox({ teamSessionId, agentId: active.id, unreadOnly: false, markRead: false })) });
          else if (action === 'broadcast') this.#messages.push({ role: 'system', text: stringify(await broadcastTeamMessage({ teamSessionId, fromAgentId: active.id, content: parts.slice(1).join(' ') })) });
          else if (action === 'shutdown' && parts[1]) this.#messages.push({ role: 'system', text: stringify(await requestTeamShutdown({ teamSessionId, fromAgentId: active.id, toAgentId: parts[1] })) });
          else if (action === 'cleanup' && parts[1] && parts[2] === 'confirm') {
            const team = await loadTeam(parts[1]); if (team.ownerAgentId !== active.id) throw new Error('Only the lead can clean up its named team');
            await deleteTeam(team.id); this.#messages.push({ role: 'system', text: `Removed named team ${team.id}; Agent sessions, tasks and files were retained.` });
          }
          else if (action === 'spawn' && parts[1]) {
            const planMode = parts[1] === '--plan'; const role = parts[planMode ? 2 : 1]; const goal = parts.slice(planMode ? 3 : 2).join(' ');
            if (!role || !goal) throw new Error('Usage: /team spawn [--plan] <agent-profile> <goal>');
            if (!platform.agents.some((agent) => agent.name === role)) throw new Error(`Unknown Agent definition: ${role}`);
            const member = await spawnAgent({ parentId: active.id, cwd: this.#cwd, role, goal, config, background: true, planMode });
            this.#messages.push({ role: 'system', text: `Teammate ${member.id} started with independent session ${member.sessionId}${planMode ? '; Plan mode requires human approval before implementation' : ''}. Lead conversation unchanged.` });
          }
          else if (action === 'send' && parts[1]) {
            const content = parts.slice(2).join(' ');
            this.#messages.push({ role: 'system', text: stringify(await sendTeamMessage({ teamSessionId, fromAgentId: active.id, toAgentId: parts[1], content })) });
          } else throw new Error('Usage: /team [members|plans|create <name>|list|spawn [--plan] <profile> <goal>|inbox|send <id> <message>|broadcast <message>|shutdown <id>|cleanup <team-id> confirm]');
          break;
        }
        case '/agent': {
          const [agentName, ...goalParts] = parts;
          if (!agentName) {
            this.#messages.push({ role: 'system', text: stringify(platform.agents.map(({ name: profileName, description, source, tools, skills }) => ({ name: profileName, description, source, tools, skills }))) });
            break;
          }
          const profile = platform.agents.find((item) => item.name === agentName);
          if (!profile) throw new Error(`Unknown Agent definition: ${agentName}`);
          const goal = goalParts.join(' ').trim();
          if (!goal) { this.#messages.push({ role: 'system', text: stringify(profile) }); break; }
          const background = profile.background ?? false;
          if (background) {
            const record = await spawnAgent({ goal, cwd: this.#cwd, config, role: profile.name, ...(profile.isolation ? { isolation: profile.isolation } : {}), background: true });
            this.#messages.push({ role: 'system', text: `Started ${record.id} with ${profile.name} in ${record.status} state.` });
          } else await this.#withForegroundActivity(async () => {
            const record = await spawnAgent({ goal, cwd: this.#cwd, config, role: profile.name, ...(profile.isolation ? { isolation: profile.isolation } : {}), background: false, onEvent: (event) => this.#applyRuntimeEvent(event) });
            this.#activeAgentId = record.id;
            const text = record.result ?? record.error ?? `Agent ended with ${record.status}`;
            if (record.status !== 'completed' || !this.#replaceAgentStream(record.id, record.stream?.turn, text)) this.#messages.push({ role: record.status === 'completed' ? 'assistant' : 'error', text });
          });
          break;
        }
        case '/sessions': this.#messages.push({ role: 'system', text: stringify((await listSessions()).map(({ id, parentId, title, updatedAt }) => ({ id, parentId, title, updatedAt }))) }); break;
        case '/resume': {
          if (!argument) { await this.#openResumePicker(); break; }
          await this.#attachSession(await resolveSessionReference(this.#cwd, argument));
          break;
        }
        case '/replay': {
          const selected=parts.filter(part=>part!=='--include-text'),id=selected[0]??(await this.#currentSession())?.id;
          if(!id)throw new Error('No active conversation; use /replay SESSION_ID');
          this.#messages.push({role:'system',text:stringify(await(await import('./runtimeReplay.js')).runtimeReplay(this.#cwd,id,selected[1],100,parts.includes('--include-text')))});break;
        }
        case '/branch': {
          if (this.#working) throw new Error('Finish or background the current task before branching.');
          const session = await this.#currentSession();
          if (!session) throw new Error('No active conversation');
          await assertSessionIdle(session.id);
          const fork = await forkSession(session.id, argument ? argument.slice(0, 80) : undefined);
          await this.#attachSession(fork.id);
          this.#messages.push({ role: 'system', text: `Branched conversation\nNew session: ${fork.id}\nOriginal session: ${session.id}\nNo model request has been sent.` });
          break;
        }
        case '/status':
          if (argument === 'agent') this.#messages.push({ role: 'system', text: this.#activeAgentId ? stringify(await loadAgent(this.#activeAgentId)) : 'No active interactive agent.' });
          else await this.#openConfigDialog('Status');
          break;
        case '/context': {
          const session = await this.#currentSession();
          if (!session) { this.#messages.push({ role: 'system', text: 'No active conversation.' }); break; }
          if (session.compaction) this.#messages.push({ role: 'system', text: `Last summary: ${session.compaction.method === 'semantic' ? 'model-generated handoff (fallible)' : 'local extractive excerpts'}${session.compaction.fallback ? ' · semantic refinement fell back; see saved session compaction metadata' : ''}. Full original transcript remains available through /export.` });
          const estimatedTokens = countModelText(config.model,contextMessages(session.messages));
          const last = (await listUsage({ sessionId: session.id })).at(-1);
          if (session.contextRecovery) {
            const recovery = session.contextRecovery;
            this.#messages.push({ role: 'system', text: `Last context recovery: ${recovery.at} · ${recovery.source} · retry ${recovery.attempt}/2 · ~${recovery.before} → ~${recovery.after} conversation tokens · runtime window ${recovery.window}` });
          }
          this.#messages.push({ role: 'system', text: `Session: ${session.id}\nActive messages: ${session.messages.length} · Archived: ${session.archivedMessages?.length ?? 0}\nConversation-only estimate now: ~${estimatedTokens} tokens (excludes system/context/tools)\n${session.contextSnapshot ? formatContextSnapshot(session.contextSnapshot) : 'Full request breakdown unavailable for this older/unstarted session; send a message to capture it.'}\nLast request input: ${last ? `${last.inputTokens} (${last.inputSource ?? 'unknown'})` : 'unavailable'}\nConfigured context budget now: ${config.model.maxContextTokens}\nThis is not cumulative usage or exact remaining capacity.` });
          break;
        }
        case '/usage': {
          if (!argument) { await this.#openConfigDialog('Usage'); break; }
          const allAgents = await listAgents();
          const session = await this.#currentSession();
          if (!session) { this.#messages.push({ role: 'system', text: `No active conversation.\nAgent records: ${allAgents.length}` }); break; }
          this.#messages.push({ role: 'system', text: `Session: ${session.id}\n${formatUsageSummary(summarizeUsage(await listUsage({ sessionId: session.id })))}` });
          break;
        }
        case '/stats': await this.#openConfigDialog('Stats'); break;
        case '/cost':
        case '/insights': {
          const sessionId = this.#activeAgentId ? (await loadAgent(this.#activeAgentId)).sessionId : undefined;
          this.#messages.push({ role: 'system', text: stringify(await usageInsights(sessionId ? { sessionId } : {})) });
          break;
        }
        case '/artifacts': this.#messages.push({ role: 'system', text: stringify((await listArtifacts(this.#cwd)).map(({ id, title, kind, visibility, updatedAt, comments }) => ({ id, title, kind, visibility, updatedAt, comments: comments.length }))) }); break;
        case '/channels': this.#messages.push({ role: 'system', text: stringify(await listChannels(this.#cwd)) }); break;
        case '/routines': this.#messages.push({ role: 'system', text: stringify({ routines: await listRoutines(this.#cwd), runs: await listRoutineRuns(this.#cwd) }) }); break;
        case '/focus':
          this.#focus = !this.#focus;
          this.#messages.push({ role: 'system', text: `Focus view ${this.#focus ? 'enabled' : 'disabled'}.` });
          break;
        case '/vim': {
          const enabled = argument ? argument === 'on' : !config.vimMode;
          if (argument && !['on', 'off'].includes(argument)) throw new Error('Usage: /vim [on|off]');
          this.#config = await patchProjectSettings(this.#cwd, { vimMode: enabled });
          this.#vim = new VimController();
          this.#messages.push({ role: 'system', text: `Vim input mode ${enabled ? 'enabled' : 'disabled'}. Press Esc for NORMAL mode.` });
          break;
        }
        case '/coordinator': {
          const enabled = argument ? argument === 'on' : !config.coordinatorMode;
          if (argument && !['on', 'off'].includes(argument)) throw new Error('Usage: /coordinator [on|off]');
          this.#config = await patchProjectSettings(this.#cwd, { coordinatorMode: enabled });
          this.#messages.push({ role: 'system', text: `Coordinator mode ${enabled ? 'enabled' : 'disabled'}.` });
          break;
        }
        case '/output-style': {
          const styles = await getOutputStyleDirStyles(this.#cwd);
          if (!argument) this.#messages.push({ role: 'system', text: stringify(styles.map(({ name: styleName, description, source }) => ({ name: styleName, description, source, active: config.outputStyle === styleName }))) });
          else {
            const style = styles.find((item) => item.name.toLowerCase() === argument.toLowerCase());
            if (!style) throw new Error(`Unknown output style: ${argument}`);
            this.#config = await patchProjectSettings(this.#cwd, { outputStyle: style.name });
            this.#messages.push({ role: 'system', text: `Active output style: ${style.name}` });
          }
          break;
        }
        case '/copy': {
          const latest = [...this.#messages].reverse().find((message) => message.role === 'assistant');
          if (!latest) throw new Error('No response is available to copy');
          process.stdout.write(`\u001b]52;c;${Buffer.from(latest.text).toString('base64')}\u0007`);
          this.#messages.push({ role: 'system', text: 'Latest response copied through the terminal clipboard protocol.' });
          break;
        }
        case '/rename': {
          if (!argument) throw new Error('Usage: /rename <title>');
          const session = await this.#currentSession();
          if (!session) throw new Error('No active conversation');
          const renamed = await renameSession(session.id, argument);
          this.#messages.push({ role: 'system', text: `Session renamed to ${renamed.title}` });
          break;
        }
        case '/export': {
          const session = await this.#currentSession();
          if (!session) throw new Error('No active conversation');
          const fallback = join(projectStateDir(this.#cwd), 'exports', `${session.id}.md`);
          const path = await exportSession(session, argument || fallback, this.#cwd, config);
          this.#messages.push({ role: 'system', text: `Session exported to ${path}\nIncludes archived history; reasoning and image payloads omitted. Review for sensitive content before sharing.` });
          break;
        }
        case '/compact': {
          const session = await this.#currentSession();
          if (!session) throw new Error('No active conversation');
          await assertSessionIdle(session.id);
          const before = session.messages.length;
          const beforeTokens = countModelText(config.model,contextMessages(session.messages));
          await runHooks(config, 'PreCompact', { sessionId: session.id, trigger: 'manual' }, this.#cwd);
          compactSession(session, config.model.maxContextTokens, { force: true, model:config.model });
          await saveSession(session);
          await runHooks(config, 'PostCompact', { sessionId: session.id, trigger: 'manual', archivedMessages: session.archivedMessages?.length ?? 0 }, this.#cwd);
          this.#messages.push({ role: 'system', text: `Context compacted: ${before} → ${session.messages.length} messages; ~${beforeTokens} → ~${countModelText(config.model,contextMessages(session.messages))} tokens.\n${before === session.messages.length ? 'No complete older user turn could be removed safely. ' : ''}Full original history is retained for export; the latest user turn and its tool results stay together. Summary uses bounded excerpts, not a model-generated semantic summary.` });
          break;
        }
        case '/checkpoint': {
          if (!argument || argument === 'list') {
            this.#messages.push({ role: 'system', text: stringify((await listCheckpoints(this.#cwd)).map(({ id, reason, createdAt, entries }) => ({ id, reason, createdAt, files: entries.length }))) });
            break;
          }
          const active = this.#activeAgentId ? await loadAgent(this.#activeAgentId) : undefined;
          const files = parts.map((path) => resolveWorkspacePath(this.#cwd, path, config.policy.workspaceRoots));
          const checkpoint = await createCheckpoint({ cwd: this.#cwd, config, files, ...(active ? { sessionId: active.sessionId, agentId: active.id } : {}), reason: 'Manual TUI checkpoint' });
          this.#messages.push({ role: 'system', text: `Created ${checkpoint.id} for ${checkpoint.entries.length} files.` });
          break;
        }
        case '/rewind': {
          const session = await this.#currentSession();
          if (session) await assertSessionIdle(session.id);
          if (this.#working) throw new Error('Interrupt the active task before rewinding.');
          const [checkpointId, mode] = parts;
          const checkpoint = await restoreCheckpoint({ cwd: this.#cwd, config, ...(checkpointId && checkpointId !== 'latest' ? { id: checkpointId } : {}), restoreCode: mode !== 'conversation-only', restoreConversation: mode === 'conversation' || mode === 'conversation-only' });
          if ((mode === 'conversation' || mode === 'conversation-only') && checkpoint.sessionId) await this.#attachSession(checkpoint.sessionId);
          this.#messages.push({ role: 'system', text: `Restored ${checkpoint.id}: ${checkpoint.entries.length} files${mode === 'conversation' || mode === 'conversation-only' ? ' and conversation' : ''}.` });
          break;
        }
        case '/memory': this.#messages.push({ role: 'system', text: stringify(await listMemory(argument || 'project')) }); break;
        case '/skills': {
          const [skillName, ...requestParts] = parts;
          if (!skillName) {
            await this.#openSkillsDialog();
            break;
          }
          const skill = platform.skills.find((item) => item.name.toLowerCase() === skillName.toLowerCase() && userInvocableSkill(item));
          if (!skill) throw new Error(`Unknown skill: ${skillName}. Use /skills to list available skills.`);
          const request = requestParts.join(' ').trim();
          if (!request) this.#messages.push({ role: 'system', text: `# ${skill.name}\n\n${skill.description}\n\n${skill.instructions}` });
          else {
            await this.#runUserSkill(skill.name, request, config);
          }
          break;
        }
        case '/plugin': {
          const [action, subject, ...rest] = parts;
          if (!action) { await this.#openMarketplaceDialog(); break; }
          if (['history', 'snapshot', 'rollback'].includes(action) && subject) {
            const { listPluginHistory, snapshotPlugin, rollbackPlugin } = await import('./pluginHistory.js');
            const scope = (action === 'rollback' ? rest[2] : rest[0]) ?? 'project';
            if (scope !== 'project' && scope !== 'local') throw new Error('Plugin scope must be project or local');
            if (action === 'history') this.#messages.push({ role: 'system', text: stringify(await listPluginHistory(this.#cwd, subject, scope)) });
            else if (action === 'snapshot') this.#messages.push({ role: 'system', text: stringify(await snapshotPlugin(this.#cwd, subject, scope)) });
            else {
              if (this.#working) throw new Error('Wait for the foreground task to finish before rolling back a plugin.');
              if (!rest[0] || rest[1] !== 'confirm') throw new Error('Usage: /plugin rollback <name> <revision_ID> confirm [project|local]');
              const restored = await rollbackPlugin(this.#cwd, subject, rest[0], scope);
              this.#messages.push({ role: 'system', text: `Restored ${subject} ${restored.previous.version} → ${restored.version}. Current version retained as ${restored.previous.id}. Run /reload-plugins to activate it.` });
            }
          } else if (action === 'install' && subject) {
            const path = await installMarketplacePlugin(this.#cwd, subject);
            this.#messages.push({ role: 'system', text: `Installed ${subject} to ${path}. Run /reload-plugins to activate its Skills, Agents and slash commands.` });
          } else if (action === 'update' && subject) {
            const updated = await updateMarketplacePlugin(this.#cwd, subject);
            this.#messages.push({ role: 'system', text: `Updated ${updated.name} ${updated.previousVersion} → ${updated.version}. Run /reload-plugins to activate it.` });
          } else if ((action === 'uninstall' || action === 'remove') && subject) {
            await uninstallMarketplacePlugin(this.#cwd, subject);
            await this.#reloadPlatform(false);
            this.#messages.push({ role: 'system', text: `Uninstalled Plugin ${subject}.` });
          } else if (action === 'marketplace' || action === 'market') {
            const operation = subject ?? 'list';
            const value = rest.join(' ').trim();
            if (operation === 'add' && value) this.#messages.push({ role: 'system', text: `Added marketplace ${(await addMarketplace(this.#cwd, value)).name}.` });
            else if (operation === 'list') this.#messages.push({ role: 'system', text: stringify(await listMarketplaces(this.#cwd)) });
            else if (operation === 'update') this.#messages.push({ role: 'system', text: stringify(await refreshMarketplace(this.#cwd, value || undefined)) });
            else if (operation === 'auto-update' && rest[0] && (rest[1] === 'on' || rest[1] === 'off')) this.#messages.push({ role: 'system', text: stringify(await setMarketplaceAutoUpdate(this.#cwd, rest[0], rest[1] === 'on')) });
            else if ((operation === 'remove' || operation === 'rm') && value) { await removeMarketplace(this.#cwd, value); this.#messages.push({ role: 'system', text: `Removed marketplace ${value}.` }); }
            else throw new Error('Usage: /plugin marketplace <add <source>|list|update [name]|auto-update <name> <on|off>|remove <name>>');
          } else if ((action === 'enable' || action === 'disable') && subject) {
            const disabled = new Set(config.disabledPlugins);
            if (action === 'disable') disabled.add(subject); else disabled.delete(subject);
            this.#config = await patchProjectSettings(this.#cwd, { disabledPlugins: [...disabled].sort() });
            this.#messages.push({ role: 'system', text: `${action === 'disable' ? 'Disabled' : 'Enabled'} Plugin ${subject}` });
          } else {
            if (action === 'list') {
              this.#messages.push({ role: 'system', text: stringify({ plugins: platform.plugins.map(({ name: loadedName, version, description, path, format, contributions }) => ({ name: loadedName, version, description, path, format, contributes: { skills: contributions.skills?.length ?? 0, agents: contributions.agents?.length ?? 0, commands: contributions.commands?.length ?? 0, hooks: contributions.hooks?.length ?? 0, mcp: Object.keys(contributions.mcpServers ?? {}).length, lsp: Object.keys(contributions.lspServers ?? {}).length } })), disabled: config.disabledPlugins, diagnostics: platform.diagnostics }) });
              break;
            }
            const plugin = platform.plugins.find((item) => item.name === action);
            if (!plugin) throw new Error(`Unknown plugin command. Use /plugin, /plugin install <name>@<marketplace>, or /plugin marketplace add <source>.`);
            this.#messages.push({ role: 'system', text: stringify(plugin) });
          }
          break;
        }
        case '/init': {
          await ensureProjectClaudeInstructions(this.#cwd);
          const state = await initializePlatform(this.#cwd);
          const foundation = await installFoundationPlugin(this.#cwd);
          this.#messages.push({ role: 'system', text: `Extension workspace initialized: ${state}\nFoundation workflows: ${foundation}` });
          await this.#reloadPlatform(false);
          break;
        }
        case '/ide': {
          if (argument !== 'install') throw new Error('Usage: /ide install');
          this.#messages.push({ role: 'system', text: `Installed VS Code extension: ${await installVsCodeExtension(this.#version)}. Restart VS Code to activate it.` });
          break;
        }
        case '/reload':
        case '/reload-plugins':
        case '/reload-skills': {
          if (argument === '--watch-off') { this.#stopExtensionWatch?.(); this.#stopExtensionWatch = undefined; this.#extensionReload?.dispose(); this.#extensionReload = undefined; }
          else if (argument === '--watch') {
            this.#stopExtensionWatch?.();
            this.#extensionReload?.dispose();
            const paths = extensionStateWatchPaths(config);
            const report = () => { this.#messages.push({ role: 'error', text: 'Extension watch/reload failed or exceeded its bounds; inspect settings and use explicit /reload-plugins.' }); this.#render(); };
            this.#extensionReload = new DeferredStateReload({ busy: () => this.#closed || this.#working || !!this.#dialog || !!this.#trustDialog || this.#workspaceLoading || this.#platformReloads > 0, reload: async () => { await this.#reloadPlatform(true); if (!this.#closed) this.#render(); }, onError: report });
            this.#extensionReload.setPaths(paths);
            this.#stopExtensionWatch = watchLocalState(extensionAuthorityWatchPaths(this.#cwd), () => this.#extensionReload?.invalidate(), { onError: report });
          }
          await this.#reloadPlatform(true); break;
        }
        case '/hooks': {
          this.#openResource('hooks', 'Lifecycle hooks', ['Configured'], [config.hooks.map((hook, index) => ({
            id: String(index), label: hook.event, description: hook.matcher ?? 'All matching events',
            detail: `Event: ${hook.event}\nMatcher: ${hook.matcher ?? '*'}\nTimeout: ${hook.timeoutMs ?? (hook.timeout ? hook.timeout * 1_000 : 'default')}\n\nRead-only inspection. Opening this panel does not execute hooks.\nEdit project settings to change hook commands.`,
          }))]);
          break;
        }
        case '/mcp': {
          if (parts[0] === 'watch') {
            if (!parts[1] || parts.length > 3) throw new Error('Usage: /mcp watch <server> [milliseconds]');
            const task = this.#mcpWatches.start(parts[1], config, parts[2] === undefined ? 60000 : Number(parts[2]));
            this.#messages.push({ role: 'system', text: `MCP listener started: ${task.id}\nServer: ${task.server}. You can keep chatting. /mcp watches shows status; /mcp stop ${task.id} stops it.\nExternal notifications are not sent to the model.` });
            this.#showTasks = true; await this.#refreshTaskPanel();
            break;
          }
          if (parts[0] === 'watches' && parts.length === 1) {
            this.#openResource('mcp', 'MCP notification listeners', ['Listeners'], [this.#mcpWatches.list().map(mcpWatchItem)]);
            break;
          }
          if ((parts[0] === 'events' || parts[0] === 'stop') && parts.length === 2) {
            const task = parts[0] === 'stop' ? await this.#mcpWatches.stop(parts[1]!) : this.#mcpWatches.get(parts[1]!);
            this.#messages.push({ role: 'system', text: `${task.server}: ${task.status}\n${mcpWatchItem(task).detail}` });
            break;
          }
          if (argument) throw new Error('Usage: /mcp [watch <server> [milliseconds]|watches|events <id>|stop <id>]');
          const servers = [...configuredMcpServers(config)];
          if (!servers.length) this.#messages.push({ role: 'system', text: 'No MCP servers configured.\nRun ccpt mcp --help for setup, or /doctor to diagnose configuration.\nTeam members can register their own MCP servers in project settings.' });
          else this.#openResource('mcp', 'MCP servers', ['Configured', 'Listeners'], [servers.map(([serverName, server]) => ({
            id: serverName, label: serverName, description: `Transport: ${'url' in server ? 'remote' : 'stdio'}`,
              detail: `Server: ${serverName}\nHTTP mode: ${server.httpMode ?? 'direct (legacy)'}\nViewing does not connect. Press t to confirm a connection and discover tools.\nUse /mcp watch ${serverName} to start notifications explicitly.\nAuthentication: use ccpt mcp login / oauth-login.\nCredentials and command environment values are intentionally hidden.`, actions: ['inspect' as const],
          })), this.#mcpWatches.list().map(mcpWatchItem)]);
          break;
        }
        case '/surface': {
          const registry = await loadSurfaceRegistry(this.#cwd, config);
          if (!argument || parts[0] === 'list') this.#messages.push({ role: 'system', text: stringify(registry.list()) });
          else if (parts[0] === 'health') this.#messages.push({ role: 'system', text: stringify(await surfaceHealth(registry, parts[1])) });
          else throw new Error('Usage: /surface [list|health [name]]');
          break;
        }
        case '/search': {
          if (!argument) throw new Error('Usage: /search <query>');
          const matches = searchTranscript(this.#messages, argument, 50);
          this.#messages.push({ role: 'system', text: matches.length ? matches.map((match, index) => `${index + 1}. ${match.excerpt}`).join('\n') : `No transcript matches for: ${argument}` });
          break;
        }
        case '/color':
        case '/theme': {
          if (!argument) this.#openResource('theme', 'Terminal theme', ['Themes'], [listThemes().map((theme) => ({ id: theme, label: theme, description: `${theme === process.env.CCPT_THEME ? 'Current · ' : ''}Apply for this session · NO_COLOR is respected` }))]);
          else {
            if (!listThemes().includes(argument as ThemeName)) throw new Error(`Theme must be one of: ${listThemes().join(', ')}`);
            process.env.CCPT_THEME = argument;
            applyTuiTheme(argument);
            this.#messages.push({ role: 'system', text: `Terminal theme changed to ${argument} for this session.` });
          }
          break;
        }
        case '/terminal-setup': {
          const terminal = process.env.TERM_PROGRAM ?? process.env.WT_SESSION ? (process.env.TERM_PROGRAM ?? 'Windows Terminal') : process.env.TERM ?? process.platform;
          this.#messages.push({ role: 'system', text: `Terminal: ${terminal}\n\nMultiline input works immediately with Ctrl+J and \\ followed by Enter. Shift+Enter is enabled by the native keybinding layer when your terminal emits the modified Enter sequence.\n\nIf Shift+Enter is intercepted, configure your terminal to send ESC [ 1 3 ; 2 u, then restart CCPT. External prompt editing uses Ctrl+G and ${process.env.VISUAL ?? process.env.EDITOR ?? (process.platform === 'win32' ? 'notepad.exe' : 'vi')}.` });
          break;
        }
        case '/files': this.#input = '@'; this.#cursor = 1; this.#selected = 0; break;
        case '/keybindings': {
          const path = join(projectStateDir(this.#cwd), 'keybindings.json');
          const bindings = await readJson(path, { bindings: [] }); await writeJson(path, bindings);
          this.#messages.push({ role: 'system', text: `Project keybindings: ${path}\nChanges are loaded when the TUI reloads. Use /reload after editing.` });
          break;
        }
        case '/privacy-settings': await this.#openConfigDialog('Config'); break;
        case '/release-notes': this.#messages.push({ role: 'system', text: `CCPT ${this.#version}\n\nAzure Responses protocol, streaming and tool roundtrips; 90% context warning and >95% auto-compaction; opt-in response storage; JSON/stream-json print mode; redacted configuration and CA diagnostics.\n\nFull guide: ${join(this.#cwd, 'docs', 'PRODUCT-GUIDE.zh-CN.md')}` }); break;
        case '/sandbox-toggle': {
          const mode: PermissionMode = config.policy.mode === 'sandbox' ? 'normal' : 'sandbox';
          this.#config = await patchProjectSettings(this.#cwd, { policy: { mode } });
          this.#messages.push({ role: 'system', text: `Permission mode changed to ${permissionModeLabel(mode)}` });
          break;
        }
        case '/session':
          this.#messages.push({ role: 'system', text: stringify((await listSessions()).map(({ id, parentId, title, updatedAt }) => ({ id, parentId, title, updatedAt }))) });
          break;
        case '/undo-conflict': {
          if(this.#working)throw new Error('Wait for the active turn before restoring conflict bytes');
          if(!argument)throw new Error('Usage: /undo-conflict conflict_ID');
          this.#dialog=await createConflictRestoreDialog(this.#cwd,argument,config);break;
        }
        case '/resolve-conflict': {
          if(this.#working)throw new Error('Wait for the active turn before resolving a conflict');
          if(argument)this.#dialog=await createConflictDialog(this.#cwd,argument,config);
          else this.#messages.push({role:'system',text:stringify(await inspectGitConflicts(this.#cwd,config))+'\n/resolve-conflict <exact path> opens the human-only side/deletion review.'});break;
        }
        case '/goal-run': {
          if(this.#working)throw new Error('Wait for the active turn or cancel it before deciding a Goal workflow');
          if(parts[0]==='prepare'){this.#dialog=await createGoalPrepareDialog(this.#cwd);break;}
          if(parts[0]==='show'&&parts[1]){this.#messages.push({role:'system',text:stringify(await inspectGoalWorkflow(this.#cwd,parts[1]))});break;}
          if(['start','resume','recover','cancel'].includes(parts[0]??'')&&parts[1]){this.#dialog=await createGoalDecisionDialog(this.#cwd,parts[1],parts[0] as 'start'|'resume'|'recover'|'cancel',parts.slice(2).join(' ')||undefined);break;}
          if(argument&&argument!=='list')throw new Error('Usage: /goal-run [list|prepare|show ID|start ID|resume ID feedback|recover ID|cancel ID]');
          const runs=await listGoalWorkflows(this.#cwd);this.#openResource('tasks','Goal workflows · human decisions',['Runs'],[runs.items.map(run=>({id:run.id,label:`${run.phase} · v${run.version}`,description:`${run.id} · ${run.requests}/${run.budget.maxRequests} requests`,detail:`${stringify(run)}\n\n/goal-run show ${run.id}\n/goal-run start ${run.id}\n/goal-run resume ${run.id} <feedback>\n/goal-run recover ${run.id}\n/goal-run cancel ${run.id}\nEvery action opens a version-bound confirmation; re-open this list to refresh.`}))]);if(runs.errors.length)this.#messages.push({role:'system',text:stringify(runs.errors)});break;
        }
        case '/goal': {
          const sessionId = (await this.#currentSession())?.id;
          if (!sessionId) throw new Error('Start or resume a conversation before setting its persistent goal');
          const active = (await listSessionGoals(sessionId, this.#cwd)).find(goal => ['active','paused','blocked'].includes(goal.status));
          const action = parts[0]?.toLowerCase();
          if (!argument) this.#messages.push({ role: 'system', text: active ? stringify(active) : 'No active goal. Use /goal set <objective>.' });
          else if (action === 'set') {
            const objective = parts.slice(1).join(' ').trim();
            if (!objective) throw new Error('Usage: /goal set <objective>');
            this.#messages.push({ role: 'system', text: stringify(await setSessionGoal({ sessionId, objective }, this.#cwd)) });
          } else if (['complete','cancel','pause','block','resume'].includes(action ?? '')) {
            if (!active) throw new Error('No active goal');
            const statuses = { complete:'completed', cancel:'cancelled', pause:'paused', block:'blocked', resume:'active' } as const;
            this.#messages.push({ role: 'system', text: stringify(await transitionSessionGoal(active.id, statuses[action as keyof typeof statuses], active.version ?? 1, this.#cwd, parts.slice(1).join(' ') || undefined)) });
          } else this.#messages.push({ role: 'system', text: stringify(await setSessionGoal({ sessionId, objective: argument }, this.#cwd)) });
          break;
        }
        case '/voice': this.#messages.push({ role: 'system', text: stringify(await checkRecordingAvailability()) }); break;
        case '/doctor':
          if(parts[0]==='errors'){const {listModelErrors,modelErrorLogPath}=await import('./modelErrorLog.js');this.#messages.push({role:'system',text:stringify({path:modelErrorLogPath(),errors:await listModelErrors(Number(parts[1]??10)),note:'Bounded/redacted model failures; review before sharing.'})});}
          else if (parts[0] === 'export' && parts[1]) this.#messages.push({ role: 'system', text: `Local redacted diagnostics: ${await exportDiagnosticBundle(this.#cwd, parts.slice(1).join(' '), config, this.#version)}` });
          else this.#messages.push({ role: 'system', text: stringify({ node: process.version, platform: process.platform, checks: await modelDiagnostics(config) }) });
          break;
        case '/wakeups': {
          this.#messages.push({ role: 'system', text: stringify(parts[0] === 'cancel' && parts[1] ? await cancelWakeup(parts[1], this.#cwd) : await listWakeups(this.#cwd)) });
          break;
        }
        case '/diff': {
          const result = await executeCommand('git', ['diff', '--stat'], this.#cwd, config, this.#activeAgentId);
          this.#messages.push({ role: result.code === 0 ? 'system' : 'error', text: result.stdout || result.stderr || 'No changes.' });
          break;
        }
        case '/background':
        case '/worktree': {
          if (!argument) throw new Error(`Usage: ${name} <goal>`);
          const record = await spawnAgent({ goal: argument, cwd: this.#cwd, config, role: 'background', isolation: name === '/worktree' ? 'worktree' : 'none', background: true });
          this.#messages.push({ role: 'system', text: `Started ${record.id} in ${record.status} state.` });
          break;
        }
        default: {
          const knownSkill = (platform.availableSkills ?? platform.skills).find(item => `/${item.name}`.toLowerCase() === name?.toLowerCase());
          if (knownSkill && !userInvocableSkill(knownSkill) && !localWorkflow(name ?? '') && !platform.commands.some(command => command.name === name)) {
            this.#messages.push({ role: 'error', text: knownSkill.userInvocable === false ? `Skill ${knownSkill.name} is model-only (user-invocable: false). Ask the Agent to use it; it cannot be started with a slash command.` : `Skill ${knownSkill.name} is disabled. Re-enable it in /skills or remove its disabled override from settings.` });
            break;
          }
          const skill = platform.skills.find((item) => `/${item.name}` === name && userInvocableSkill(item));
          if (skill && !localWorkflow(name ?? '') && !platform.commands.some((command) => command.name === name)) { await this.#runUserSkill(skill.name, argument, config); break; }
          const skillCommand: RegisteredCommand | undefined = skill ? {
            name: `/${skill.name}`, description: skill.description,
            prompt: argument || `Apply the ${skill.name} skill to the current request and workspace.`,
            plugin: skill.plugin ?? skill.source, skills: [skill.name], isolation: 'none',
          } : undefined;
          const extension = localWorkflow(name ?? '') ?? platform.commands.find((command) => command.name === name) ?? skillCommand;
          if (!extension) { this.#messages.push({ role: 'error', text: `Unknown command: ${name}. Type /help.` }); break; }
          await this.#runExtensionCommand(extension, argument, config);
        }
      }
    } catch (error) {
      this.#messages.push(diagnosticEntry(error));
    }
    await this.#reloadPlatform(false);
  }

  async #runUserSkill(name: string, args: string, config: PlatformConfig): Promise<void> {
    if (this.#working) throw new Error('Wait for the current foreground turn before invoking a Skill');
    const parentId = this.#activeAgentId;
    await this.#withForegroundActivity(async () => {
      const invoked = await invokeUserSkill({ name, args, cwd: this.#cwd, config, planMode: this.#planMode, background: true, ...(parentId ? { agentId: parentId } : this.#resumedSessionId ? { sessionId: this.#resumedSessionId } : {}) });
      this.#activeAgentId = invoked.agent.id; this.#resumedSessionId = undefined;
      this.#messages.push({ role: 'system', text: invoked.forked ? `Skill ${name}: isolated subagent ${invoked.agent.id}; lead conversation retained.` : `Skill ${name}: activated in the current conversation for this turn.` });
      try { await this.#monitorAgent(invoked.agent.id); }
      finally {
        if (invoked.forked && parentId) {
          const finished = await loadAgent(invoked.agent.id);
          this.#activeAgentId = parentId; this.#dialog = undefined;
          this.#messages.push({ role: 'system', text: `Returned to lead ${parentId}.${finished.status === 'waiting_for_input' ? ` Subagent ${finished.id} needs input; inspect and attach through /agents.` : ''}` });
        }
      }
    });
  }

  async #runExtensionCommand(command: RegisteredCommand, argument: string, config: PlatformConfig): Promise<string | undefined> {
    const goal = expandCommand(command, argument, this.#cwd);
    if (!goal) throw new Error(`Extension command ${command.name} produced an empty goal`);
    if (command.background) {
      const record = await spawnAgent({ goal, cwd: this.#cwd, config, role: command.agent ?? 'lead', ...(command.skills ? { skills: command.skills } : {}), isolation: command.isolation ?? 'none', background: true });
      this.#messages.push({ role: 'system', text: `Started ${record.id} from ${command.name} in ${record.status} state.` });
      return undefined;
    }
    return this.#withForegroundActivity(async () => {
      const startedAt = Date.now();
      const record = await spawnAgent({ goal, cwd: this.#cwd, config, role: command.agent ?? 'lead', ...(command.skills ? { skills: command.skills } : {}), isolation: command.isolation ?? 'none', background: false, onEvent: (event) => this.#applyRuntimeEvent(event) });
      this.#activeAgentId = record.id;
      if (record.status === 'completed') {
        const durationMs = Date.now() - startedAt;
        if (!record.stream?.thinking) this.#messages.push({ role: 'thinking', text: `Thought for ${Math.max(1, Math.round(durationMs / 1_000))}s`, detail: modelRequestDetail(config, durationMs) });
        const text = record.result ?? 'Command completed.';
        if (!this.#replaceAgentStream(record.id, record.stream?.turn, text)) this.#messages.push({ role: 'assistant', text });
        return record.result;
      }
      if (record.status === 'waiting_for_input') this.#showPendingInput(record);
      else this.#messages.push(diagnosticEntry(record.error ?? `Command ended with ${record.status}`));
      return undefined;
    });
  }

  #showPendingInput(record: AgentRecord): void {
    const request = parsePermissionRequest(record.result);
    if (request && request.sessionId !== record.sessionId) { this.#messages.push({ role: 'error', text: 'Invalid permission request: session mismatch. No approval offered.' }); return; }
    if (request) { this.#dialog = { ...createPermissionDialog(request), type: 'approval', agentId: record.id, scroll: 0 }; return; }
    const question = createQuestionDialog(record.id, record.result ?? '', Boolean(record.pendingQuestionToolId));
    if (question) { this.#dialog = question; return; }
    this.#messages.push({ role: 'question', text: record.result ?? 'The Agent needs more information.' });
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopProjectWatch?.(); this.#stopExtensionWatch?.();
    this.#stopHookFileWatch?.();
    this.#extensionReload?.dispose();
    void this.#mcpWatches.close();
    if (this.#timer) clearInterval(this.#timer);
    if (this.#marketplaceUpdateTimer) clearTimeout(this.#marketplaceUpdateTimer);
    process.stdin.off('keypress', this.#onKeypress);
    process.stdout.off('resize', this.#render);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdout.write(`${color.reset}${this.#clearDynamicOutput()}${ESC}?25h${ESC}?7h\r\n`);
    this.#resolve?.();
  }
}

export async function runTui(cwd: string, version: string, initialSession?: TuiInitialSession): Promise<void> {
  const app = new TerminalApp(cwd, version, initialSession);
  await app.start();
}
