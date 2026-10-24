import { disableAllPluginsOp, disablePluginOp, enablePluginOp, installPluginOp, uninstallPluginOp, updatePluginOp, VALID_INSTALLABLE_SCOPES, VALID_UPDATE_SCOPES, type InstallableScope } from './pluginOperations.js';
export { VALID_INSTALLABLE_SCOPES, VALID_UPDATE_SCOPES };
export async function installPlugin(source: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<void> { const result = await installPluginOp(source, scope, cwd); if (!result.success) throw new Error(result.message); }
export async function uninstallPlugin(id: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<void> { await uninstallPluginOp(id, scope, cwd); }
export async function enablePlugin(id: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<void> { await enablePluginOp(id, scope, cwd); }
export async function disablePlugin(id: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<void> { await disablePluginOp(id, scope, cwd); }
export async function disableAllPlugins(scope: InstallableScope = 'project', cwd = process.cwd()): Promise<void> { await disableAllPluginsOp(scope, cwd); }
export async function updatePluginCli(id: string, source: string, scope: InstallableScope = 'project', cwd = process.cwd()): Promise<void> { await updatePluginOp(id, source, scope, cwd); }
