import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliInvocation, CLI_VERSION } from '../src/entrypoints/cli.js';
import packageMetadata from '../package.json' with { type: 'json' };
import { readCredentialInput } from '../src/credentialInput.js';
import { controlProcess, terminateOwnedProcess } from '../src/executionControl.js';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('public CLI parser shares current value flags, version, aliases and optional resume semantics', () => {
  expect(CLI_VERSION).toBe(packageMetadata.version);
  expect(parseCliInvocation(['-p', 'hello', '--settings', '{}', '--mcp-config', '{}', '--tools', 'read_file', '--max-requests', '3', '--effort', 'high']).command).toBe('print');
  expect(parseCliInvocation(['credentials', 'set', 'company', '--stdin']).args).toEqual(['set', 'company']);
  expect(parseCliInvocation(['plan', 'approve', 'id', '--expected-version', '3']).options['expected-version']).toBe('3');
  expect(parseCliInvocation(['--resume', '--restricted']).options).toEqual({ resume: true, restricted: true });
  expect(parseCliInvocation(['--api-key-prefix', '']).options['api-key-prefix']).toBe('');
  expect(() => parseCliInvocation(['--settings'])).toThrow('requires a value');
});

test('piped credential input is bounded UTF-8 and does not permit visible terminal input', async () => {
  const input = async function* (...values: Uint8Array[]) { yield* values; };
  expect(await readCredentialInput(input(Buffer.from('fixture-secret\r\n')))).toBe('fixture-secret');
  await expect(readCredentialInput(input(Buffer.alloc(16001)))).rejects.toThrow('16000');
  await expect(readCredentialInput(input(Buffer.from([0xff])))).rejects.toThrow();
  await expect(readCredentialInput(Object.assign(input(Buffer.from('visible')), { isTTY: true }))).rejects.toThrow('visible');
});

test('actual owned command trees terminate on cancellation and deadline', async () => {
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (const mode of ['cancel', 'timeout']) {
    const child = spawn('node', [join(import.meta.dir, 'process-tree-fixture.cjs')], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
    const controller = new AbortController(), control = controlProcess(child, 1500, controller.signal);
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    try {
      const ids = await new Promise<{ parent: number; grandchild: number }>((resolve, reject) => { let text = ''; child.stdout!.on('data', chunk => { text += chunk.toString(); if (text.includes('\n')) resolve(JSON.parse(text.trim())); }); child.once('error', reject); child.once('exit', () => reject(new Error('Fixture exited before handshake'))); });
      expect(ids.parent).toBe(child.pid!); expect(alive(ids.grandchild)).toBe(true);
      if (mode === 'cancel') controller.abort();
      await closed;
      const deadline = Date.now() + 3000; while (alive(ids.grandchild) && Date.now() < deadline) await Bun.sleep(25);
      expect(alive(ids.grandchild)).toBe(false); expect(control.error()?.message).toContain(mode === 'cancel' ? 'cancelled' : 'timed out');
    } finally { control.dispose(); terminateOwnedProcess(child); }
  }
}, 15000);

test.skipIf(process.platform !== 'win32')('actual CLI imports protected credentials over stdin without env/argv keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-credential-stdin-')), key = 'fixture-stdin-key-874';
  const config = structuredClone(defaultConfig); config.model.apiKeyEnv = ''; config.marketplaceEnabled = false; config.hooks = []; config.policy.workspaceRoots = [root];
  await writeJson(join(root, '.ccpt/settings.json'), config);
  const env: Record<string, string> = { CCPT_HOME: join(root, 'state') };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const cli = async (args: string[], input: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/cli.ts'), ...args, '--cwd', root], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    child.stdin.write(input); child.stdin.end(); const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, code };
  };
  try {
    const stored = await cli(['credentials', 'set', 'company', '--stdin'], key + '\n'); expect(stored.code, stored.stderr).toBe(0); expect(stored.stdout + stored.stderr).not.toContain(key);
    expect(await readFile(join(root, 'state/model-credentials.dpapi.json'), 'utf8')).not.toContain(key);
    const mixed = await cli(['credentials', 'set', 'company', '--stdin', '--from-env', 'IGNORED'], key); expect(mixed.code).not.toBe(0); expect(mixed.stderr).toContain('not both'); expect(mixed.stderr).not.toContain(key);
  } finally { await removeOwnedTemporaryFixture(root); }
}, 15000);
