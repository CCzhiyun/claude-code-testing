import { marketplacePopularity, type MarketplacePluginView, type MarketplaceRecord } from '../marketplace.js';
import { terminalWidth } from '../ink.js';
import { truncateTerminal, tuiTheme, wrapTerminal } from '../tui/presentation.js';

export const MARKETPLACE_TABS = ['Discover', 'Installed', 'Marketplaces', 'Errors'] as const;
export type MarketplaceTab = typeof MARKETPLACE_TABS[number];
export interface MarketplaceErrorItem { source: string; message: string; at: string }

export interface MarketplaceDialogState {
  type: 'marketplace';
  tab: MarketplaceTab;
  query: string;
  selected: number;
  scroll: number;
  expanded: boolean;
  detailAction?: number;
  plugins: MarketplacePluginView[];
  marketplaces: MarketplaceRecord[];
  errors: MarketplaceErrorItem[];
  status?: string;
}

export type MarketplaceDialogItem =
  | { kind: 'plugin'; plugin: MarketplacePluginView }
  | { kind: 'marketplace'; marketplace: MarketplaceRecord }
  | { kind: 'error'; error: MarketplaceErrorItem };

export type MarketplaceDetailAction = 'install-project' | 'install-local' | 'update' | 'reload' | 'uninstall' | 'homepage' | 'back';

export function isMarketplaceRefreshKey(text: string, key: { ctrl?: boolean | undefined; name?: string | undefined }): boolean {
  return Boolean((key.ctrl && key.name?.toLowerCase() === 'r') || text === '\u0012');
}

export function marketplaceDetailActions(plugin: MarketplacePluginView): Array<{ id: MarketplaceDetailAction; label: string }> {
  if (plugin.installed) return [
    { id: 'update', label: 'Update from marketplace' },
    { id: 'reload', label: 'Reload plugins now' },
    { id: 'uninstall', label: 'Uninstall from this workspace' },
    ...(plugin.homepage ? [{ id: 'homepage' as const, label: 'Show homepage' }] : []),
    { id: 'back', label: 'Back to plugin list' },
  ];
  return [
    { id: 'install-project', label: 'Install for all collaborators in this repository (project scope)' },
    { id: 'install-local', label: 'Install for you, in this repository only (local scope)' },
    ...(plugin.homepage ? [{ id: 'homepage' as const, label: 'Show homepage' }] : []),
    { id: 'back', label: 'Back to plugin list' },
  ];
}

export function marketplaceDialogItems(state: MarketplaceDialogState): MarketplaceDialogItem[] {
  const query = state.query.trim().toLowerCase();
  const matches = (value: string): boolean => !query || value.toLowerCase().includes(query);
  if (state.tab === 'Discover') return state.plugins.filter((plugin) => !plugin.installed && matches(`${plugin.name} ${plugin.displayName ?? ''} ${plugin.description ?? ''} ${plugin.marketplace} ${plugin.category ?? ''}`)).sort((a, b) => marketplacePopularity(b) - marketplacePopularity(a) || a.name.localeCompare(b.name) || a.marketplace.localeCompare(b.marketplace)).map((plugin) => ({ kind: 'plugin', plugin }));
  if (state.tab === 'Installed') return state.plugins.filter((plugin) => plugin.installed && matches(`${plugin.name} ${plugin.description ?? ''} ${plugin.marketplace}`)).sort((a, b) => marketplacePopularity(b) - marketplacePopularity(a) || a.name.localeCompare(b.name) || a.marketplace.localeCompare(b.marketplace)).map((plugin) => ({ kind: 'plugin', plugin }));
  if (state.tab === 'Marketplaces') return state.marketplaces.filter((marketplace) => matches(`${marketplace.name} ${marketplace.source}`)).map((marketplace) => ({ kind: 'marketplace', marketplace }));
  return state.errors.filter((error) => matches(`${error.source} ${error.message}`)).map((error) => ({ kind: 'error', error }));
}

const pad = (value: string, width: number): string => `${value}${' '.repeat(Math.max(0, width - terminalWidth(value)))}`;

function compactInstallCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(value);
}

