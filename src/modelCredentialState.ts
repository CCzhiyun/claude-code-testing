import type { PlatformConfig } from './types.js';
// Secrets never become enumerable model/config properties or process.env values.
const keys = new WeakMap<PlatformConfig['model'], { scope: string; key: string }>();
export function setProtectedModelKey(model: PlatformConfig['model'], scope: string, key: string): void { keys.set(model, { scope, key }); }
export function protectedModelKey(model: PlatformConfig['model'], scope: string): string | undefined { const value = keys.get(model); return value?.scope === scope ? value.key : undefined; }
