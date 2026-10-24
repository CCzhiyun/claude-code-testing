import type { BridgeStatus } from './bridgeStatusUtil.js';

export function formatBridgeStatus(status: BridgeStatus): string {
  const symbol = status.healthy ? 'connected' : status.stale ? 'stale' : status.state;
  return `Remote bridge: ${symbol} — ${status.detail}`;
}
