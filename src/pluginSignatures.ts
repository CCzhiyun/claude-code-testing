import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { PlatformConfig } from './types.js';
import { computePluginDigest, loadPluginAt, type LoadedPlugin, type PluginManifest } from './plugins.js';
import { writeJson } from './storage.js';

export interface PluginSignature { algorithm: 'ed25519'; keyId: string; value: string }
const keyName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name);
function payload(plugin: Pick<LoadedPlugin, 'name' | 'version'>, digest: string, keyId: string): Buffer {
  return Buffer.from(JSON.stringify(['CCPT/plugin-signature/v1', plugin.name, plugin.version, digest.toLowerCase(), keyId]));
}

export function validatePluginTrust(config: PlatformConfig): void {
  if (config.requirePluginSignatures !== undefined && typeof config.requirePluginSignatures !== 'boolean') throw new Error('requirePluginSignatures must be boolean');
  if (config.revokedPluginKeys !== undefined && (!Array.isArray(config.revokedPluginKeys) || !config.revokedPluginKeys.every((name) => typeof name === 'string' && keyName(name)))) throw new Error('revokedPluginKeys must contain key IDs');
  const keys = config.pluginTrustKeys;
  if (keys === undefined) return;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('pluginTrustKeys must map IDs to Ed25519 public PEM keys');
  for (const [id, pem] of Object.entries(keys)) {
    if (!keyName(id) || typeof pem !== 'string' || pem.length > 16384 || !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(pem) || pem.includes('PRIVATE KEY')) throw new Error('pluginTrustKeys requires public PEM keys only');
    try { if (createPublicKey(pem).asymmetricKeyType !== 'ed25519') throw new Error('wrong key type'); }
    catch { throw new Error(`Invalid Ed25519 public key: ${id}`); }
  }
}

export async function verifyPluginSignature(plugin: LoadedPlugin, config: PlatformConfig): Promise<void> {
  const signature = plugin.integrity?.signature;
  if (!signature) {
    if (config.requirePluginSignatures) throw new Error(`Plugin ${plugin.name} requires a trusted publisher signature`);
    return;
  }
  if (signature.algorithm !== 'ed25519' || !keyName(signature.keyId) || typeof signature.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature.value)) throw new Error(`Plugin ${plugin.name} has an invalid signature envelope`);
  if (config.revokedPluginKeys?.includes(signature.keyId)) throw new Error(`Plugin signing key ${signature.keyId} has been revoked`);
  const pem = config.pluginTrustKeys?.[signature.keyId];
  if (!pem) throw new Error(`Plugin publisher key ${signature.keyId} is not trusted`);
  const digest = await computePluginDigest(plugin.path);
  if (!verify(null, payload(plugin, digest, signature.keyId), createPublicKey(pem), Buffer.from(signature.value, 'base64'))) throw new Error(`Plugin ${plugin.name} publisher signature verification failed`);
}

/** Explicit publisher operation. Private material stays outside the distributable plugin. */
export async function signPlugin(path: string, keyFile: string, keyId: string): Promise<{ name: string; version: string; digest: string; keyId: string }> {
  if (!keyName(keyId)) throw new Error('Invalid signing key ID');
  const plugin = await loadPluginAt(path);
  const root = await realpath(plugin.path), keyPath = await realpath(resolve(keyFile));
  const normalize = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(keyPath) === normalize(root) || normalize(keyPath).startsWith(`${normalize(root)}${sep}`)) throw new Error('Signing private key must be outside the plugin directory');
  const key = createPrivateKey(await readFile(keyPath));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Plugin signing requires an Ed25519 private key');
  const digest = await computePluginDigest(plugin.path);
  const signature: PluginSignature = { algorithm: 'ed25519', keyId, value: sign(null, payload(plugin, digest, keyId), key).toString('base64') };
  const manifest = JSON.parse(await readFile(plugin.manifestPath, 'utf8')) as PluginManifest;
  manifest.integrity = { algorithm: 'sha256', digest, signature };
  await writeJson(plugin.manifestPath, manifest);
  return { name: plugin.name, version: plugin.version, digest, keyId };
}
