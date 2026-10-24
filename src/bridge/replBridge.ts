import { ReplBridgeHandle } from './replBridgeHandle.js';
import type { ReplBridgeTransport } from './replBridgeTransport.js';

export function startReplBridge(sessionId: string, transport: ReplBridgeTransport): ReplBridgeHandle {
  if (!sessionId) throw new Error('A session ID is required to start the REPL bridge');
  const handle = new ReplBridgeHandle(sessionId, transport);
  transport.connect();
  return handle;
}
