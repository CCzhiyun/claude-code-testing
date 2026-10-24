import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { assertExecutionActive, controlProcess } from './executionControl.js';
import type { PlatformConfig } from './types.js';
import { readNativeCredential,writeNativeCredential,removeNativeCredential } from './nativeCredentials.js';

export interface StoredMcpToken { accessToken: string; refreshToken?: string; expiresAt?: number; tokenType?: string; binding?: { resource: string; clientId: string; tokenUrl: string; issuer?: string } }
type Tokens = Record<string, string | StoredMcpToken>;
type Backend = NonNullable<PlatformConfig['mcpCredentialBackend']>;
const script = `$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $data = [Convert]::FromBase64String($request.data)
  $entropy = [Convert]::FromBase64String($request.entropy)
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.action -eq 'protect') { $result = [System.Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope) }
  elseif ($request.action -eq 'unprotect') { $result = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope) }
  else { throw 'Invalid operation' }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.Write('Windows credential protection failed'); exit 1 }`;

/** Fixed executable/script; secrets travel over stdin, never command arguments or environment. */
export async function windowsProtect(action: 'protect' | 'unprotect', data: Buffer, namespace = homeStateDir()): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('windows-dpapi credential backend requires Windows');
  assertExecutionActive();
  if (data.length > 1024 * 1024) throw new Error('MCP credential data exceeds 1 MiB');
  const entropy = createHash('sha256').update(`CCPT/MCP/DPAPI/v1:${resolve(namespace).toLowerCase()}`).digest('base64');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' },
    });
    const control = controlProcess(child, 10000);
    const chunks: Buffer[] = []; let bytes = 0, invalid = false;
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { invalid = true; child.kill(); } else chunks.push(chunk); });
    child.stderr.resume(); // Never propagate native errors containing credential material.
    child.stdin.on('error', () => {});
    child.once('error', () => { control.dispose(); reject(new Error('Windows credential helper could not start')); });
    child.once('close', code => {
      control.dispose();
      if (control.error()) { reject(control.error()); return; }
      const value = Buffer.concat(chunks).toString('ascii');
      if (code !== 0 || invalid || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) { reject(new Error('Windows credential protection failed')); return; }
      resolveResult(Buffer.from(value, 'base64'));
    });
    child.stdin.end(JSON.stringify({ action, data: data.toString('base64'), entropy }));
  });
}

function backend(config?: PlatformConfig): Backend { return config?.mcpCredentialBackend ?? 'file'; }
function pathFor(kind: Backend): string { return join(homeStateDir(), kind === 'file' ? 'mcp-tokens.json' : 'mcp-tokens.dpapi.json'); }
function validateTokens(value: unknown): Tokens {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP credential store');
  for (const [name, token] of Object.entries(value)) {
    nameCheck(name);
    if (!(typeof token === 'string' || token && typeof token === 'object' && !Array.isArray(token) && typeof (token as StoredMcpToken).accessToken === 'string')) throw new Error('Invalid MCP credential entry');
    if (typeof token === 'object' && token.binding !== undefined) {
      const binding = token.binding;
      if (!binding || typeof binding !== 'object' || ['resource', 'clientId', 'tokenUrl'].some(key => typeof binding[key as keyof typeof binding] !== 'string' || !binding[key as keyof typeof binding]) || binding.issuer !== undefined && typeof binding.issuer !== 'string') throw new Error('Invalid MCP OAuth credential binding');
    }
  }
  return value as Tokens;
}
async function readTokens(kind: Backend): Promise<Tokens> {
  if (kind === 'file') return validateTokens(await readJson<Tokens>(pathFor(kind), {}));
  if (process.platform !== 'win32') throw new Error('windows-dpapi credential backend requires Windows');
  const envelope = await readJson<{ version: number; backend: string; data: string } | null>(pathFor(kind), null);
  if (!envelope) return {};
  if (envelope.version !== 1 || envelope.backend !== kind || typeof envelope.data !== 'string' || envelope.data.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data)) throw new Error('Invalid protected MCP credential envelope');
  const decoded = await windowsProtect('unprotect', Buffer.from(envelope.data, 'base64'));
  try { return validateTokens(JSON.parse(decoded.toString('utf8'))); }
  finally { decoded.fill(0); }
}
async function writeTokens(kind: Backend, tokens: Tokens): Promise<void> {
  if (kind === 'file') { await writeJson(pathFor(kind), tokens); return; }
  const data = Buffer.from(JSON.stringify(tokens));
  try {
    const protectedData = await windowsProtect('protect', data);
    await writeJson(pathFor(kind), { version: 1, backend: kind, data: protectedData.toString('base64') });
  } finally { data.fill(0); }
}
function nameCheck(name: string): void { if (!/^[a-zA-Z0-9_.-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid MCP server name'); }
export async function readMcpCredential(name: string, config?: PlatformConfig): Promise<string | StoredMcpToken | undefined> {
  const kind=backend(config);nameCheck(name);
  if(kind==='macos-keychain'||kind==='linux-secret-service'){
    const bytes=await readNativeCredential(kind,`mcp:${name}`);if(!bytes)return undefined;
    try{const entries=validateTokens(JSON.parse(bytes.toString('utf8')));if(Object.keys(entries).length!==1||!Object.hasOwn(entries,name))throw new Error('Native MCP credential identity mismatch');return entries[name];}finally{bytes.fill(0);}
  }
  nameCheck(name); const tokens = await readTokens(backend(config)); return Object.hasOwn(tokens, name) ? tokens[name] : undefined;
}
export async function storeMcpCredential(name: string, token: StoredMcpToken, config?: PlatformConfig): Promise<void> {
  nameCheck(name); const kind = backend(config);
  validateTokens({ [name]: token });
  if(kind==='macos-keychain'||kind==='linux-secret-service'){const bytes=Buffer.from(JSON.stringify({[name]:token}));try{await writeNativeCredential(kind,`mcp:${name}`,bytes);}finally{bytes.fill(0);}return;}
  await withFileLock(`${pathFor(kind)}.lock`, async () => { const tokens = await readTokens(kind); tokens[name] = token; await writeTokens(kind, tokens); });
}
export async function removeMcpCredential(name: string, config?: PlatformConfig): Promise<void> {
  nameCheck(name); const kind = backend(config);
  if(kind==='macos-keychain'||kind==='linux-secret-service'){await removeNativeCredential(kind,`mcp:${name}`);return;}
  await withFileLock(`${pathFor(kind)}.lock`, async () => { const tokens = await readTokens(kind); delete tokens[name]; await writeTokens(kind, tokens); });
}
/** Explicit operator migration; write ciphertext first, then remove migrated plaintext records. */
export async function migrateMcpCredentials(config: PlatformConfig): Promise<number> {
  if (backend(config) !== 'windows-dpapi') throw new Error('Select mcpCredentialBackend=windows-dpapi before migration');
  const legacyPath = pathFor('file'), protectedPath = pathFor('windows-dpapi');
  return withFileLock(`${legacyPath}.lock`, () => withFileLock(`${protectedPath}.lock`, async () => {
    const old = await readTokens('file'), current = await readTokens('windows-dpapi');
    const count = Object.keys(old).length;
    // Existing protected records win; a stale plaintext backup cannot replace a renewed token.
    await writeTokens('windows-dpapi', { ...old, ...current });
    await writeTokens('file', {});
    return count;
  }));
}
