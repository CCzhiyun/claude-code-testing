import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
import { startUpstreamProxyRelay, type UpstreamProxyRelay } from './relay.js';

export interface UpstreamProxyState { enabled: boolean; port?: number; relay?: UpstreamProxyRelay }
let state: UpstreamProxyState = { enabled: false };
const truthy = (value: string | undefined) => value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

export async function initUpstreamProxy(options: { wsUrl?: string; sessionId?: string; tokenPath?: string } = {}): Promise<UpstreamProxyState> {
  if (!truthy(process.env.CCPT_REMOTE_ENABLED) || !truthy(process.env.CCPT_UPSTREAM_PROXY_ENABLED)) return state;
  const sessionId = options.sessionId ?? process.env.CCPT_REMOTE_SESSION_ID;
  const wsUrl = options.wsUrl ?? process.env.CCPT_UPSTREAM_PROXY_WS_URL;
  if (!sessionId || !wsUrl) return state;
  const tokenPath = options.tokenPath ?? join(homeStateDir(), 'remote-session-token');
  let token: string;
  try { token = (await readFile(tokenPath, 'utf8')).trim(); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return state; throw error; }
  if (!token) return state;
  const relay = await startUpstreamProxyRelay({ wsUrl, sessionId, token });
  await unlink(tokenPath).catch(() => undefined);
  state = { enabled: true, port: relay.port, relay };
  return state;
}

export function getUpstreamProxyEnv(): Record<string, string> {
  if (!state.enabled || !state.port) return {};
  const url = `http://127.0.0.1:${state.port}`;
  return { HTTPS_PROXY: url, https_proxy: url, NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1' };
}

export async function stopUpstreamProxy(): Promise<void> { await state.relay?.stop(); state = { enabled: false }; }
export function resetUpstreamProxyForTests(): void { state = { enabled: false }; }
