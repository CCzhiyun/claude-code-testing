import type { PlatformConfig } from '../../types.js'; import { ApiClient } from './client.js';
export interface SessionIngressRegistration { sessionId: string; websocketUrl: string; expiresAt?: string }
export const registerSessionIngress = (baseUrl: string, token: string, network: PlatformConfig['network'], cwd: string): Promise<SessionIngressRegistration> => new ApiClient(baseUrl, network, token).json('/v1/session-ingress', { method: 'POST', body: { cwd } });
