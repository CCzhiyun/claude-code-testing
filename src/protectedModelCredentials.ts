import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { PlatformConfig } from './types.js';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { windowsProtect } from './mcpCredentials.js';
import { resolveModelEndpoint } from './modelConnection.js';
import { setProtectedModelKey } from './modelCredentialState.js';
import { readNativeCredential,writeNativeCredential,removeNativeCredential } from './nativeCredentials.js';

type Envelope = { version: 1; scope: string; data: string };
type Vault = Record<string, Envelope>;
const path = (model?:PlatformConfig['model']) => join(homeStateDir(), model?.credentialBackend&&model.credentialBackend!=='windows-dpapi'?`model-credentials.${model.credentialBackend}.json`:'model-credentials.dpapi.json');
const namespace = () => join(homeStateDir(), 'model-credentials');
function nameCheck(name: string) { if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) throw new Error('Invalid model credential reference'); }
export function modelCredentialScope(model: PlatformConfig['model']): string { return createHash('sha256').update(resolveModelEndpoint(model)).digest('hex'); }
export async function storeModelCredential(name: string, key: string, model: PlatformConfig['model']): Promise<void> {
  nameCheck(name);
  if (!key.trim() || key.length > 16000 || /[\r\n\0]/.test(key)) throw new Error('Invalid model API key');
  const clear = Buffer.from(key);
  try {
    const backend=model.credentialBackend;
    if(backend==='macos-keychain'||backend==='linux-secret-service'){
      const scope=modelCredentialScope(model);
      await withFileLock(`${path(model)}.lock`,async()=>{await writeNativeCredential(backend,`model:${name}:${scope}`,clear);const vault=await readJson<Vault>(path(model),{});vault[name]={version:1,scope,data:backend};await writeJson(path(model),vault);});return;
    }
    const ciphertext = await windowsProtect('protect', clear, namespace());
    await withFileLock(`${path()}.lock`, async () => { const vault = await readJson<Vault>(path(), {}); vault[name] = { version: 1, scope: modelCredentialScope(model), data: ciphertext.toString('base64') }; await writeJson(path(), vault); });
  } finally { clear.fill(0); }
}
export async function listModelCredentials(model?:PlatformConfig['model']): Promise<string[]> { return Object.keys(await readJson<Vault>(path(model), {})).sort(); }
export async function removeModelCredential(name: string,model?:PlatformConfig['model']): Promise<void> { nameCheck(name); await withFileLock(`${path(model)}.lock`, async () => { const vault = await readJson<Vault>(path(model), {});const backend=model?.credentialBackend,entry=vault[name];if(entry&&(backend==='macos-keychain'||backend==='linux-secret-service')){if(!/^[a-f0-9]{64}$/.test(entry.scope))throw new Error('Invalid native model credential scope');await removeNativeCredential(backend,`model:${name}:${entry.scope}`);}delete vault[name]; await writeJson(path(model), vault); }); }
const decrypted = new WeakMap<PlatformConfig['model'], { identity: string; key: string }>();
export async function prepareModelCredential(model: PlatformConfig['model']): Promise<void> {
  const ref = model.credentialRef; if (!ref) return;
  nameCheck(ref);
  if (model.apiKeyEnv || Object.keys(model.headersFromEnvironment ?? {}).some(name => /^(authorization|api-key|x-api-key)$/i.test(name))) throw new Error('credentialRef cannot be combined with apiKeyEnv or an authentication header mapping');
  const vault = await readJson<Vault>(path(model), {}), entry = Object.hasOwn(vault, ref) ? vault[ref] : undefined;
  const scope = modelCredentialScope(model);
  const backend=model.credentialBackend;
  if(backend==='macos-keychain'||backend==='linux-secret-service'){
    if(!entry||entry.version!==1||entry.scope!==scope||entry.data!==backend)throw new Error('Protected model credential is missing, invalid, or bound to another endpoint');
    const clear=await readNativeCredential(backend,`model:${ref}:${scope}`);
    try{const key=clear?.toString('utf8');if(!key?.trim()||/[\r\n\0]/.test(key))throw new Error('Native model credential missing or invalid');setProtectedModelKey(model,scope,key);}finally{clear?.fill(0);}return;
  }
  if (!entry || entry.version !== 1 || entry.scope !== scope || typeof entry.data !== 'string' || entry.data.length > 64000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.data)) throw new Error('Protected model credential is missing, invalid, or bound to another endpoint');
  const identity = `${ref}:${scope}:${entry.data}`;
  let cached = decrypted.get(model);
  if (cached?.identity !== identity) {
    const clear = await windowsProtect('unprotect', Buffer.from(entry.data, 'base64'), namespace());
    try { cached = { identity, key: clear.toString('utf8') }; decrypted.set(model, cached); } finally { clear.fill(0); }
  }
  setProtectedModelKey(model, scope, cached!.key);
}
