import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { discoverMcpOAuth, loginMcpAuthorizationCode, oauthUrl } from '../src/mcpOAuth.js';
import { readMcpCredential, storeMcpCredential } from '../src/mcpCredentials.js';
import { getMcpToken } from '../src/mcp.js';
import { generateCodeChallenge } from '../src/services/oauth/crypto.js';
import { withExecutionSignal } from '../src/executionControl.js';
import type { McpServerConfig } from '../src/types.js';

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-oauth-')), previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = root;
  try { await action(root); } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
}
function callback(auth: string, code = 'fixture-code'): string {
  const url = new URL(auth), returned = new URL(url.searchParams.get('redirect_uri')!);
  returned.searchParams.set('state', url.searchParams.get('state')!); returned.searchParams.set('code', code); return returned.href;
}

test('OAuth transport rejects cleartext remote endpoints, URL credentials and fragments', () => {
  for (const url of ['http://enterprise.invalid/token', 'https://user:secret@example.test/token', 'https://example.test/#secret']) expect(() => oauthUrl(url)).toThrow();
  expect(oauthUrl('http://127.0.0.1:3456/token').hostname).toBe('127.0.0.1');
});

test('pinned discovery validates resource, issuer, PKCE and public client without sending credentials', async () => {
  let mode = 'valid', reads = 0;
  const server = Bun.serve({ port: 0, fetch(request) {
    reads++; expect(request.headers.get('authorization')).toBeNull();
    const origin = new URL(request.url).origin, path = new URL(request.url).pathname;
    if (path === '/mcp') return new Response('', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${origin}/resource"` } });
    if (path === '/resource') return Response.json({ resource: `${origin}/${mode === 'resource' ? 'wrong' : 'mcp'}`, authorization_servers: [origin] });
    return Response.json({ issuer: mode === 'issuer' ? 'https://evil.invalid/' : origin, authorization_endpoint: mode === 'endpoint' ? 'https://evil.invalid/auth' : `${origin}/auth`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, code_challenge_methods_supported: mode === 'pkce' ? ['plain'] : ['S256'], token_endpoint_auth_methods_supported: ['none'] });
  } });
  const origin = `http://127.0.0.1:${server.port}`, config = structuredClone(defaultConfig);
  const definition: McpServerConfig = { transport: 'http', url: `${origin}/mcp`, oauth: { issuer: origin } };
  try {
    expect((await discoverMcpOAuth(definition, config)).tokenUrl).toBe(`${origin}/token`);
    for (mode of ['resource', 'issuer', 'endpoint', 'pkce']) await expect(discoverMcpOAuth(definition, config)).rejects.toThrow();
    const before = reads; delete definition.oauth!.issuer;
    await expect(discoverMcpOAuth(definition, config)).rejects.toThrow('trusted'); expect(reads).toBe(before);
  } finally { server.stop(true); }
});

test('manual PKCE exchange includes resource, keeps provider secrets out of errors and binds refresh to deployment', async () => fixture(async () => {
  let auth = '', mode = 'valid', calls = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    calls++; const body = new URLSearchParams(await request.text());
    expect(body.get('resource')).toBe(`http://127.0.0.1:${server.port}/mcp`);
    if (body.get('grant_type') === 'authorization_code') {
      expect(body.get('code')).toBe('fixture-code');
      expect(generateCodeChallenge(body.get('code_verifier')!)).toBe(new URL(auth).searchParams.get('code_challenge')!);
    } else { expect(body.get('refresh_token')).toBe('fixture-refresh'); expect(body.get('client_id')).toBe('client'); }
    if (mode === 'error') return Response.json({ error: 'invalid_grant', error_description: 'secret must never be printed' }, { status: 400 });
    return Response.json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'fixture-refresh' });
  } });
  const origin = `http://127.0.0.1:${server.port}`, config = structuredClone(defaultConfig);
  const definition: McpServerConfig = { transport: 'http', url: `${origin}/mcp`, oauth: { clientId: 'client', authorizationUrl: `${origin}/auth`, tokenUrl: `${origin}/token`, scopes: ['read'] } };
  const options = { redirectUri: 'http://127.0.0.1:33333/callback', onAuthorization: (details: { authorizationUrl: string }) => { auth = details.authorizationUrl; }, receiveCallback: async () => callback(auth) };
  try {
    await loginMcpAuthorizationCode('fixture', definition, config, options);
    expect(new URL(auth).searchParams.get('code_challenge_method')).toBe('S256'); expect(new URL(auth).searchParams.get('scope')).toBe('read');
    const token = await readMcpCredential('fixture', config); expect(typeof token).toBe('object');
    await expect(getMcpToken('fixture', { ...definition, url: `${origin}/other` }, config)).rejects.toThrow('changed');
    expect(calls).toBe(1);
    await storeMcpCredential('fixture', { ...(token as any), expiresAt: 1 }, config);
    expect(await getMcpToken('fixture', definition, config)).toBe('fixture-token'); expect(calls).toBe(2);
    mode = 'error'; await expect(loginMcpAuthorizationCode('error', definition, config, options)).rejects.toThrow('invalid_grant');
    expect(await readMcpCredential('error', config)).toBeUndefined();
    try { await loginMcpAuthorizationCode('error', definition, config, options); } catch (error) { expect(String(error)).not.toContain('secret must'); }
  } finally { server.stop(true); }
}));

