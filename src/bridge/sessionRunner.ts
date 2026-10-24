import type { ModelMessage } from '../types.js';
import { DirectConnectManager } from '../server/directConnectManager.js';
import type { SessionInfo } from '../server/types.js';
import type { SessionsWebSocketOptions } from '../remote/SessionsWebSocket.js';

export function runBridgeSession(session: SessionInfo, onMessage: (message: ModelMessage) => void | Promise<void>, options: SessionsWebSocketOptions = {}): DirectConnectManager {
  const manager = new DirectConnectManager(session, { ...options, onSdkMessage: onMessage });
  manager.connect();
  return manager;
}
