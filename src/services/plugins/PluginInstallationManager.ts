import { installPluginOp, type InstallableScope, type PluginOperationResult } from './pluginOperations.js';

export type PendingPluginInstallation = { source: string; scope?: InstallableScope; cwd?: string };
export async function performBackgroundPluginInstallations(items: PendingPluginInstallation[], options: { concurrency?: number; onResult?: (result: PluginOperationResult) => void } = {}): Promise<PluginOperationResult[]> {
  const queue = [...items]; const results: PluginOperationResult[] = []; const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, 8)) }, async () => { while (queue.length) { const item = queue.shift(); if (!item) return; const result = await installPluginOp(item.source, item.scope ?? 'project', item.cwd); results.push(result); options.onResult?.(result); } }); await Promise.all(workers); return results;
}
