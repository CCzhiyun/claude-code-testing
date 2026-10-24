import { DEFAULT_POLL_CONFIG } from './pollConfigDefaults.js';

export interface PollConfig {
  pollIntervalMs: number;
  requestTimeoutMs: number;
  livenessTimeoutMs: number;
  maxBatchSize: number;
}

export function resolvePollConfig(value: Partial<PollConfig> = {}): PollConfig {
  const config = { ...DEFAULT_POLL_CONFIG, ...value };
  if (!Number.isInteger(config.pollIntervalMs) || config.pollIntervalMs < 100) throw new Error('pollIntervalMs must be at least 100');
  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1_000) throw new Error('requestTimeoutMs must be at least 1000');
  if (!Number.isInteger(config.livenessTimeoutMs) || config.livenessTimeoutMs <= config.requestTimeoutMs) throw new Error('livenessTimeoutMs must exceed requestTimeoutMs');
  if (!Number.isInteger(config.maxBatchSize) || config.maxBatchSize < 1 || config.maxBatchSize > 1_000) throw new Error('maxBatchSize must be between 1 and 1000');
  return config;
}
