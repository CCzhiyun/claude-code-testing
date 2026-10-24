import type { PlatformConfig } from '../types.js';
import { networkJson } from '../network.js';

export interface CodeSession { id: string; state: string; createdAt?: string }

export async function getCodeSession(baseUrl: string, token: string, sessionId: string, network: PlatformConfig['network']): Promise<CodeSession> {
  const response = await networkJson<Record<string, unknown>>(new URL(`/v2/sessions/${encodeURIComponent(sessionId)}`, baseUrl).href, { headers: { authorization: `Bearer ${token}` } }, network);
  if (response.status !== 200 || typeof response.value.id !== 'string' || typeof response.value.state !== 'string') throw new Error(`Unable to load code session (${response.status})`);
  return { id: response.value.id, state: response.value.state, ...(typeof response.value.created_at === 'string' ? { createdAt: response.value.created_at } : {}) };
}
