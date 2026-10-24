import type { PlatformConfig } from '../../types.js';
export function configureAutoMode(config: PlatformConfig, enabled: boolean): PlatformConfig { const next = structuredClone(config); next.coordinatorMode = enabled; return next; }
