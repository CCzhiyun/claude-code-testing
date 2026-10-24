import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeJson } from '../src/storage.js';
import { readMcpCredential } from '../src/mcpCredentials.js';
import { installTrustedPlugin, replaceInstalledPlugin } from '../src/pluginHistory.js';

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-management-cli-')), old = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'home');
  try { await action(root); } finally { if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old; await rm(root, { recursive: true, force: true }); }
}
function cli(root: string, args: string[], onOutput?: (text: string, child: ReturnType<typeof spawn>) => void): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dir, '..', 'src', 'cli.ts'), ...args, '--cwd', root], { stdio: 'pipe', windowsHide: true, env: { ...process.env, DISABLE_AUTOUPDATER: '1' } });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('CLI fixture timed out')); }, 15000);
    child.stdout!.on('data', chunk => { stdout += String(chunk); onOutput?.(stdout, child); }); child.stderr!.on('data', chunk => { stderr += String(chunk); }); child.stdin!.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('actual CLI manual OAuth completes resource-bound code exchange without leaking stored credentials', async () => fixture(async root => {
  let exchanges = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    exchanges++; const body = new URLSearchParams(await request.text()); expect(body.get('code')).toBe('test-code'); expect(body.get('code_verifier')!.length).toBeGreaterThan(40);
    expect(body.get('resource')).toBe(`http://127.0.0.1:${server.port}/mcp`);
    return Response.json({ access_token: 'cli-fixture-secret', token_type: 'Bearer' });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  await writeJson(join(root, '.ccpt', 'settings.json'), { marketplaceEnabled: false, mcpServers: { fixture: { transport: 'http', url: `${origin}/mcp`, oauth: { clientId: 'client', authorizationUrl: `${origin}/auth`, tokenUrl: `${origin}/token` } } } });
  let supplied = false;
  try {
    const result = await cli(root, ['mcp', 'oauth-login', 'fixture', '--flow', 'code', '--manual', '--redirect-uri', 'http://127.0.0.1:33333/callback'], (text, child) => {
      const match = text.match(/\n(http:\/\/127\.0\.0\.1:[^\r\n]+\/auth\?[^\r\n]+)\n/);
      if (match && !supplied) { supplied = true; const authorization = new URL(match[1]!), callback = new URL(authorization.searchParams.get('redirect_uri')!); callback.searchParams.set('state', authorization.searchParams.get('state')!); callback.searchParams.set('code', 'test-code'); child.stdin!.write(callback.href + '\n'); }
    });
    expect(result.code, result.stderr).toBe(0); expect(result.stdout).toContain('OAuth login completed'); expect(result.stdout + result.stderr).not.toContain('cli-fixture-secret'); expect(exchanges).toBe(1);
    expect((await readMcpCredential('fixture') as any).binding.resource).toBe(`${origin}/mcp`);
    const help = await cli(root, ['mcp', '--help']); expect(help.stdout).toContain('--manual'); expect(help.stdout).toContain('issuer pin');
  } finally { server.stop(true); }
}), 20000);

test('CLI plugin history and explicit-confirm rollback operate on installed versions', async () => fixture(async root => {
  const v1 = join(root, 'v1'), v2 = join(root, 'v2');
  await writeJson(join(v1, 'plugin.json'), { name: 'team', version: '1.0.0' }); await writeJson(join(v2, 'plugin.json'), { name: 'team', version: '2.0.0' });
  await installTrustedPlugin(root, v1); const update = await replaceInstalledPlugin(root, 'team', 'project', v2);
  const history = await cli(root, ['plugin', 'history', 'team']); expect(history.code, history.stderr).toBe(0); expect(JSON.parse(history.stdout)[0].id).toBe(update.previous.id);
  const denied = await cli(root, ['plugin', 'rollback', 'team', update.previous.id]); expect(denied.code).toBe(1); expect(denied.stderr).toContain('--confirm');
  const restored = await cli(root, ['plugin', 'rollback', 'team', update.previous.id, '--confirm']); expect(restored.code, restored.stderr).toBe(0); expect(JSON.parse(restored.stdout).version).toBe('1.0.0');
}), 20000);
