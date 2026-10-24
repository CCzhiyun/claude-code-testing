import { createServer } from 'node:http';
import { generateCodeVerifier, generateCodeChallenge, generateState, verifyState } from './services/oauth/crypto.js';
import { networkRequest } from './network.js';
import { executionSignal, withExecutionSignal } from './executionControl.js';
import { storeMcpCredential, type StoredMcpToken } from './mcpCredentials.js';
import type { McpServerConfig, PlatformConfig } from './types.js';

const loopback = (url: URL): boolean => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
export function oauthUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && loopback(url))) throw new Error('OAuth URLs require HTTPS (HTTP only on loopback), without credentials or fragments');
  return url;
}
export function mcpResource(server: McpServerConfig): string {
  if (server.transport !== 'http' || !server.url) throw new Error('Authorization-code OAuth requires an HTTP MCP server');
  return oauthUrl(server.url).href;
}
function authorize(url: string, config: PlatformConfig): URL {
  const target = oauthUrl(url);
  if ((config.policy.mode === 'restricted' || !config.policy.allowNetwork) && !loopback(target)) throw new Error('External OAuth access is disabled by policy');
  if (!loopback(target) && config.network.allowedHosts.length && !config.network.allowedHosts.some(raw => { const entry = raw.toLowerCase(); return entry === target.hostname || entry.startsWith('*.') && target.hostname.endsWith(entry.slice(1)); })) throw new Error('OAuth host is not allowlisted');
  return target;
}
export async function oauthRequestObject(url: string, config: PlatformConfig, method = 'GET', body?: string, json = false): Promise<Record<string, unknown>> {
  authorize(url, config);
  const response = await networkRequest(url, { method, headers: { accept: 'application/json', ...(body ? { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' } : {}) }, ...(body ? { body } : {}), maxResponseBytes: 256000, deadlineMs: Math.min(config.network.timeoutMs, 30000) }, config.network);
  let object: unknown;
  try { object = JSON.parse(response.text); } catch { throw new Error(`OAuth endpoint returned invalid JSON (${response.status})`); }
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('OAuth endpoint returned an invalid object');
  const value = object as Record<string, unknown>;
  if (response.status < 200 || response.status >= 300 || value.error) {
    const code = typeof value.error === 'string' && /^[a-z_]{1,80}$/.test(value.error) ? value.error : 'provider_rejected';
    throw new Error(`OAuth request failed (${response.status}): ${code}`); // Never expose codes, tokens or raw provider text.
  }
  return value;
}
export interface McpOAuthDeployment { resource: string; authorizationUrl: string; tokenUrl: string; registrationUrl?: string; issuer?: string }
/** Unauthenticated discovery only. Metadata never determines a new trusted issuer implicitly. */
export async function discoverMcpOAuth(server: McpServerConfig, config: PlatformConfig): Promise<McpOAuthDeployment> {
  const resource = mcpResource(server), oauth = server.oauth;
  if (!oauth) throw new Error('Configure MCP oauth with an issuer pin or explicit authorizationUrl/tokenUrl');
  authorize(resource, config);
  if (oauth.authorizationUrl && oauth.tokenUrl) {
    authorize(oauth.authorizationUrl, config); authorize(oauth.tokenUrl, config);
    return { resource, authorizationUrl: oauth.authorizationUrl, tokenUrl: oauth.tokenUrl, ...(oauth.issuer ? { issuer: authorize(oauth.issuer, config).href } : {}) };
  }
  if (!oauth.issuer) throw new Error('Metadata discovery requires an explicitly trusted oauth.issuer');
  const issuer = authorize(oauth.issuer, config);
  if (issuer.search) throw new Error('OAuth issuer must not contain a query');
  let metadataUrl = oauth.metadataUrl;
  if (!metadataUrl) {
    const challenge = await networkRequest(resource, { method: 'GET', maxResponseBytes: 64000, deadlineMs: Math.min(config.network.timeoutMs, 10000) }, config.network);
    const header = challenge.headers['www-authenticate'];
    const text = Array.isArray(header) ? header.join(',') : header ?? '';
    if (challenge.status === 401) metadataUrl = /\bresource_metadata="([^"\r\n]+)"/i.exec(text)?.[1];
    metadataUrl ??= `${new URL(resource).origin}/.well-known/oauth-protected-resource${new URL(resource).pathname === '/' ? '' : new URL(resource).pathname}`;
  }
  if (authorize(metadataUrl, config).origin !== new URL(resource).origin) throw new Error('Protected-resource metadata must stay on the configured MCP origin');
  const protectedResource = await oauthRequestObject(metadataUrl, config);
  if (typeof protectedResource.resource !== 'string' || oauthUrl(protectedResource.resource).href !== resource) throw new Error('OAuth resource metadata does not match the configured MCP resource');
  if (!Array.isArray(protectedResource.authorization_servers) || !protectedResource.authorization_servers.includes(issuer.href.replace(/\/$/, '')) && !protectedResource.authorization_servers.includes(issuer.href)) throw new Error('OAuth metadata does not advertise the pinned issuer');
  const path = issuer.pathname.replace(/\/$/, '');
  const metadata = await oauthRequestObject(`${issuer.origin}/.well-known/oauth-authorization-server${path}`, config);
  if (typeof metadata.issuer !== 'string' || oauthUrl(metadata.issuer).href !== issuer.href) throw new Error('OAuth authorization-server issuer mismatch');
  if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) throw new Error('OAuth server must advertise PKCE S256');
  if (Array.isArray(metadata.token_endpoint_auth_methods_supported) && !metadata.token_endpoint_auth_methods_supported.includes('none')) throw new Error('This OAuth client requires public-client token authentication');
  const endpoint = (key: string): string => {
    const value = metadata[key]; if (typeof value !== 'string' || authorize(value, config).origin !== issuer.origin) throw new Error(`OAuth ${key} must be on the pinned issuer origin`); return value;
  };
  return { resource, issuer: issuer.href, authorizationUrl: endpoint('authorization_endpoint'), tokenUrl: endpoint('token_endpoint'), ...(metadata.registration_endpoint ? { registrationUrl: endpoint('registration_endpoint') } : {}) };
}

export interface OAuthLoginDetails { authorizationUrl: string; redirectUri: string }
export interface OAuthLoginOptions {
  timeoutMs?: number; register?: boolean; redirectUri?: string;
  onAuthorization: (details: OAuthLoginDetails) => void | Promise<void>;
  /** Browserless host: paste the full callback URL via an input channel, never CLI arguments. */
  receiveCallback?: (details: OAuthLoginDetails, signal: AbortSignal) => Promise<string>;
}
function callbackCode(value: string, redirect: string, state: string, issuer?: string, allowDenial = false): string {
  if (value.length > 16384) throw new Error('OAuth callback exceeds limit');
  const url = oauthUrl(value), expected = oauthUrl(redirect);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new Error('OAuth callback destination mismatch');
  if (url.searchParams.getAll('state').length !== 1 || !verifyState(url.searchParams.get('state') ?? '', state)) throw new Error('OAuth callback state mismatch');
  if (url.searchParams.has('iss') && (url.searchParams.getAll('iss').length !== 1 || !issuer || url.searchParams.get('iss') !== issuer.replace(/\/$/, '') && url.searchParams.get('iss') !== issuer)) throw new Error('OAuth callback issuer mismatch');
  if (url.searchParams.has('error')) { if (allowDenial) return ''; throw new Error('OAuth authorization was denied'); }
  const code = url.searchParams.get('code');
  if (url.searchParams.getAll('code').length !== 1 || !code || code.length > 8192 || /[\u0000-\u001f\u007f]/.test(code)) throw new Error('OAuth callback has no valid code');
  return code;
}

/** One live login, in-memory verifier/state; no persistent pending codes or automatic browser launch. */
export async function loginMcpAuthorizationCode(name: string, server: McpServerConfig, config: PlatformConfig, options: OAuthLoginOptions): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid MCP server name');
  const timeout = options.timeoutMs ?? 300000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000) throw new Error('OAuth timeout must be 1–600000 ms');
  const controller = new AbortController(), parent = executionSignal();
  const abort = () => controller.abort(); parent?.addEventListener('abort', abort, { once: true }); if (parent?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  const bounded = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const stop = () => { controller.signal.removeEventListener('abort', stop); reject(new Error('OAuth login cancelled or timed out')); };
    controller.signal.addEventListener('abort', stop, { once: true });
    operation.then(value => { controller.signal.removeEventListener('abort', stop); resolve(value); }, error => { controller.signal.removeEventListener('abort', stop); reject(error); });
    if (controller.signal.aborted) stop();
  });
  let listener: ReturnType<typeof createServer> | undefined;
  try {
    await withExecutionSignal(controller.signal, async () => {
      const deployment = await discoverMcpOAuth(server, config);
      const verifier = generateCodeVerifier(), state = generateState();
      let redirect = options.redirectUri ?? server.oauth?.redirectUri;
      let callback: Promise<string> | undefined;
      if (options.receiveCallback) {
        if (!redirect) throw new Error('Manual OAuth requires an explicitly registered redirect URI');
        oauthUrl(redirect);
      } else {
        if (redirect && (oauthUrl(redirect).protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(oauthUrl(redirect).hostname) || oauthUrl(redirect).search || oauthUrl(redirect).port === '0')) throw new Error('Local callback requires HTTP localhost/127.0.0.1 with no query or explicit zero port');
        let complete!: (code: string) => void;
        callback = new Promise(resolve => { complete = resolve; });
        listener = createServer((request, response) => {
          const headers = { 'content-type': 'text/plain', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
          if (request.method !== 'GET' || (request.url?.length ?? 0) > 16384) { response.writeHead(400, headers).end('Invalid callback'); return; }
          try {
            if (request.headers.host !== new URL(redirect!).host) throw new Error('host');
            const value = new URL(request.url!, redirect).href;
            callbackCode(value, redirect!, state, deployment.issuer, true);
            response.writeHead(200, headers).end('CCPT authorization received. Return to the terminal.'); complete(value);
          } catch { response.writeHead(400, headers).end('Invalid authorization callback'); }
        });
        listener.requestTimeout = 5000; listener.headersTimeout = 5000;
        await new Promise<void>((resolve, reject) => { listener!.once('error', reject); listener!.listen(redirect ? Number(new URL(redirect).port || 80) : 0, redirect ? new URL(redirect).hostname : '127.0.0.1', resolve); });
        if (!redirect) { const address = listener.address(); if (!address || typeof address === 'string') throw new Error('OAuth callback unavailable'); redirect = `http://127.0.0.1:${address.port}/oauth/callback`; }
      }
      const redirectUrl = oauthUrl(redirect!); if (redirectUrl.search) throw new Error('OAuth redirect URI must not contain a query');
      let clientId = server.oauth?.clientId;
      if (!clientId) {
        if (!options.register || !deployment.registrationUrl) throw new Error('Configure oauth.clientId or explicitly enable dynamic registration');
        const registered = await oauthRequestObject(deployment.registrationUrl, config, 'POST', JSON.stringify({ client_name: 'CCPT', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }), true);
        if (typeof registered.client_id !== 'string' || !registered.client_id || registered.client_id.length > 2048 || registered.client_secret || registered.token_endpoint_auth_method && registered.token_endpoint_auth_method !== 'none') throw new Error('OAuth registration did not return a valid public client');
        clientId = registered.client_id;
      }
      if (clientId.length > 2048 || /[\u0000-\u001f\u007f]/.test(clientId)) throw new Error('Invalid OAuth client ID');
      const url = new URL(deployment.authorizationUrl);
      for (const key of ['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource']) url.searchParams.delete(key);
      for (const [key, value] of Object.entries({ client_id: clientId, response_type: 'code', redirect_uri: redirect!, state, code_challenge: generateCodeChallenge(verifier), code_challenge_method: 'S256', resource: deployment.resource, ...(server.oauth?.scopes?.length ? { scope: server.oauth.scopes.join(' ') } : {}) })) url.searchParams.set(key, value);
      const details = { authorizationUrl: url.href, redirectUri: redirect! };
      await bounded(Promise.resolve(options.onAuthorization(details)));
      const received = await bounded(options.receiveCallback ? options.receiveCallback(details, controller.signal) : callback!);
      const code = callbackCode(received, redirect!, state, deployment.issuer);
      listener?.closeAllConnections(); listener?.close();
      const token = await oauthRequestObject(deployment.tokenUrl, config, 'POST', new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect!, resource: deployment.resource }).toString());
      if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 256000 || /\s/.test(token.access_token) || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') throw new Error('OAuth token response is invalid');
      if (token.expires_in !== undefined && (typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 31536000)) throw new Error('OAuth token lifetime is invalid');
      if (token.refresh_token !== undefined && (typeof token.refresh_token !== 'string' || !token.refresh_token || token.refresh_token.length > 256000 || /[\u0000-\u001f\u007f]/.test(token.refresh_token))) throw new Error('OAuth refresh credential is invalid');
      const stored: StoredMcpToken = { accessToken: token.access_token, tokenType: 'Bearer', binding: { resource: deployment.resource, clientId, tokenUrl: deployment.tokenUrl, ...(deployment.issuer ? { issuer: deployment.issuer } : {}) }, ...(typeof token.expires_in === 'number' ? { expiresAt: Date.now() + token.expires_in * 1000 } : {}), ...(typeof token.refresh_token === 'string' ? { refreshToken: token.refresh_token } : {}) };
      controller.signal.throwIfAborted();
      await storeMcpCredential(name, stored, config);
    });
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); listener?.closeAllConnections(); listener?.close(); }
}
