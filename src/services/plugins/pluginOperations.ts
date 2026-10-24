import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadPluginAt, validatePlugin } from '../../plugins.js';
import { loadConfig } from '../../config.js';
import { installTrustedPlugin, installedPluginPath, removeInstalledPlugin, replaceInstalledPlugin, safePluginStatePath } from '../../pluginHistory.js';
import { protectPath } from '../../policy.js';
import { readJson, withFileLock, writeJson } from '../../storage.js';

export const VALID_INSTALLABLE_SCOPES = ['project', 'local'] as const;
export type InstallableScope = typeof VALID_INSTALLABLE_SCOPES[number];
export const VALID_UPDATE_SCOPES = VALID_INSTALLABLE_SCOPES;
export type PluginOperationResult = { success: boolean; pluginId: string; scope: InstallableScope; message: string; path?: string };
export type PluginUpdateResult = PluginOperationResult & { previousVersion?: string; version?: string };
type Registry = { enabled: Record<string, boolean> };

export function isInstallableScope(value: string): value is InstallableScope { return VALID_INSTALLABLE_SCOPES.includes(value as InstallableScope); }
export function assertInstallableScope(value: string): asserts value is InstallableScope { if (!isInstallableScope(value)) throw new Error(`Invalid plugin scope: ${value}`); }
export function getProjectPathForScope(scope: InstallableScope, cwd = process.cwd()): string { assertInstallableScope(scope); return resolve(cwd); }
const directoryFor = (scope: InstallableScope, cwd = process.cwd()): string => join(resolve(cwd), '.ccpt', scope === 'local' ? 'plugins-local' : 'plugins');
async function saveRegistry(scope: InstallableScope, value: Registry, cwd = process.cwd()): Promise<void> {
  assertInstallableScope(scope); const config = await loadConfig(cwd), path = join(resolve(cwd), '.ccpt', 'settings.json');
  protectPath(path, config); await safePluginStatePath(cwd, path); if (config.policy.mode === 'restricted') throw new Error('Plugin mutations are disabled in restricted mode');
  await withFileLock(`${path}.lock`, async () => {
    const settings = await readJson<Record<string, unknown>>(path, {});
    const disabled = new Set(Array.isArray(settings.disabledPlugins) ? settings.disabledPlugins.filter((name): name is string => typeof name === 'string') : []);
    for (const [name, enabled] of Object.entries(value.enabled)) { installedPluginPath(cwd, name, scope); if (enabled) disabled.delete(name); else disabled.add(name); }
    await writeJson(path, { ...settings, disabledPlugins: [...disabled].sort() });
  });
}

export async function isPluginEnabledAtProjectScope(pluginId: string, cwd = process.cwd()): Promise<boolean> { installedPluginPath(cwd, pluginId); return !(await loadConfig(cwd)).disabledPlugins.includes(pluginId); }
export async function getPluginInstallationFromV2(pluginId: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<{ path: string; version: string; enabled: boolean } | null> { const path = installedPluginPath(cwd, pluginId, scope); await safePluginStatePath(cwd, path); try { const plugin = await loadPluginAt(path); return { path, version: plugin.version, enabled: await isPluginEnabledAtProjectScope(pluginId, cwd) }; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
export async function installPluginOp(source: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<PluginOperationResult> { assertInstallableScope(scope); const checked = await validatePlugin(source); if (!checked.ok || !checked.plugin) return { success: false, pluginId: basename(source), scope, message: checked.diagnostics.map(item => item.message).join('; ') }; const path = await installTrustedPlugin(cwd, source, scope); return { success: true, pluginId: checked.plugin.name, scope, message: `Installed ${checked.plugin.name}`, path }; }
export async function uninstallPluginOp(pluginId: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<PluginOperationResult> { await removeInstalledPlugin(cwd, pluginId, scope); return { success: true, pluginId, scope, message: `Uninstalled ${pluginId}; previous content retained in history` }; }
export async function setPluginEnabledOp(pluginId: string, enabled: boolean, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<PluginOperationResult> { if (!await getPluginInstallationFromV2(pluginId, scope, cwd)) throw new Error(`Plugin is not installed: ${pluginId}`); await saveRegistry(scope, { enabled: { [pluginId]: enabled } }, cwd); const applied = await isPluginEnabledAtProjectScope(pluginId, cwd); return { success: applied === enabled, pluginId, scope, message: applied === enabled ? `${enabled ? 'Enabled' : 'Disabled'} ${pluginId}` : 'Managed or session policy overrides this plugin activation request' }; }
export const enablePluginOp = (pluginId: string, scope: InstallableScope = 'project', cwd = process.cwd()) => setPluginEnabledOp(pluginId, true, scope, cwd);
export const disablePluginOp = (pluginId: string, scope: InstallableScope = 'project', cwd = process.cwd()) => setPluginEnabledOp(pluginId, false, scope, cwd);
export async function disableAllPluginsOp(scope: InstallableScope = 'project', cwd = process.cwd()): Promise<PluginOperationResult> { assertInstallableScope(scope); const directory = directoryFor(scope, cwd); await safePluginStatePath(cwd, directory); const state: Registry = { enabled: {} }; try { for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith('.')) { const plugin = await getPluginInstallationFromV2(entry.name, scope, cwd); if (plugin) state.enabled[entry.name] = false; } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } await saveRegistry(scope, state, cwd); const config = await loadConfig(cwd); return { success: Object.keys(state.enabled).every(name => config.disabledPlugins.includes(name)), pluginId: '*', scope, message: 'Requested disabling installed plugins; managed policy takes precedence' }; }
export async function updatePluginOp(pluginId: string, source: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<PluginUpdateResult> { const result = await replaceInstalledPlugin(cwd, pluginId, scope, source); return { success: true, pluginId, scope, message: `Updated ${pluginId}; previous content retained in history`, path: result.path, previousVersion: result.previous.version, version: result.version }; }
