import { readJson, withFileLock, writeJson } from '../storage.js';

export const CURRENT_SETTINGS_VERSION = 3;
type Settings = Record<string, unknown> & { settingsVersion?: number };
type Migration = (settings: Settings) => Settings;

const migrations: Record<number, Migration> = {
  0(settings) {
    const legacyPermissions = settings.permissions && typeof settings.permissions === 'object' ? settings.permissions as Record<string, unknown> : undefined;
    const legacyModel = settings.model && typeof settings.model === 'object' ? settings.model as Record<string, unknown> : undefined;
    const policy = settings.policy && typeof settings.policy === 'object' ? settings.policy as Record<string, unknown> : {};
    return {
      ...settings,
      ...(legacyPermissions?.mode && !policy.mode ? { policy: { ...policy, mode: legacyPermissions.mode } } : {}),
      ...(legacyModel?.url && !legacyModel.baseUrl ? { model: { ...legacyModel, baseUrl: legacyModel.url, url: undefined } } : {}),
      permissions: undefined,
      settingsVersion: 1,
    };
  },
  1(settings) {
    const legacy = settings.mcp && typeof settings.mcp === 'object' ? settings.mcp as Record<string, unknown> : undefined;
    return { ...settings, ...(legacy && !settings.mcpServers ? { mcpServers: legacy } : {}), mcp: undefined, settingsVersion: 2 };
  },
  2(settings) {
    const normalize = (value: unknown): unknown => Array.isArray(value) ? [...new Set(value.map(String))] : value;
    return {
      ...settings,
      skillsDirectories: normalize(settings.skillsDirectories),
      agentsDirectories: normalize(settings.agentsDirectories),
      pluginDirectories: normalize(settings.pluginDirectories),
      disabledPlugins: normalize(settings.disabledPlugins),
      settingsVersion: 3,
    };
  },
};

export function migrateSettings(settings: Settings): { settings: Settings; changed: boolean; from: number; to: number } {
  const from = Number.isInteger(settings.settingsVersion) ? settings.settingsVersion! : 0;
  if (from > CURRENT_SETTINGS_VERSION) return { settings, changed: false, from, to: from };
  let current = structuredClone(settings);
  let version = from;
  while (version < CURRENT_SETTINGS_VERSION) {
    const migration = migrations[version];
    if (!migration) throw new Error(`Missing settings migration ${version} -> ${version + 1}`);
    current = migration(current);
    version += 1;
  }
  return { settings: current, changed: version !== from, from, to: version };
}

export async function migrateSettingsFile(path: string): Promise<{ changed: boolean; from: number; to: number }> {
  return withFileLock(`${path}.migration.lock`, async () => {
    const existing = await readJson<Settings | null>(path, null);
    if (!existing) return { changed: false, from: CURRENT_SETTINGS_VERSION, to: CURRENT_SETTINGS_VERSION };
    const migrated = migrateSettings(existing);
    if (migrated.changed) await writeJson(path, migrated.settings);
    return { changed: migrated.changed, from: migrated.from, to: migrated.to };
  });
}
