import type { BridgeSessionPointer, BridgeState } from './types.js';

export interface BridgeStatus { state: BridgeState; healthy: boolean; stale: boolean; detail: string }

export function bridgeStatus(pointer: BridgeSessionPointer | undefined, now = Date.now(), livenessTimeoutMs = 90_000): BridgeStatus {
  if (!pointer) return { state: 'disabled', healthy: false, stale: false, detail: 'No bridge session is configured.' };
  const lastSeen = pointer.lastSeenAt ? Date.parse(pointer.lastSeenAt) : Date.parse(pointer.updatedAt);
  const stale = !Number.isFinite(lastSeen) || now - lastSeen > livenessTimeoutMs;
  if (pointer.state === 'connected' && stale) return { state: 'degraded', healthy: false, stale: true, detail: 'Bridge heartbeat is stale.' };
  const healthy = pointer.state === 'connected' && !stale;
  return { state: pointer.state, healthy, stale, detail: pointer.lastError ?? (healthy ? 'Bridge is connected.' : `Bridge is ${pointer.state}.`) };
}
