import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { callMcpServer, getMcpToken, loginMcpDeviceFlow } from '../src/mcp.js';
import { writeJson } from '../src/storage.js';

let state = '';
let previousHome: string | undefined;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  state = await mkdtemp(join(tmpdir(), 'ccpt-oauth-'));
  previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = state;
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/device') return Response.json({ device_code: 'device-code', user_code: 'CCPT-123', verification_uri: 'https://login.example.invalid/device', expires_in: 30, interval: 1 });
      if (path === '/token') return Response.json({ access_token: 'oauth-access', refresh_token: 'oauth-refresh', expires_in: 3600, token_type: 'Bearer' });
      if (path === '/mcp') return new Response([
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":50}}',
        '',
        'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"done"}]}}',
        '',
      ].join('\n'), { headers: { 'content-type': 'text/event-stream' } });
      return new Response('not found', { status: 404 });
    },
  });
});

afterAll(async () => {
  server.stop(true);
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  await rm(state, { recursive: true, force: true });
});

describe.serial('HTTP MCP and OAuth', () => {
  test('completes a browserless device flow and stores the token', async () => {
    const config = structuredClone(defaultConfig);
    const origin = `http://127.0.0.1:${server.port}`;
    const mcp = { transport: 'http' as const, url: `${origin}/mcp`, oauth: { clientId: 'ccpt-tests', deviceAuthorizationUrl: `${origin}/device`, tokenUrl: `${origin}/token`, scopes: ['tools.read'] } };
    let code = '';
    await loginMcpDeviceFlow('oauth-test', mcp, config, (details) => { code = details.userCode; });
    expect(code).toBe('CCPT-123');
    expect(await getMcpToken('oauth-test', mcp, config)).toBe('oauth-access');
  });

  test('returns HTTP SSE notifications to the active Agent call', async () => {
    const config = structuredClone(defaultConfig);
    const events: unknown[] = [];
    const result = await callMcpServer('oauth-test', { transport: 'http', url: `http://127.0.0.1:${server.port}/mcp` }, 'example', {}, true, (event) => events.push(event), config);
    expect(JSON.stringify(result)).toContain('done');
    expect(JSON.stringify(events)).toContain('notifications/progress');
  });

  test('does not refresh an external token when network policy denies it', async () => {
    await writeJson(join(state, 'mcp-tokens.json'), { blocked: { accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 } });
    const config = structuredClone(defaultConfig);
    config.policy.mode = 'restricted';
    config.policy.allowNetwork = false;
    const mcp = { transport: 'http' as const, url: 'https://tools.example.invalid/mcp', oauth: { clientId: 'test', tokenUrl: 'https://identity.example.invalid/token' } };
    await expect(getMcpToken('blocked', mcp, config)).rejects.toThrow('External network access is disabled');
  });
});
