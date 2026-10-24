import type { PlatformConfig } from '../types.js';
import { resolvePollConfig, type PollConfig } from './pollConfig.js';

export interface BridgeConfig {
  serverUrl: string;
  tokenEnvironment: string;
  reconnectAttempts: number;
  reconnectDelayMs: number;
  pingIntervalMs: number;
  maxAttachmentBytes: number;
  poll: PollConfig;
}

export function resolveBridgeConfig(config: PlatformConfig, overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  const serverUrl = overrides.serverUrl ?? config.remote.serverUrl;
  if (!serverUrl) throw new Error('Remote bridge serverUrl is not configured');
  const url = new URL(serverUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Remote bridge serverUrl must use HTTP(S)');
  return {
    serverUrl: url.href,
    tokenEnvironment: overrides.tokenEnvironment ?? config.remote.authTokenEnv,
    reconnectAttempts: overrides.reconnectAttempts ?? config.remote.reconnectAttempts,
    reconnectDelayMs: overrides.reconnectDelayMs ?? config.remote.reconnectDelayMs,
    pingIntervalMs: overrides.pingIntervalMs ?? config.remote.pingIntervalMs,
    maxAttachmentBytes: overrides.maxAttachmentBytes ?? config.remote.maxAttachmentBytes,
    poll: resolvePollConfig(overrides.poll),
  };
}

export function resolveBridgeCredential(config: BridgeConfig, environment = process.env): string {
  const token = environment[config.tokenEnvironment];
  if (!token) throw new Error(`Remote credential environment variable is not set: ${config.tokenEnvironment}`);
  return token;
}
