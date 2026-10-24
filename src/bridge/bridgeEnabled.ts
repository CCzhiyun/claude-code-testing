import type { PlatformConfig } from '../types.js';

export function isBridgeEnabled(config: PlatformConfig, environment = process.env): boolean {
  const explicit = environment.CCPT_REMOTE_ENABLED;
  if (explicit !== undefined) return ['1', 'true', 'yes', 'on'].includes(explicit.toLowerCase());
  return config.remote.enabled;
}