function pluginMetadata(plugin: MarketplacePluginView): string[] {
  const metadata = [plugin.marketplace];
  if (plugin.tags?.some((tag) => tag.toLowerCase() === 'community-managed')) metadata.push('[Community Managed]');
  const installs = plugin.installCount ?? plugin.installs;
  if (typeof installs === 'number' && Number.isFinite(installs)) metadata.push(`${compactInstallCount(Math.max(0, installs))} installs`);
  else if (typeof installs === 'string' && installs.trim()) metadata.push(/install/i.test(installs) ? installs.trim() : `${installs.trim()} installs`);
  if (plugin.installed) metadata.push('installed');
  return metadata;
}

export function renderMarketplaceDialog(state: MarketplaceDialogState, width: number, height: number): string[] {
  const margin = '  ';
  const inner = Math.max(48, width - 6);
  const tabs = [`${tuiTheme.bold}${tuiTheme.accent}Plugins${tuiTheme.reset}`, ...MARKETPLACE_TABS.map((tab) => tab === state.tab ? `${tuiTheme.selected} ${tab} ${tuiTheme.reset}` : `${tuiTheme.bold} ${tab} ${tuiTheme.reset}`)].join('   ');
  const items = marketplaceDialogItems(state);
  const detail = state.expanded ? items[state.selected] : undefined;
  if (detail?.kind === 'plugin') {
    const plugin = detail.plugin;
    const author = typeof plugin.author === 'string' ? plugin.author : plugin.author?.name;
    const declared = [
      ...(plugin.skills ? [`Skills: ${Array.isArray(plugin.skills) ? plugin.skills.join(', ') : plugin.skills}`] : []),
      ...(plugin.commands ? [`Commands: ${Array.isArray(plugin.commands) ? plugin.commands.join(', ') : plugin.commands}`] : []),
      ...(plugin.agents ? [`Agents: ${Array.isArray(plugin.agents) ? plugin.agents.join(', ') : plugin.agents}`] : []),
    ];
    if (!declared.length) declared.push(`Plugin components are discovered after installation and /reload-plugins.`);
    const actions = marketplaceDetailActions(plugin);
    const selectedAction = Math.max(0, Math.min(state.detailAction ?? 0, actions.length - 1));
    const lines = [
      `${tuiTheme.border}${'─'.repeat(width)}${tuiTheme.reset}`,
      `${margin}${tabs}`,
      '',
      `${tuiTheme.bold}Plugin details${tuiTheme.reset}`,
      '',
      `${tuiTheme.bold}${plugin.displayName ?? plugin.name}${tuiTheme.reset}`,
      `${tuiTheme.muted}from ${plugin.marketplace}${plugin.version ? ` · version ${plugin.version}` : ''}${tuiTheme.reset}`,
      '',
      ...wrapTerminal(plugin.description ?? 'No description provided.', inner).map((line) => `${tuiTheme.assistant}${line}${tuiTheme.reset}`),
      ...(plugin.installed ? wrapTerminal(`/plugin history ${plugin.name} · /plugin rollback ${plugin.name} <revision_ID> confirm${plugin.installedScope === 'local' ? ' local' : ''}`, inner) : []),
      '',
      ...(author ? [`${tuiTheme.muted}By: ${author}${tuiTheme.reset}`, ''] : []),
      `${tuiTheme.bold}${plugin.installed ? 'Installed components:' : 'Will install:'}${tuiTheme.reset}`,
      ...declared.map((line) => `  ${tuiTheme.muted}• ${line}${tuiTheme.reset}`),
      '',
      `${tuiTheme.warning}⚠ Install only plugins you trust. Plugins may include executable Hooks, MCP servers, files, and Agents.${tuiTheme.reset}`,
      '',
      ...actions.map((action, index) => index === selectedAction ? `${tuiTheme.user}› ${action.label}${tuiTheme.reset}` : `  ${tuiTheme.assistant}${action.label}${tuiTheme.reset}`),
      '',
      ...(state.status ? [`${tuiTheme.accent}${truncateTerminal(state.status, inner)}${tuiTheme.reset}`, ''] : []),
      `${tuiTheme.muted}↑/↓ choose · Enter select · Ctrl+R refresh · Esc back${tuiTheme.reset}`,
    ];
    return lines.slice(0, height);
  }
  const visibleLimit = Math.min(5, Math.max(1, Math.floor((height - 11) / 3)));
  const maximumScroll = Math.max(0, items.length - visibleLimit);
  state.scroll = Math.max(0, Math.min(state.scroll, maximumScroll));
  if (state.selected < state.scroll) state.scroll = state.selected;
  if (state.selected >= state.scroll + visibleLimit) state.scroll = state.selected - visibleLimit + 1;
  const visible = items.slice(state.scroll, state.scroll + visibleLimit);
  const totalForTab = state.tab === 'Discover' ? state.plugins.filter((plugin) => !plugin.installed).length : items.length;
  const ordinal = items.length ? Math.min(items.length, state.selected + 1) : 0;
  const label = state.tab === 'Discover' ? `Discover plugins (${ordinal}/${totalForTab})` : `${state.tab} (${ordinal}/${items.length})`;
  const query = state.query || 'Search…';
  const lines = [
    `${tuiTheme.border}${'─'.repeat(width)}${tuiTheme.reset}`,
    `${margin}${tabs}`,
    '',
    `${margin}${tuiTheme.bold}${label}${tuiTheme.reset}`,
    `${margin}${tuiTheme.border}╭${'─'.repeat(inner)}╮${tuiTheme.reset}`,
    `${margin}${tuiTheme.border}│${tuiTheme.reset} ${state.query ? tuiTheme.user : tuiTheme.muted}⌕ ${pad(truncateTerminal(query, inner - 4), inner - 4)}${tuiTheme.reset} ${tuiTheme.border}│${tuiTheme.reset}`,
    `${margin}${tuiTheme.border}╰${'─'.repeat(inner)}╯${tuiTheme.reset}`,
    '',
  ];
  if (!visible.length) lines.push(`${margin}${tuiTheme.muted}No ${state.tab.toLowerCase()} items${state.query ? ` matching “${state.query}”` : ''}.${tuiTheme.reset}`);
  for (const [offset, item] of visible.entries()) {
    const selected = state.scroll + offset === state.selected;
    const marker = selected ? `${tuiTheme.user}›${tuiTheme.reset} ○` : '  ○';
    let first: string;
    let second = '';
    if (item.kind === 'plugin') {
      const plugin = item.plugin;
      first = `${marker} ${tuiTheme.assistant}${tuiTheme.bold}${plugin.displayName ?? plugin.name}${tuiTheme.reset} ${tuiTheme.muted}· ${pluginMetadata(plugin).join(' · ')}${tuiTheme.reset}`;
      second = plugin.description ?? `${plugin.category ?? 'Plugin'} from ${plugin.marketplace}`;
    } else if (item.kind === 'marketplace') {
      first = `${marker} ${tuiTheme.assistant}${tuiTheme.bold}${item.marketplace.name}${tuiTheme.reset} ${tuiTheme.muted}· ${item.marketplace.kind} · auto-update ${item.marketplace.autoUpdate ? 'on' : 'off'}${item.marketplace.catalogOrigin === 'bundled' ? ' · bundled snapshot' : ''}${item.marketplace.error ? ' · sync error' : ''}${tuiTheme.reset}`;
      second = item.marketplace.error ? `${item.marketplace.error} · cached catalog remains available` : item.marketplace.source;
    } else {
      first = `${marker} ${tuiTheme.assistant}${tuiTheme.bold}${item.error.source}${tuiTheme.reset} ${tuiTheme.muted}· ${item.error.at}${tuiTheme.reset}`;
      second = item.error.message;
    }
    lines.push(`${margin}${truncateTerminal(first, inner)}`);
    lines.push(`${margin}    ${tuiTheme.muted}${truncateTerminal(second, inner - 4)}${tuiTheme.reset}`);
    lines.push('');
  }
  const above = state.scroll;
  const below = Math.max(0, items.length - state.scroll - visible.length);
  if (above || below) lines.push(`${margin}${tuiTheme.muted}${above ? `↑ ${above} more above` : ''}${above && below ? ' · ' : ''}${below ? `↓ ${below} more below` : ''}${tuiTheme.reset}`);
  if (state.status) lines.push(`${margin}${tuiTheme.accent}${truncateTerminal(state.status, inner)}${tuiTheme.reset}`);
  const action = state.tab === 'Marketplaces' ? 'Space to toggle auto-update' : 'Enter/Space to view';
  lines.push('', `${margin}${tuiTheme.dim}${tuiTheme.muted}Type to search · ↑/↓ to move · ←/→/Tab to switch · ${action} · Ctrl+R to refresh · Esc to go back${tuiTheme.reset}`);
  return lines.slice(0, height);
}
