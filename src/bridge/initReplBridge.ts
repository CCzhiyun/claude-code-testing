import { WebSocketReplBridgeTransport, type ReplBridgeTransport } from './replBridgeTransport.js';
import { startReplBridge } from './replBridge.js';
import type { SessionsWebSocketOptions } from '../remote/SessionsWebSocket.js';

export function initReplBridge(sessionId: string, websocketUrl: string, options: SessionsWebSocketOptions = {}, transport?: ReplBridgeTransport) {
  const target = transport ?? new WebSocketReplBridgeTransport(websocketUrl, options);
  return startReplBridge(sessionId, target);
}
