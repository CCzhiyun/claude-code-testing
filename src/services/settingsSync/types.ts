export interface SettingsSyncRecord { version: 1; revision: number; updatedAt: string; settings: Record<string, unknown> }
export interface SettingsConflict { path: string; local: unknown; remote: unknown }
