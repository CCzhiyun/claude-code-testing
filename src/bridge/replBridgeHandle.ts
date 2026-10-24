import type { BridgeState } from './types.js';
import type { ReplBridgeTransport } from './replBridgeTransport.js';

export class ReplBridgeHandle {
  private currentState: BridgeState = 'starting';
  constructor(readonly sessionId: string, private readonly transport: ReplBridgeTransport) {}
  get state(): BridgeState { return this.currentState; }
  markConnected(): void { this.currentState = 'connected'; }
  markFailed(): void { this.currentState = 'failed'; }
  send(payload: Record<string, unknown>): void {
    if (this.currentState !== 'connected') throw new Error('REPL bridge is not connected');
    this.transport.send(payload);
  }
  stop(): void { this.transport.close(); this.currentState = 'stopped'; }
}
