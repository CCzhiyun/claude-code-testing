import type { ModelMessage } from '../types.js';
import { SessionsWebSocket, type SessionsWebSocketOptions } from '../remote/SessionsWebSocket.js';
import type { SessionInfo, SessionState } from './types.js';

export interface PermissionControlRequest {
  type: 'permission_request';
  requestId: string;
  tool: string;
  input: Record<string, unknown>;
  expiresAt?: string;
}

export class DirectConnectManager {
  private transport?: SessionsWebSocket;
  private sessionState: SessionState = 'starting';

  constructor(
    readonly session: SessionInfo,
    private readonly options: SessionsWebSocketOptions & {
      onSdkMessage?: (message: ModelMessage) => void | Promise<void>;
      onPermissionRequest?: (request: PermissionControlRequest) => void | Promise<void>;
    } = {},
  ) {}

  get state(): SessionState { return this.sessionState; }

  connect(): void {
    this.transport = new SessionsWebSocket(this.session.wsUrl, {
      ...this.options,
      onStateChange: (state) => {
        this.sessionState = state === 'open' ? 'running' : state === 'closed' ? 'detached' : 'starting';
        this.options.onStateChange?.(state);
      },
      onMessage: async (value) => {
        const message = value as Record<string, unknown>;
        if (message.type === 'sdk_message' && message.message && typeof message.message === 'object') await this.options.onSdkMessage?.(message.message as ModelMessage);
        else if (isPermissionRequest(message)) await this.options.onPermissionRequest?.(message);
        await this.options.onMessage?.(value);
      },
    });
    this.transport.connect();
  }

  sendMessage(message: ModelMessage): void { this.transport?.send({ type: 'sdk_message', message }); }
  respondToPermission(requestId: string, decision: 'allow' | 'deny', reason?: string): void {
    this.transport?.send({ type: 'permission_response', requestId, decision, ...(reason ? { reason } : {}) });
  }
  interrupt(): void { this.transport?.send({ type: 'interrupt' }); }
  disconnect(): void { this.transport?.close(); this.sessionState = 'stopped'; }
}

function isPermissionRequest(value: Record<string, unknown>): value is PermissionControlRequest & Record<string, unknown> {
  return value.type === 'permission_request' && typeof value.requestId === 'string' && typeof value.tool === 'string' && !!value.input && typeof value.input === 'object';
}
