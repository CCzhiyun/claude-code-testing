import { NotificationCenter, type NativeNotification, type NotificationLevel } from './notifications.js';

export type NotificationKind = 'auto-mode-unavailable' | 'subscription-switch' | 'deprecation' | 'fast-mode' | 'ide-status' | 'install' | 'lsp-initialization' | 'mcp-connectivity' | 'model-migration' | 'npm-deprecation' | 'plugin-autoupdate' | 'plugin-installation' | 'rate-limit' | 'settings-error' | 'startup' | 'teammate-shutdown';
export interface NotificationState { kind: NotificationKind; active: boolean; message?: string; detail?: string; level?: NotificationLevel; key?: string; ttlMs?: number }

const defaults: Record<NotificationKind, { message: string; level: NotificationLevel; sticky?: boolean }> = {
  'auto-mode-unavailable': { message: 'Automatic permission mode is unavailable.', level: 'warning' },
  'subscription-switch': { message: 'A different subscription is available.', level: 'info' },
  deprecation: { message: 'A configured feature is deprecated.', level: 'warning' },
  'fast-mode': { message: 'Fast mode is active.', level: 'info' },
  'ide-status': { message: 'IDE connection status changed.', level: 'info' },
  install: { message: 'Installation status changed.', level: 'info' },
  'lsp-initialization': { message: 'Language server initialization changed.', level: 'info' },
  'mcp-connectivity': { message: 'MCP connectivity changed.', level: 'warning' },
  'model-migration': { message: 'The configured model has a migration notice.', level: 'warning' },
  'npm-deprecation': { message: 'The npm distribution is deprecated.', level: 'warning', sticky: true },
  'plugin-autoupdate': { message: 'Plugin update status changed.', level: 'info' },
  'plugin-installation': { message: 'Plugin installation status changed.', level: 'info' },
  'rate-limit': { message: 'The model provider reported a rate limit.', level: 'warning' },
  'settings-error': { message: 'One or more settings are invalid.', level: 'error', sticky: true },
  startup: { message: 'CCPT is ready.', level: 'success' },
  'teammate-shutdown': { message: 'A teammate Agent stopped.', level: 'info' },
};

export class NotificationRules {
  constructor(readonly center: NotificationCenter, readonly now: () => number = Date.now) {}

  update(state: NotificationState): NativeNotification | undefined {
    const id = `notice:${state.kind}:${state.key ?? 'default'}`;
    if (!state.active) { this.center.dismiss(id); return undefined; }
    const definition = defaults[state.kind];
    const createdAt = this.now();
    const notification: NativeNotification = {
      id,
      message: [state.message ?? definition.message, state.detail].filter(Boolean).join(' '),
      level: state.level ?? definition.level,
      createdAt,
      source: state.kind,
      ...(!definition.sticky && state.ttlMs !== 0 ? { expiresAt: createdAt + (state.ttlMs ?? 8_000) } : {}),
    };
    this.center.publish(notification);
    return notification;
  }

  batch(states: readonly NotificationState[]): NativeNotification[] { return states.map((state) => this.update(state)).filter((value): value is NativeNotification => Boolean(value)); }
}

export function notificationKinds(): NotificationKind[] { return Object.keys(defaults) as NotificationKind[]; }
