import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { writeJson, readJson } from '../src/storage.js';
import { signPlugin, verifyPluginSignature } from '../src/pluginSignatures.js';
import { computePluginDigest, loadPluginAt } from '../src/plugins.js';
import { addMarketplace, installMarketplacePlugin, updateMarketplacePlugin, uninstallMarketplacePlugin, refreshMarketplace, removeMarketplace, inspectMarketplaceInstallations, repairMarketplaceReceipt } from '../src/marketplace.js';
import { listPluginHistory, rollbackPlugin } from '../src/pluginHistory.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-signed-catalog-')), cwd = join(root, 'workspace'), catalog = join(root, 'catalog'), plugin = join(catalog, 'team');
  const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'home');
  await mkdir(cwd); await mkdir(plugin, { recursive: true });
  const keys = generateKeyPairSync('ed25519'), key = join(root, 'private.pem'); await writeFile(key, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = true; config.policy.workspaceRoots = [root]; config.requirePluginSignatures = true; config.hooks = []; config.pluginTrustKeys = { publisher: String(keys.publicKey.export({ type: 'spki', format: 'pem' })) };
  await writeJson(join(cwd, '.ccpt/settings.json'), config);
  const publish = async (version: string, overlay: Record<string, unknown> = {}) => {
    await writeJson(join(plugin, 'plugin.json'), { name: 'team', version, contributes: {} });
    await writeFile(join(plugin, 'guide.md'), `Signed content ${version}`); await signPlugin(plugin, key, 'publisher');
    await writeJson(join(catalog, '.claude-plugin/marketplace.json'), { name: 'team-catalog', owner: { name: 'Fixture' }, plugins: [{ name: 'team', source: './team', version, ...overlay }] });
  };
  await publish('1.0.0'); await addMarketplace(cwd, catalog);
  return { root, cwd, plugin, config, publish, async close() { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await removeOwnedTemporaryFixture(root); } };
}

test('signed Marketplace install/update/rollback preserve signatures and do not add covered metadata', async () => {
  const f = await fixture();
  try {
    const digest = await computePluginDigest(f.plugin), original = await readFile(join(f.plugin, 'plugin.json'), 'utf8');
    const installed = await installMarketplacePlugin(f.cwd, 'team@team-catalog');
    expect(await computePluginDigest(installed)).toBe(digest); expect(await readFile(join(installed, 'plugin.json'), 'utf8')).toBe(original);
    await expect(readFile(join(installed, '.ccpt-marketplace.json'))).rejects.toThrow();
    expect((await readJson<any>(join(f.cwd, '.ccpt/plugin-installations/project/team.json'), {})).marketplace).toBe('team-catalog');
    await verifyPluginSignature(await loadPluginAt(installed), f.config);
    await f.publish('2.0.0'); const updated = await updateMarketplacePlugin(f.cwd, 'team@team-catalog'); expect(updated.version).toBe('2.0.0');
    await verifyPluginSignature(await loadPluginAt(installed), f.config);
    const history = await listPluginHistory(f.cwd, 'team'); await rollbackPlugin(f.cwd, 'team', history[0]!.id);
    expect((await loadPluginAt(installed)).version).toBe('1.0.0'); await verifyPluginSignature(await loadPluginAt(installed), f.config);
    await uninstallMarketplacePlugin(f.cwd, 'team'); await expect(readFile(join(f.cwd, '.ccpt/plugin-installations/project/team.json'))).rejects.toThrow();
  } finally { await f.close(); }
});

test('catalog overlays, version lies, revoked and tampered signed sources cannot replace the active plugin', async () => {
  const f = await fixture();
  try {
    const installed = await installMarketplacePlugin(f.cwd, 'team@team-catalog');
    await f.publish('2.0.0', { hooks: [] }); await expect(updateMarketplacePlugin(f.cwd, 'team@team-catalog')).rejects.toThrow('overlays');
    await f.publish('2.0.0', { version: '3.0.0' }); await expect(updateMarketplacePlugin(f.cwd, 'team@team-catalog')).rejects.toThrow('identity/version');
    await f.publish('2.0.0'); await writeFile(join(f.plugin, 'guide.md'), 'tampered'); await expect(updateMarketplacePlugin(f.cwd, 'team@team-catalog')).rejects.toThrow('integrity');
    await f.publish('2.0.0'); f.config.revokedPluginKeys = ['publisher']; await writeJson(join(f.cwd, '.ccpt/settings.json'), f.config);
    await expect(updateMarketplacePlugin(f.cwd, 'team@team-catalog')).rejects.toThrow('revoked');
    expect((await loadPluginAt(installed)).version).toBe('1.0.0');
  } finally { await f.close(); }
});

