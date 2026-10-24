import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { loginMcp, logoutMcp, getMcpToken, loginMcpDeviceFlow } from '../src/mcp.js';
import { migrateMcpCredentials, readMcpCredential, storeMcpCredential, windowsProtect } from '../src/mcpCredentials.js';
import { readJson, writeJson } from '../src/storage.js';
import { withExecutionSignal } from '../src/executionControl.js';

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-credentials-')); const old = process.env.CCPT_HOME;
  process.env.CCPT_HOME = root;
  try { await action(root); }
  finally { if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old; await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('credential storage serializes concurrent writes and rejects prototype names', async () => fixture(async root => {
  await Promise.all(Array.from({ length: 8 }, (_, i) => loginMcp(`fixture${i}`, `token-${i}`)));
  expect(Object.keys(await readJson(join(root, 'mcp-tokens.json'), {})).length).toBe(8);
  await expect(loginMcp('__proto__', 'bad')).rejects.toThrow('Invalid');
  await expect(readMcpCredential('constructor')).rejects.toThrow('Invalid');
  await logoutMcp('fixture0'); expect(await getMcpToken('fixture0')).toBeUndefined();
}));

test.skipIf(process.platform !== 'win32')('real Windows DPAPI protects tokens, preserves renewals during explicit migration and fails closed on tamper or namespace changes', async () => fixture(async root => {
  const config = structuredClone(defaultConfig); config.mcpCredentialBackend = 'windows-dpapi';
  await loginMcp('legacy', 'legacy-fixture-secret'); await loginMcp('same', 'old-fixture-secret');
  await loginMcp('same', 'new-fixture-secret', config);
  expect(await migrateMcpCredentials(config)).toBe(2);
  expect(await getMcpToken('same', undefined, config)).toBe('new-fixture-secret');
  expect(await getMcpToken('legacy', undefined, config)).toBe('legacy-fixture-secret');
  expect(await readJson(join(root, 'mcp-tokens.json'), {})).toEqual({});
  const protectedPath = join(root, 'mcp-tokens.dpapi.json');
  const content = await readFile(protectedPath, 'utf8'); expect(content).not.toContain('fixture-secret');
  const encrypted = JSON.parse(content).data;
  await expect(windowsProtect('unprotect', Buffer.from(encrypted, 'base64'), join(root, 'different-namespace'))).rejects.toThrow('protection failed');
  await logoutMcp('legacy', config); expect(await getMcpToken('legacy', undefined, config)).toBeUndefined();
  await loginMcp('same', 'fallback-must-not-be-used');
  const envelope = await readJson<any>(protectedPath, null); envelope.data = Buffer.from('invalid encrypted payload').toString('base64'); await writeJson(protectedPath, envelope);
  await expect(getMcpToken('same', undefined, config)).rejects.toThrow('protection failed');
}), 30000);

test('refresh is serialized per server and preserves tokens for other servers', async () => fixture(async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    calls++; expect(new URLSearchParams(await request.text()).get('refresh_token')).toBe('refresh-fixture');
    await Bun.sleep(25); return Response.json({ access_token: 'renewed', refresh_token: 'rotated', expires_in: 3600 });
  } });
  const config = structuredClone(defaultConfig);
  const definition = { transport: 'http' as const, url: `http://127.0.0.1:${server.port}/mcp`, oauth: { clientId: 'fixture', tokenUrl: `http://127.0.0.1:${server.port}/token` } };
  try {
    await storeMcpCredential('one', { accessToken: 'expired', refreshToken: 'refresh-fixture', expiresAt: 1 }, config);
    await loginMcp('other', 'other-token', config);
    expect(await Promise.all([getMcpToken('one', definition, config), getMcpToken('one', definition, config)])).toEqual(['renewed', 'renewed']);
    expect(calls).toBe(1); expect(await getMcpToken('other', undefined, config)).toBe('other-token');
  } finally { server.stop(true); }
}));

test('cancelling device authorization interrupts its polling wait without storing credentials', async () => fixture(async root => {
  let polls = 0;
  const controller = new AbortController();
  const server = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/device') return Response.json({ device_code: 'fixture', user_code: 'CODE', verification_uri: 'https://example.invalid', interval: 60, expires_in: 600 });
    polls++; return Response.json({ access_token: 'unexpected' });
  } });
  try {
    const config = structuredClone(defaultConfig);
    const definition = { transport: 'http' as const, url: `http://127.0.0.1:${server.port}/mcp`, oauth: { clientId: 'fixture', tokenUrl: `http://127.0.0.1:${server.port}/token`, deviceAuthorizationUrl: `http://127.0.0.1:${server.port}/device` } };
    const started = Date.now();
    await expect(withExecutionSignal(controller.signal, () => loginMcpDeviceFlow('cancel', definition, config, () => controller.abort()))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000); expect(polls).toBe(0);
    expect(await readJson(join(root, 'mcp-tokens.json'), null)).toBeNull();
  } finally { server.stop(true); }
}));

test('device authorization rejects invalid timing and never accepts a token from an HTTP error', async () => fixture(async root => {
  let invalidTiming = true, codes = 0;
  const server = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/device') return Response.json({ device_code: 'fixture', user_code: 'CODE', verification_uri: 'https://example.invalid', interval: invalidTiming ? -1 : 1, expires_in: 10 });
    return Response.json({ access_token: 'error-token-must-not-store' }, { status: 400 });
  } });
  try {
    const config = structuredClone(defaultConfig);
    const definition = { transport: 'http' as const, url: `http://127.0.0.1:${server.port}/mcp`, oauth: { clientId: 'fixture', tokenUrl: `http://127.0.0.1:${server.port}/token`, deviceAuthorizationUrl: `http://127.0.0.1:${server.port}/device` } };
    await expect(loginMcpDeviceFlow('fixture', definition, config, () => { codes++; })).rejects.toThrow('timing');
    expect(codes).toBe(0); invalidTiming = false;
    await expect(loginMcpDeviceFlow('fixture', definition, config, () => { codes++; })).rejects.toThrow('400');
    expect(await readJson(join(root, 'mcp-tokens.json'), null)).toBeNull();
  } finally { server.stop(true); }
}));
