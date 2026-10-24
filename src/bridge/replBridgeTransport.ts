import { SessionsWebSocket, type SessionsWebSocketOptions } from '../remote/SessionsWebSocket.js';
import type { BridgeEvent } from './types.js';

export interface ReplBridgeTransport {
  connect(): void;
  send(event: BridgeEvent | Record<string, unknown>): void;
  close(): void;
}

export class WebSocketReplBridgeTransport implements ReplBridgeTransport {
  private readonly socket: SessionsWebSocket;
  constructor(url: string, options: SessionsWebSocketOptions) { this.socket = new SessionsWebSocket(url, options); }
  connect(): void { this.socket.connect(); }
  send(event: BridgeEvent | Record<string, unknown>): void { this.socket.send(event); }
  close(): void { this.socket.close(); }
}
