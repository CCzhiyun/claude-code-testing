export type SettingConfig = { path: string[]; type: 'boolean' | 'string' | 'number'; options?: string[]; min?: number; max?: number };
export const SUPPORTED_SETTINGS: Record<string, SettingConfig> = { model: { path: ['model', 'name'], type: 'string' }, maxOutputTokens: { path: ['model', 'maxOutputTokens'], type: 'number', min: 256, max: 200_000 }, vimMode: { path: ['vimMode'], type: 'boolean' }, coordinatorMode: { path: ['coordinatorMode'], type: 'boolean' } };
export function isSupported(key: string): boolean { return key in SUPPORTED_SETTINGS; }
export function getConfig(key: string): SettingConfig | undefined { return SUPPORTED_SETTINGS[key]; }
export function getAllKeys(): string[] { return Object.keys(SUPPORTED_SETTINGS); }
export function getOptionsForSetting(key: string): string[] | undefined { return SUPPORTED_SETTINGS[key]?.options; }
export function getPath(key: string): string[] { const config = getConfig(key); if (!config) throw new Error(`Unsupported setting: ${key}`); return [...config.path]; }
