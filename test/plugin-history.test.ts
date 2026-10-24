import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installTrustedPlugin, listPluginHistory, snapshotPlugin, rollbackPlugin, replaceInstalledPlugin } from '../src/pluginHistory.js';
import { loadPluginAt, computePluginDigest } from '../src/plugins.js';
import { signPlugin } from '../src/pluginSignatures.js';
import { writeJson } from '../src/storage.js';
import { addMarketplace, installMarketplacePlugin, updateMarketplacePlugin, uninstallMarketplacePlugin } from '../src/marketplace.js';
import { installPluginOp, updatePluginOp, disablePluginOp, enablePluginOp } from '../src/services/plugins/pluginOperations.js';
import { loadPlatform } from '../src/platform.js';

async function fixture(action: (root: string, workspace: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-history-')), old = process.env.CCPT_HOME, workspace = join(root, 'workspace');
  process.env.CCPT_HOME = join(root, 'home'); await mkdir(workspace);
  try { await action(root, workspace); } finally { if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old; await rm(root, { recursive: true, force: true }); }
}
async function source(root: string, version: string, name = 'team') {
  const path = join(root, `source-${version}`); await mkdir(path, { recursive: true });
  await writeJson(join(path, 'plugin.json'), { name, version, contributes: {} }); await writeFile(join(path, 'knowledge.md'), `Knowledge ${version}`); return path;
}

test('plugin replacement archives old bytes; rollback archives current version and restores exact content', async () => fixture(async (root, cwd) => {
  const v1 = await source(root, '1.0.0'), v2 = await source(root, '2.0.0');
  const installed = await installTrustedPlugin(cwd, v1);
  const before = await computePluginDigest(installed), updated = await replaceInstalledPlugin(cwd, 'team', 'project', v2);
  expect(updated.previous.version).toBe('1.0.0'); expect((await loadPluginAt(installed)).version).toBe('2.0.0');
  await rollbackPlugin(cwd, 'team', updated.previous.id);
  expect(await computePluginDigest(installed)).toBe(before); expect(await readFile(join(installed, 'knowledge.md'), 'utf8')).toBe('Knowledge 1.0.0');
  const history = await listPluginHistory(cwd, 'team'); expect(history.map(item => item.version).sort()).toEqual(['1.0.0', '2.0.0']);
  await rollbackPlugin(cwd, 'team', history.find(item => item.version === '2.0.0')!.id);
  expect((await loadPluginAt(installed)).version).toBe('2.0.0');
}));

test('history tamper, path traversal, scope mismatch and restricted policy fail without changing active plugin', async () => fixture(async (root, cwd) => {
  const installed = await installTrustedPlugin(cwd, await source(root, '1.0.0')), revision = await snapshotPlugin(cwd, 'team');
  for (const name of ['../team', '..', 'CON', 'team/../../other']) await expect(snapshotPlugin(cwd, name)).rejects.toThrow('Invalid');
  await expect(rollbackPlugin(cwd, 'team', '../content')).rejects.toThrow('Invalid');
  await expect(rollbackPlugin(cwd, 'team', revision.id, 'local')).rejects.toThrow('not found');
  const content = join(cwd, '.ccpt', 'plugin-history', 'project', 'team', revision.id, 'content', 'knowledge.md');
  await writeFile(content, 'modified'); await expect(rollbackPlugin(cwd, 'team', revision.id)).rejects.toThrow('digest');
  expect(await readFile(join(installed, 'knowledge.md'), 'utf8')).toBe('Knowledge 1.0.0');
  await writeJson(join(cwd, '.ccpt', 'settings.json'), { policy: { mode: 'restricted' } });
  await expect(snapshotPlugin(cwd, 'team')).rejects.toThrow('restricted');
}));

test('rollback rechecks current version lock and publisher revocation, never restores authority from history', async () => fixture(async (root, cwd) => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'), key = join(root, 'publisher.pem');
  await writeFile(key, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const v1 = await source(root, '1.0.0'), v2 = await source(root, '2.0.0');
  await signPlugin(v1, key, 'publisher'); await signPlugin(v2, key, 'publisher');
  const settingsPath = join(cwd, '.ccpt', 'settings.json');
  const trust = { requirePluginSignatures: true, pluginTrustKeys: { publisher: String(publicKey.export({ type: 'spki', format: 'pem' })) } };
  await writeJson(settingsPath, trust);
  const installed = await installTrustedPlugin(cwd, v1), updated = await replaceInstalledPlugin(cwd, 'team', 'project', v2);
  await writeJson(settingsPath, { ...trust, revokedPluginKeys: ['publisher'] });
  await expect(rollbackPlugin(cwd, 'team', updated.previous.id)).rejects.toThrow('revoked');
  await writeJson(settingsPath, { ...trust, requirePluginLocks: true, pluginLocks: { team: { version: '2.0.0', digest: await computePluginDigest(installed) } } });
  await expect(rollbackPlugin(cwd, 'team', updated.previous.id)).rejects.toThrow('version mismatch');
  expect((await loadPluginAt(installed)).version).toBe('2.0.0');
  await writeJson(settingsPath, trust); await rollbackPlugin(cwd, 'team', updated.previous.id);
  expect((await loadPluginAt(installed)).version).toBe('1.0.0');
}));

test('concurrent plugin replacements serialize and retain both previous versions', async () => fixture(async (root, cwd) => {
  await installTrustedPlugin(cwd, await source(root, '1.0.0'));
  const v2 = await source(root, '2.0.0'), v3 = await source(root, '3.0.0');
  const results = await Promise.all([replaceInstalledPlugin(cwd, 'team', 'project', v2), replaceInstalledPlugin(cwd, 'team', 'project', v3)]);
  const history = await listPluginHistory(cwd, 'team'); expect(history.length).toBe(2);
  const current = (await loadPluginAt(join(cwd, '.ccpt', 'plugins', 'team'))).version;
  expect(new Set([...history.map(record => record.version), current]).size).toBe(3);
  expect(results.every(item => item.previous.id.startsWith('revision_'))).toBe(true);
}));

test('state junctions are rejected before mutation and do not affect the external target', async () => fixture(async (root, cwd) => {
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'keep');
  await symlink(outside, join(cwd, '.ccpt'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(installTrustedPlugin(cwd, await source(root, '1.0.0'))).rejects.toThrow();
  expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  if (process.platform === 'win32') await rmdir(join(cwd, '.ccpt')); else await unlink(join(cwd, '.ccpt')); // Exact junction/link only; never recurse.
}));

test('marketplace update and uninstall preserve history; rejected trust never activates an unsigned plugin', async () => fixture(async (root, cwd) => {
  const catalog = join(root, 'catalog'), plugin = join(catalog, 'team'); await mkdir(plugin, { recursive: true });
  const manifest = join(catalog, '.claude-plugin', 'marketplace.json');
  await writeJson(join(plugin, '.claude-plugin', 'plugin.json'), { name: 'team', version: '1.0.0' });
  await writeJson(manifest, { name: 'catalog', owner: { name: 'Team' }, plugins: [{ name: 'team', source: './team', version: '1.0.0' }] });
  await addMarketplace(cwd, catalog); const installed = await installMarketplacePlugin(cwd, 'team@catalog');
  await writeJson(join(plugin, '.claude-plugin', 'plugin.json'), { name: 'team', version: '2.0.0' });
  await writeJson(manifest, { name: 'catalog', owner: { name: 'Team' }, plugins: [{ name: 'team', source: './team', version: '2.0.0' }] });
  expect((await updateMarketplacePlugin(cwd, 'team@catalog')).previousVersion).toBe('1.0.0');
  const history = await listPluginHistory(cwd, 'team'); expect(history.length).toBe(1); await rollbackPlugin(cwd, 'team', history[0]!.id);
  expect((await loadPluginAt(installed)).version).toBe('1.0.0');
  await writeJson(join(cwd, '.ccpt', 'settings.json'), { requirePluginSignatures: true });
  await expect(updateMarketplacePlugin(cwd, 'team@catalog')).rejects.toThrow('signature'); expect((await loadPluginAt(installed)).version).toBe('1.0.0');
  await uninstallMarketplacePlugin(cwd, 'team'); expect((await listPluginHistory(cwd, 'team')).length).toBe(3);
}));

test('SDK compatibility operations share real activation settings, history and trust gates', async () => fixture(async (root, cwd) => {
  const v1 = await source(root, '1.0.0'), v2 = await source(root, '2.0.0');
  await installPluginOp(v1, 'project', cwd); expect((await loadPlatform(cwd)).plugins.map(plugin => plugin.name)).toContain('team');
  await disablePluginOp('team', 'project', cwd); expect((await loadPlatform(cwd)).plugins.map(plugin => plugin.name)).not.toContain('team');
  await enablePluginOp('team', 'project', cwd); expect((await loadPlatform(cwd)).plugins.map(plugin => plugin.name)).toContain('team');
  await updatePluginOp('team', v2, 'project', cwd); expect((await listPluginHistory(cwd, 'team')).length).toBe(1);
  await writeJson(join(cwd, '.ccpt', 'settings.json'), { requirePluginSignatures: true });
  await expect(updatePluginOp('team', v1, 'project', cwd)).rejects.toThrow('signature');
  expect((await loadPluginAt(join(cwd, '.ccpt', 'plugins', 'team'))).version).toBe('2.0.0');
}));
