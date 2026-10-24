import { test, expect } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, mergeConfig, validateConfig } from '../src/config.js';
import { signPlugin } from '../src/pluginSignatures.js';
import { discoverPlugins } from '../src/plugins.js';

test('publisher signature gate rejects unsigned, untrusted, revoked and forged plugins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-signature-')); const directory = join(root, 'plugins'), plugin = join(directory, 'team');
  await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ name: 'team', version: '1.0.0', contributes: {} }));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'); const keyFile = join(root, 'publisher.pem');
  await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const config = structuredClone(defaultConfig); config.pluginDirectories = [directory]; config.requirePluginSignatures = true;
  try {
    expect((await discoverPlugins(config)).plugins).toHaveLength(0);
    await signPlugin(plugin, keyFile, 'team-key');
    expect((await discoverPlugins(config)).diagnostics[0]?.message).toContain('not trusted');
    config.pluginTrustKeys = { 'team-key': String(publicKey.export({ type: 'spki', format: 'pem' })) };
    validateConfig(config); expect((await discoverPlugins(config)).plugins).toHaveLength(1);
    config.revokedPluginKeys = ['team-key']; expect((await discoverPlugins(config)).diagnostics[0]?.message).toContain('revoked');
    config.revokedPluginKeys = [];
    const manifest = JSON.parse(await readFile(join(plugin, 'plugin.json'), 'utf8'));
    manifest.integrity.signature.value = Buffer.alloc(64).toString('base64'); await writeFile(join(plugin, 'plugin.json'), JSON.stringify(manifest));
    expect((await discoverPlugins(config)).diagnostics[0]?.message).toContain('signature verification failed');
    delete manifest.integrity.signature; await writeFile(join(plugin, 'plugin.json'), JSON.stringify(manifest));
    expect((await discoverPlugins(config)).diagnostics[0]?.message).toContain('requires a trusted');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('managed trust keys replace untrusted keys and only public Ed25519 PEM is accepted', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'); const pem = String(publicKey.export({ type: 'spki', format: 'pem' }));
  const base = structuredClone(defaultConfig); base.pluginTrustKeys = { untrusted: pem };
  const merged = mergeConfig(base, { pluginTrustKeys: { administrator: pem } });
  expect(Object.keys(merged.pluginTrustKeys!)).toEqual(['administrator']); validateConfig(merged);
  merged.pluginTrustKeys = { bad: String(privateKey.export({ type: 'pkcs8', format: 'pem' })) };
  expect(() => validateConfig(merged)).toThrow('public PEM');
});

test('publisher tooling refuses signing keys packaged inside the plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-key-boundary-'));
  await writeFile(join(root, 'plugin.json'), JSON.stringify({ name: 'team', version: '1.0.0' }));
  const key = generateKeyPairSync('ed25519').privateKey; await writeFile(join(root, 'key.pem'), key.export({ type: 'pkcs8', format: 'pem' }));
  try { await expect(signPlugin(root, join(root, 'key.pem'), 'team')).rejects.toThrow('outside the plugin'); }
  finally { await rm(root, { recursive: true, force: true }); }
});