test('forged remote Marketplace state cannot delete or refresh paths outside its managed cache', async () => {
  const f = await fixture();
  try {
    const outside = join(f.root, 'do-not-remove'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'must survive');
    const state = join(f.cwd, '.ccpt/marketplaces.json');
    const saved: any = await readJson(state, {}); const original = saved.marketplaces[0];
    Object.assign(original, { kind: 'url', root: outside, catalogPath: join(outside, 'keep.txt'), catalogUrl: 'https://must-not-contact.invalid/marketplace.json' });
    await writeJson(state, saved);
    await expect(removeMarketplace(f.cwd, 'team-catalog')).rejects.toThrow('escapes');
    const refreshed = await refreshMarketplace(f.cwd, 'team-catalog'); expect(refreshed[0]?.error).toContain('escapes');
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('must survive');
    expect((await readJson<any>(state, {})).marketplaces).toHaveLength(1);
  } finally { await f.close(); }
});

test('missing or malformed installation receipts are only repaired after confirmation and exact cached-artifact verification', async () => {
  const f = await fixture();
  try {
    await installMarketplacePlugin(f.cwd, 'team@team-catalog');
    const receipt = join(f.cwd, '.ccpt/plugin-installations/project/team.json');
    expect((await inspectMarketplaceInstallations(f.cwd))[0]?.state).toBe('verified-receipt');
    await unlink(receipt); expect((await inspectMarketplaceInstallations(f.cwd))[0]?.state).toBe('untracked');
    await expect(repairMarketplaceReceipt(f.cwd, 'team@team-catalog', false)).rejects.toThrow('confirm');
    await expect(readFile(receipt)).rejects.toThrow();
    await writeJson(receipt, { corrupt: true }); expect((await inspectMarketplaceInstallations(f.cwd))[0]?.state).toBe('invalid-receipt');
    const repaired = await repairMarketplaceReceipt(f.cwd, 'team@team-catalog', true); expect(repaired.state).toBe('verified-receipt'); expect(repaired.signatureVerified).toBe(true);
    const before = await readFile(receipt, 'utf8'); await inspectMarketplaceInstallations(f.cwd); expect(await readFile(receipt, 'utf8')).toBe(before);
  } finally { await f.close(); }
});

test('receipt repair never guesses provenance for a different cached version or revoked publisher', async () => {
  const f = await fixture();
  try {
    await installMarketplacePlugin(f.cwd, 'team@team-catalog'); const receipt = join(f.cwd, '.ccpt/plugin-installations/project/team.json'); await unlink(receipt);
    await f.publish('2.0.0'); await expect(repairMarketplaceReceipt(f.cwd, 'team@team-catalog', true)).rejects.toThrow('exactly match');
    await expect(readFile(receipt)).rejects.toThrow();
    await f.publish('1.0.0'); f.config.revokedPluginKeys = ['publisher']; await writeJson(join(f.cwd, '.ccpt/settings.json'), f.config);
    expect((await inspectMarketplaceInstallations(f.cwd))[0]?.state).toBe('untrusted');
    await expect(repairMarketplaceReceipt(f.cwd, 'team@team-catalog', true)).rejects.toThrow('revoked');
    await expect(readFile(receipt)).rejects.toThrow();
  } finally { await f.close(); }
});

test('same content signed by another trusted publisher cannot be relabeled as the installed original', async () => {
  const f = await fixture();
  try {
    await installMarketplacePlugin(f.cwd, 'team@team-catalog'); const receipt = join(f.cwd, '.ccpt/plugin-installations/project/team.json'); await unlink(receipt);
    const keys = generateKeyPairSync('ed25519'), privatePath = join(f.root, 'other.pem'); await writeFile(privatePath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    f.config.pluginTrustKeys!.other = String(keys.publicKey.export({ type: 'spki', format: 'pem' })); await writeJson(join(f.cwd, '.ccpt/settings.json'), f.config);
    await signPlugin(f.plugin, privatePath, 'other');
    await expect(repairMarketplaceReceipt(f.cwd, 'team@team-catalog', true)).rejects.toThrow('signature envelope');
    await expect(readFile(receipt)).rejects.toThrow();
  } finally { await f.close(); }
});

test('Marketplace removal surfaces receipt failures and retains its record until cleanup succeeds', async () => {
  const f = await fixture();
  try {
    const installed = await installMarketplacePlugin(f.cwd, 'team@team-catalog'), receipt = join(f.cwd, '.ccpt/plugin-installations/project/team.json');
    await writeJson(receipt, 0); await expect(removeMarketplace(f.cwd, 'team-catalog')).rejects.toThrow('Invalid');
    expect((await readJson<any>(join(f.cwd, '.ccpt/marketplaces.json'), {})).marketplaces).toHaveLength(1); expect((await loadPluginAt(installed)).version).toBe('1.0.0');
    await repairMarketplaceReceipt(f.cwd, 'team@team-catalog', true); await removeMarketplace(f.cwd, 'team-catalog');
    expect((await readJson<any>(join(f.cwd, '.ccpt/marketplaces.json'), {})).marketplaces).toHaveLength(0);
    expect((await listPluginHistory(f.cwd, 'team')).length).toBe(1); expect((await loadPluginAt(f.plugin)).version).toBe('1.0.0');
  } finally { await f.close(); }
});
