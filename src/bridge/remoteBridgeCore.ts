import { InboundMessageValidator, type InboundBridgeMessage } from './inboundMessages.js';
import { BridgeMessageQueue } from './bridgeMessaging.js';
import type { BridgeEvent } from './types.js';

export interface RemoteBridgeCoreHandlers {
  onUserMessage?: (payload: Record<string, unknown>) => void | Promise<void>;
  onInterrupt?: () => void | Promise<void>;
  onPermissionResponse?: (payload: Record<string, unknown>) => void | Promise<void>;
}

export class RemoteBridgeCore {
  readonly outbound: BridgeMessageQueue;
  private readonly inbound: InboundMessageValidator;

  constructor(readonly sessionId: string, private readonly handlers: RemoteBridgeCoreHandlers = {}, maxInboundBytes?: number) {
    this.outbound = new BridgeMessageQueue(sessionId);
    this.inbound = new InboundMessageValidator(maxInboundBytes);
  }

  emit(kind: 'sdk_message' | 'permission_request' | 'permission_response' | 'interrupt' | 'status', payload: Record<string, unknown>): BridgeEvent {
    return this.outbound.enqueue(kind, payload);
  }

  async receive(value: unknown): Promise<InboundBridgeMessage> {
    const message = this.inbound.validate(value, this.sessionId);
    if (message.kind === 'user_message') await this.handlers.onUserMessage?.(message.payload);
    else if (message.kind === 'interrupt') await this.handlers.onInterrupt?.();
    else await this.handlers.onPermissionResponse?.(message.payload);
    return message;
  }
}
