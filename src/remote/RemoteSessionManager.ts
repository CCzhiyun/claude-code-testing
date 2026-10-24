import type { ModelMessage } from '../types.js';
import type { SessionInfo } from '../server/types.js';
import { DirectConnectManager, type PermissionControlRequest } from '../server/directConnectManager.js';
import type { SessionsWebSocketOptions } from './SessionsWebSocket.js';
import { adaptRemoteSdkMessage } from './sdkMessageAdapter.js';
import { RemotePermissionBridge } from './remotePermissionBridge.js';

export class RemoteSessionManager {
  readonly permissions = new RemotePermissionBridge();
  private readonly connections = new Map<string, DirectConnectManager>();

  attach(session: SessionInfo, options: SessionsWebSocketOptions & { onMessage?: (message: ModelMessage) => void | Promise<void> } = {}): DirectConnectManager {
    if (this.connections.has(session.sessionId)) throw new Error(`Remote session is already attached: ${session.sessionId}`);
    const manager = new DirectConnectManager(session, {
      ...options,
      onSdkMessage: async (message) => options.onMessage?.(adaptRemoteSdkMessage(message)),
      onPermissionRequest: async (request) => this.receivePermission(session.sessionId, request),
    });
    this.connections.set(session.sessionId, manager);
    manager.connect();
    return manager;
  }

  get(sessionId: string): DirectConnectManager | undefined { return this.connections.get(sessionId); }

  detach(sessionId: string): void {
    this.connections.get(sessionId)?.disconnect();
    this.connections.delete(sessionId);
  }

  private async receivePermission(sessionId: string, request: PermissionControlRequest): Promise<void> {
    await this.permissions.receive({
      requestId: request.requestId,
      sessionId,
      tool: request.tool,
      input: request.input,
      createdAt: new Date().toISOString(),
      expiresAt: request.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }
}
