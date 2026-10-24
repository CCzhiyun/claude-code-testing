import type { PlatformConfig } from '../types.js';
import { createBridgeSession } from './createSession.js';
import { resolveBridgeConfig, resolveBridgeCredential } from './bridgeConfig.js';
import { runBridgeSession } from './sessionRunner.js';
import { writeBridgePointer } from './bridgePointer.js';
import type { ModelMessage } from '../types.js';

export async function startBridge(config: PlatformConfig, cwd: string, onMessage: (message: ModelMessage) => void | Promise<void>) {
  const bridgeConfig = resolveBridgeConfig(config);
  const token = resolveBridgeCredential(bridgeConfig);
  const session = await createBridgeSession(bridgeConfig.serverUrl, token, { cwd }, config.network);
  const now = new Date().toISOString();
  await writeBridgePointer(cwd, { version: 1, sessionId: session.sessionId, state: 'starting', serverOrigin: new URL(bridgeConfig.serverUrl).origin, pid: process.pid, createdAt: now, updatedAt: now });
  return runBridgeSession(session, onMessage, { token, reconnectAttempts: bridgeConfig.reconnectAttempts, reconnectDelayMs: bridgeConfig.reconnectDelayMs, pingIntervalMs: bridgeConfig.pingIntervalMs });
}
