import type { PlatformConfig } from '../types.js';
import { createDirectConnectSession } from '../server/createDirectConnectSession.js';
import type { DirectConnectCreateOptions, SessionInfo } from '../server/types.js';

export function createBridgeSession(baseUrl: string, token: string, options: DirectConnectCreateOptions, network: PlatformConfig['network']): Promise<SessionInfo> {
  return createDirectConnectSession({ baseUrl, token }, options, network);
}
