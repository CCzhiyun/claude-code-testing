import type { DirectConnectManager, PermissionControlRequest } from '../server/directConnectManager.js';
import { RemotePermissionBridge } from '../remote/remotePermissionBridge.js';

export function createBridgePermissionCallbacks(sessionId: string, manager: DirectConnectManager, permissions: RemotePermissionBridge) {
  return {
    async onRequest(request: PermissionControlRequest): Promise<void> {
      await permissions.receive({ requestId: request.requestId, sessionId, tool: request.tool, input: request.input, createdAt: new Date().toISOString(), expiresAt: request.expiresAt ?? new Date(Date.now() + 300_000).toISOString() });
    },
    async respond(requestId: string, decision: 'allow' | 'deny', reason?: string): Promise<void> {
      await permissions.resolve(requestId, decision);
      manager.respondToPermission(requestId, decision, reason);
    },
  };
}
