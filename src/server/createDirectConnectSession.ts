import type { PlatformConfig } from '../types.js';
import { networkJson } from '../network.js';
import { audit } from '../audit.js';
import type { DirectConnectCreateOptions, ServerConfig, SessionInfo } from './types.js';

interface CreateResponse { session_id?: unknown; ws_url?: unknown; work_dir?: unknown }

export async function createDirectConnectSession(
  server: ServerConfig,
  options: DirectConnectCreateOptions,
  network: PlatformConfig['network'],
): Promise<SessionInfo> {
  const endpoint = new URL('/sessions', server.baseUrl).href;
  const body = JSON.stringify({
    cwd: options.cwd,
    ...(options.bypassPermissions ? { bypass_permissions: true } : {}),
    ...(options.resumeSessionId ? { resume_session_id: options.resumeSessionId } : {}),
  });
  try {
    const response = await networkJson<CreateResponse>(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body,
    }, network);
    if (response.status < 200 || response.status >= 300) throw new Error(`server returned HTTP ${response.status}`);
    if (typeof response.value.session_id !== 'string' || !response.value.session_id) throw new Error('response is missing session_id');
    if (typeof response.value.ws_url !== 'string') throw new Error('response is missing ws_url');
    const ws = new URL(response.value.ws_url);
    if (!['ws:', 'wss:'].includes(ws.protocol)) throw new Error('ws_url must use ws or wss');
    const info: SessionInfo = {
      sessionId: response.value.session_id,
      wsUrl: ws.href,
      ...(typeof response.value.work_dir === 'string' ? { workDir: response.value.work_dir } : {}),
      state: 'starting',
      createdAt: new Date().toISOString(),
    };
    await audit({ event: 'DirectConnectSessionCreate', outcome: 'success', sessionId: info.sessionId, details: { server: new URL(server.baseUrl).origin } });
    return info;
  } catch (error) {
    await audit({ event: 'DirectConnectSessionCreate', outcome: 'failure', details: { server: new URL(server.baseUrl).origin, error: String(error) } });
    throw new Error(`Unable to create Direct Connect session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