test('loopback login rejects mismatched state, completes valid callback and closes listener', async () => fixture(async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ access_token: 'fixture', token_type: 'Bearer' }) });
  const origin = `http://127.0.0.1:${server.port}`, config = structuredClone(defaultConfig);
  const definition: McpServerConfig = { transport: 'http', url: `${origin}/mcp`, oauth: { clientId: 'client', authorizationUrl: `${origin}/auth`, tokenUrl: `${origin}/token` } };
  let redirect = '';
  try {
    await loginMcpAuthorizationCode('local', definition, config, { onAuthorization: async details => {
      redirect = details.redirectUri; const wrong = new URL(callback(details.authorizationUrl)); wrong.searchParams.set('state', 'wrong');
      expect((await fetch(wrong)).status).toBe(400);
      expect((await fetch(callback(details.authorizationUrl))).status).toBe(200);
    } });
    expect(await getMcpToken('local', definition, config)).toBe('fixture');
    await expect(fetch(redirect)).rejects.toThrow();
  } finally { server.stop(true); }
}));

test('denial and cancellation complete promptly, clean up callback and never save credentials', async () => fixture(async () => {
  const definition: McpServerConfig = { transport: 'http', url: 'http://127.0.0.1:44444/mcp', oauth: { clientId: 'client', authorizationUrl: 'http://127.0.0.1:44444/auth', tokenUrl: 'http://127.0.0.1:44444/token' } };
  const config = structuredClone(defaultConfig); let redirect = '';
  await expect(loginMcpAuthorizationCode('denied', definition, config, { onAuthorization: async details => {
    const url = new URL(callback(details.authorizationUrl)); url.searchParams.delete('code'); url.searchParams.set('error', 'access_denied'); await fetch(url);
  } })).rejects.toThrow('denied');
  const controller = new AbortController();
  await expect(withExecutionSignal(controller.signal, () => loginMcpAuthorizationCode('cancelled', definition, config, { onAuthorization: details => { redirect = details.redirectUri; controller.abort(); } }))).rejects.toThrow();
  await expect(fetch(redirect)).rejects.toThrow(); expect(await readMcpCredential('cancelled', config)).toBeUndefined();
  const started = Date.now();
  await expect(loginMcpAuthorizationCode('timeout', definition, config, { timeoutMs: 30, onAuthorization: () => new Promise(() => {}) })).rejects.toThrow('timed out');
  expect(Date.now() - started).toBeLessThan(1500);
}));

test('dynamic registration is explicit and accepts only a public client', async () => fixture(async () => {
  let registrations = 0, confidential = false;
  const server = Bun.serve({ port: 0, async fetch(request) {
    const origin = new URL(request.url).origin, path = new URL(request.url).pathname;
    if (path === '/resource') return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
    if (path.startsWith('/.well-known/')) return Response.json({ issuer: origin, authorization_endpoint: `${origin}/auth`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, code_challenge_methods_supported: ['S256'] });
    if (path === '/register') { registrations++; expect((await request.json()).token_endpoint_auth_method).toBe('none'); return Response.json({ client_id: 'registered', ...(confidential ? { client_secret: 'do-not-accept' } : {}) }); }
    return Response.json({ access_token: 'registered-token', token_type: 'bearer' });
  } });
  const origin = `http://127.0.0.1:${server.port}`, config = structuredClone(defaultConfig);
  const definition: McpServerConfig = { transport: 'http', url: `${origin}/mcp`, oauth: { issuer: origin, metadataUrl: `${origin}/resource` } };
  let auth = ''; const options = { redirectUri: 'http://127.0.0.1:33333/callback', onAuthorization: (details: { authorizationUrl: string }) => { auth = details.authorizationUrl; }, receiveCallback: async () => callback(auth) };
  try {
    await expect(loginMcpAuthorizationCode('new', definition, config, options)).rejects.toThrow('explicitly'); expect(registrations).toBe(0);
    await loginMcpAuthorizationCode('new', definition, config, { ...options, register: true }); expect(registrations).toBe(1);
    expect(await getMcpToken('new', definition, config)).toBe('registered-token');
    confidential = true; await expect(loginMcpAuthorizationCode('confidential', definition, config, { ...options, register: true })).rejects.toThrow('public client');
  } finally { server.stop(true); }
}));

test('manual callbacks reject replay state, duplicates and wrong origin before token requests', async () => fixture(async () => {
  const definition: McpServerConfig = { transport: 'http', url: 'http://127.0.0.1:44444/mcp', oauth: { clientId: 'client', authorizationUrl: 'http://127.0.0.1:44444/auth', tokenUrl: 'http://127.0.0.1:44444/token' } };
  for (const mode of ['state', 'duplicate', 'origin']) {
    await expect(loginMcpAuthorizationCode('invalid', definition, structuredClone(defaultConfig), { redirectUri: 'http://127.0.0.1:33333/callback', onAuthorization: () => {}, receiveCallback: async details => {
      const url = new URL(callback(details.authorizationUrl));
      if (mode === 'state') url.searchParams.set('state', 'old'); if (mode === 'duplicate') url.searchParams.append('code', 'duplicate'); if (mode === 'origin') url.port = '33334'; return url.href;
    } })).rejects.toThrow('callback');
  }
}));
