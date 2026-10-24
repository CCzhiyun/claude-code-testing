// Historical fixtures in these tests emit Chat Completions. Keep their wire
// contract explicit; Responses-first defaults are verified in responses-migration.
import { defaultConfig as runtimeDefault } from '../src/config.js';
import type { PlatformConfig } from '../src/types.js';
export * from '../src/config.js';
export const defaultConfig: PlatformConfig = { ...runtimeDefault, model: { ...runtimeDefault.model, provider: 'compatible' } };
