import { truncateTerminal, tuiTheme } from '../tui/presentation.js';

export type SystemPanelKind = 'auth' | 'policy' | 'update' | 'bridge' | 'remote' | 'teleport' | 'ide' | 'cost' | 'pr' | 'onboarding' | 'warning' | 'feedback' | 'status';
export type SystemPanelTone = 'info' | 'success' | 'warning' | 'error';
export interface SystemPanelAction { id: string; label: string; primary?: boolean; disabled?: boolean }
export interface SystemPanelModel { id: string; kind: SystemPanelKind; title: string; detail?: string; status?: string; progress?: number; tone?: SystemPanelTone; actions?: SystemPanelAction[] }

function tone(value: SystemPanelTone | undefined): string { return value === 'success' ? tuiTheme.success : value === 'warning' ? tuiTheme.warning : value === 'error' ? tuiTheme.error : tuiTheme.accent; }

export function renderSystemPanel(panel: SystemPanelModel, width: number, selectedAction = 0): string[] {
  const inner = Math.max(28, width - 4);
  const lines = [`${tuiTheme.border}╭${'─'.repeat(inner + 2)}╮${tuiTheme.reset}`, `${tuiTheme.border}│${tuiTheme.reset} ${tone(panel.tone)}${tuiTheme.bold}${truncateTerminal(panel.title, inner)}${tuiTheme.reset}${' '.repeat(Math.max(0, inner - panel.title.length))} ${tuiTheme.border}│${tuiTheme.reset}`];
  if (panel.detail) lines.push(`${tuiTheme.border}│${tuiTheme.reset} ${tuiTheme.muted}${truncateTerminal(panel.detail, inner).padEnd(inner)}${tuiTheme.reset} ${tuiTheme.border}│${tuiTheme.reset}`);
  if (panel.status) lines.push(`${tuiTheme.border}│${tuiTheme.reset} ${truncateTerminal(panel.status, inner).padEnd(inner)} ${tuiTheme.border}│${tuiTheme.reset}`);
  if (panel.progress !== undefined) {
    const progress = Math.max(0, Math.min(1, panel.progress)); const barWidth = Math.max(8, inner - 8); const filled = Math.round(barWidth * progress);
    lines.push(`${tuiTheme.border}│${tuiTheme.reset} ${tuiTheme.success}${'━'.repeat(filled)}${tuiTheme.muted}${'─'.repeat(barWidth - filled)}${tuiTheme.reset} ${String(Math.round(progress * 100)).padStart(3)}% ${tuiTheme.border}│${tuiTheme.reset}`);
  }
  if (panel.actions?.length) {
    const actions = panel.actions.map((action, index) => `${index === selectedAction ? tuiTheme.selected : ''}${action.disabled ? tuiTheme.muted : action.primary ? tuiTheme.accent : ''} ${action.label} ${index === selectedAction ? tuiTheme.reset : action.primary || action.disabled ? tuiTheme.reset : ''}`).join(' ');
    lines.push(`${tuiTheme.border}│${tuiTheme.reset} ${truncateTerminal(actions, inner).padEnd(inner)} ${tuiTheme.border}│${tuiTheme.reset}`);
  }
  lines.push(`${tuiTheme.border}╰${'─'.repeat(inner + 2)}╯${tuiTheme.reset}`);
  return lines;
}

export class SurveyController {
  readonly answers = new Map<string, number | string | boolean>();
  #index = 0;
  constructor(readonly questions: readonly string[], readonly allowTranscriptShare = false) { if (!questions.length) throw new Error('Survey requires at least one question'); }
  get index(): number { return this.#index; }
  get current(): string { return this.questions[this.#index]!; }
  answer(value: number | string | boolean): boolean { this.answers.set(this.current, value); if (this.#index < this.questions.length - 1) { this.#index += 1; return false; } return true; }
  previous(): void { this.#index = Math.max(0, this.#index - 1); }
  result(): Record<string, number | string | boolean> { return Object.fromEntries(this.answers); }
}

export const SYSTEM_PANEL_ADAPTERS = Object.freeze({
  ApproveApiKey: 'auth', AutoModeOptInDialog: 'policy', AutoUpdater: 'update', AutoUpdaterWrapper: 'update', AwsAuthStatusBox: 'auth', BridgeDialog: 'bridge',
  ChannelDowngradeDialog: 'warning', ClaudeInChromeOnboarding: 'onboarding', ClaudeMdExternalIncludesDialog: 'warning', ConsoleOAuthFlow: 'auth', CostThresholdDialog: 'cost',
  DevBar: 'status', DevChannelsDialog: 'status', EffortCallout: 'status', EffortIndicator: 'status', Feedback: 'feedback', IdleReturnDialog: 'status',
  MCPServerDesktopImportDialog: 'bridge', NativeAutoUpdater: 'update', Onboarding: 'onboarding', PackageManagerAutoUpdater: 'update', PrBadge: 'pr', RemoteCallout: 'remote',
  RemoteEnvironmentDialog: 'remote', ShowInIDEPrompt: 'ide', SkillImprovementSurvey: 'feedback', TeleportError: 'teleport', TeleportProgress: 'teleport',
  TeleportRepoMismatchDialog: 'teleport', TeleportResumeWrapper: 'teleport', TeleportStash: 'teleport',
} satisfies Record<string, SystemPanelKind>);

export function systemPanelKind(reference: string): SystemPanelKind | undefined { return SYSTEM_PANEL_ADAPTERS[reference.replace(/^.*\//, '').replace(/\.(?:tsx?|jsx?)$/, '') as keyof typeof SYSTEM_PANEL_ADAPTERS]; }
