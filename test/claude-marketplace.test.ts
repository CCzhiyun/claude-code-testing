import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addMarketplace, autoUpdateMarketplaces, installMarketplacePlugin, listMarketplacePlugins, listMarketplaces, OFFICIAL_MARKETPLACE_SOURCE, refreshMarketplace, setMarketplaceAutoUpdate, uninstallMarketplacePlugin } from '../src/marketplace.js';
import { loadPlatform } from '../src/platform.js';
import { isMarketplaceRefreshKey, marketplaceDialogItems, renderMarketplaceDialog, type MarketplaceDialogState } from '../src/components/marketplaceDialog.js';
import { NATIVE_COMMANDS } from '../src/commands/catalog.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function text(path: string, value: string): Promise<void> { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, value, 'utf8'); }

describe('Claude Code marketplace compatibility', () => {
  test('adds a Claude marketplace, installs its plugin and exposes namespaced slash workflows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-claude-market-')); roots.push(root);
    const workspace = join(root, 'workspace');
    const marketplace = join(root, 'catalog');
    const plugin = join(marketplace, 'plugins', 'super-tools');
    await mkdir(workspace, { recursive: true });
    await text(join(marketplace, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({
      name: 'team-market', owner: { name: 'Team' }, plugins: [{ name: 'super-tools', source: './plugins/super-tools', description: 'Claude-compatible engineering workflows' }],
    }, null, 2)}\n`);
    await text(join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'super-tools', version: '1.2.3', description: 'Tools' }, null, 2)}\n`);
    await text(join(plugin, 'skills', 'brainstorming', 'SKILL.md'), '---\ndescription: Explore a feature before implementation\n---\n\nExplore requirements and tradeoffs.');
    await text(join(plugin, 'commands', 'write-plan.md'), '---\ndescription: Write an implementation plan\n---\n\nCreate a plan for $ARGUMENTS.');
    await text(join(plugin, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Review completed work\n---\n\nReview the implementation independently.');
    await text(join(plugin, '.mcp.json'), `${JSON.stringify({ mcpServers: { helper: { command: 'node', args: ['\${CLAUDE_PLUGIN_ROOT}/server.js'] } } }, null, 2)}\n`);
    await text(join(plugin, '.lsp.json'), `${JSON.stringify({ typescript: { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } } }, null, 2)}\n`);
    await text(join(plugin, 'hooks', 'hooks.json'), `${JSON.stringify({ hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node \${CLAUDE_PLUGIN_ROOT}/hook.js' }] }] } }, null, 2)}\n`);

    const registered = await addMarketplace(workspace, marketplace);
    expect(registered.name).toBe('team-market');
    expect(registered.autoUpdate).toBe(false);
    expect((await listMarketplaces(workspace)).map((item) => item.name)).toEqual(['team-market']);
    expect((await listMarketplacePlugins(workspace))[0]?.installed).toBe(false);

    const installed = await installMarketplacePlugin(workspace, 'super-tools@team-market');
    expect(installed).toBe(join(workspace, '.ccpt', 'plugins', 'super-tools'));
    const platform = await loadPlatform(workspace);
    expect(platform.plugins[0]?.format).toBe('claude-code');
    expect(platform.skills.map((item) => item.name)).toContain('super-tools:brainstorming');
    expect(platform.commands.map((item) => item.name)).toContain('/super-tools:write-plan');
    expect(platform.agents.map((item) => item.name)).toContain('super-tools:reviewer');
    expect(platform.config.mcpServers['super-tools.helper']?.command).toBe('node');
    expect(platform.config.lspServers['super-tools.typescript']?.languageId).toBe('typescript');
    expect(platform.config.hooks.some((hook) => hook.event === 'SessionStart' && 'command' in hook && hook.command.includes(installed))).toBe(true);
    expect((await listMarketplacePlugins(workspace))[0]?.installed).toBe(true);

    await uninstallMarketplacePlugin(workspace, 'super-tools');
    expect((await listMarketplacePlugins(workspace))[0]?.installed).toBe(false);
  });

  test('renders Claude-style Discover, Installed, Marketplaces and Errors tabs', () => {
    const plugins = [
      { name: 'super-tools', description: 'Useful tools', installCount: 464_900, tags: ['community-managed'] },
      ...Array.from({ length: 6 }, (_, index) => ({ name: `plugin-${index + 2}`, description: `Plugin ${index + 2} description` })),
    ].map((plugin) => ({ ...plugin, source: './plugin', marketplace: 'team-market', marketplaceRoot: 'C:\\market', installed: false, enabled: false }));
    const state: MarketplaceDialogState = {
      type: 'marketplace', tab: 'Discover', query: '', selected: 0, scroll: 0, expanded: false,
      plugins,
      marketplaces: [], errors: [],
    };
    expect(marketplaceDialogItems(state)).toHaveLength(7);
    const output = renderMarketplaceDialog(state, 120, 30).join('\n');
    expect(output).toContain('Plugins');
    expect(output).toContain('Discover');
    expect(output).toContain('Installed');
    expect(output).toContain('Marketplaces');
    expect(output).toContain('Errors');
    expect(output).toContain('super-tools');
    expect(output).toContain('Discover plugins (1/7)');
    expect(output).toContain('›');
    expect(output).toContain('○');
    expect(output).toContain('[Community Managed]');
    expect(output).toContain('464.9K installs');
    expect(output).toContain('↓ 2 more below');
    expect(output).toContain('Enter/Space to view');
    expect(output).toContain('Ctrl+R to refresh');
    expect(output).not.toContain('r refresh');
    expect(isMarketplaceRefreshKey('r', { name: 'r' })).toBe(false);
    expect(isMarketplaceRefreshKey('\u0012', { name: 'r', ctrl: true })).toBe(true);

    const popularityState: MarketplaceDialogState = {
      ...state,
      plugins: [
        { name: 'small', installs: '12 installs' },
        { name: 'most-popular', installs: '1.2M installs' },
        { name: 'middle', installCount: 464_900 },
        { name: 'unknown' },
      ].map((plugin) => ({ ...plugin, source: './plugin', marketplace: 'team-market', marketplaceRoot: 'C:\\market', installed: false, enabled: false })),
    };
    expect(marketplaceDialogItems(popularityState).map((item) => item.kind === 'plugin' ? item.plugin.name : '')).toEqual(['most-popular', 'middle', 'small', 'unknown']);
  });

  test('seeds the official marketplace immediately without depending on GitHub availability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-official-seed-')); roots.push(root);
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const record = await addMarketplace(workspace, OFFICIAL_MARKETPLACE_SOURCE);
    expect(record.name).toBe('claude-plugins-official');
    expect(record.autoUpdate).toBe(true);
    expect(record.catalogOrigin).toBe('bundled');
    const discover = await listMarketplacePlugins(workspace);
    expect(discover.length).toBeGreaterThan(100);
    expect(discover.slice(0, 6).map((plugin) => plugin.name)).toEqual(['frontend-design', 'code-review', 'context7', 'skill-creator', 'code-simplifier', 'playwright']);
    await installMarketplacePlugin(workspace, 'frontend-design@claude-plugins-official');
    await installMarketplacePlugin(workspace, 'superpowers@claude-plugins-official');
    const platform = await loadPlatform(workspace);
    expect(platform.plugins.map((plugin) => plugin.name)).toEqual(expect.arrayContaining(['frontend-design', 'superpowers']));
    expect(platform.skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(['frontend-design', 'brainstorming']));
    expect(platform.skills.some((skill) => skill.name.startsWith('frontend-design:'))).toBe(true);
      expect(platform.skills.some((skill) => skill.name.startsWith('superpowers:'))).toBe(true);
      expect(platform.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    }, 20_000);

  test('renders a trust-aware plugin detail page with repository-scoped install actions', () => {
    const state: MarketplaceDialogState = {
      type: 'marketplace', tab: 'Discover', query: '', selected: 0, scroll: 0, expanded: true, detailAction: 0,
      plugins: [{ name: 'frontend-design', source: './plugins/frontend-design', marketplace: 'claude-plugins-official', marketplaceRoot: 'C:\\market', installed: false, enabled: false, description: 'Create distinctive interfaces', author: { name: 'Anthropic' }, homepage: 'https://example.com' }],
      marketplaces: [], errors: [],
    };
    const output = renderMarketplaceDialog(state, 140, 40).join('\n');
    expect(output).toContain('Plugin details');
    expect(output).toContain('Install for all collaborators');
    expect(output).toContain('Install for you, in this repository only');
    expect(output).toContain('/reload-plugins');
  });

  test('uses one plugin slash entry and keeps catalog refresh separate from installed plugin updates', async () => {
    expect(NATIVE_COMMANDS.filter((item) => ['/plugin', '/plugins', '/marketplace'].includes(item.name)).map((item) => item.name)).toEqual(['/plugin']);
    const root = await mkdtemp(join(tmpdir(), 'ccpt-market-update-')); roots.push(root);
    const workspace = join(root, 'workspace');
    const marketplace = join(root, 'catalog');
    const plugin = join(marketplace, 'plugin');
    await mkdir(workspace, { recursive: true });
    const writeVersion = async (version: string): Promise<void> => {
      await text(join(marketplace, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({ name: 'updates', owner: { name: 'Team' }, plugins: [{ name: 'updatable', version, source: './plugin' }] }, null, 2)}\n`);
      await text(join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'updatable', version }, null, 2)}\n`);
      await text(join(plugin, 'skills', 'hello', 'SKILL.md'), `---\ndescription: Version ${version}\n---\n\nVersion ${version}.`);
    };
    await writeVersion('1.0.0');
    await addMarketplace(workspace, marketplace);
    await installMarketplacePlugin(workspace, 'updatable@updates');
    expect((await loadPlatform(workspace)).plugins[0]?.version).toBe('1.0.0');

    await writeVersion('2.0.0');
    await refreshMarketplace(workspace, 'updates');
    expect((await loadPlatform(workspace)).plugins[0]?.version).toBe('1.0.0');

    await setMarketplaceAutoUpdate(workspace, 'updates', true);
    const result = await autoUpdateMarketplaces(workspace);
    expect(result.refreshed).toEqual(['updates']);
    expect(result.updated[0]?.version).toBe('2.0.0');
    expect((await loadPlatform(workspace)).plugins[0]?.version).toBe('2.0.0');
  });
});
