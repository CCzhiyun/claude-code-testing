import { lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homeStateDir, projectStateDir } from './paths.js';
import type { PlatformConfig } from './types.js';

/** Bounded metadata polling survives atomic replacement and never traverses links.
 * Only invalidations are sent, not prompts, settings values or authorization grants. */
export function watchLocalState(paths: readonly string[], onChange: (revision: string) => void | Promise<void>, options: { intervalMs?: number; recursive?: boolean; initial?: boolean; onError?: () => void } = {}): () => void {
  const interval = options.intervalMs ?? 750;
  if (!Number.isSafeInteger(interval) || interval < 100 || interval > 30000 || paths.length > 32) throw new Error('Invalid state watch bounds');
  let stopped = false, previous: string | undefined, timer: NodeJS.Timeout | undefined, errorReported = false;
  const snapshot = async () => {
    const values: string[] = []; let entries = 0;
    const visit = async (path: string, depth: number): Promise<void> => {
      if (++entries > 2048) throw new Error('State watch entry limit');
      let info; try { info = await lstat(path, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { values.push(path + ':missing'); return; } throw error; }
      values.push(`${path}:${info.mtimeNs}:${info.ctimeNs}:${info.size}:${info.isSymbolicLink()}`);
      if (options.recursive && info.isDirectory() && !info.isSymbolicLink() && depth < 4) {
        const names = await readdir(path); if (names.length > 2048 - entries) throw new Error('State watch entry limit');
        for (const name of names.sort()) if (!['node_modules', '.git', '.history'].includes(name)) await visit(join(path, name), depth + 1);
      }
    };
    for (const path of paths) await visit(path, 0);
    return createHash('sha256').update(values.join('\n')).digest('hex');
  };
  const tick = async () => {
    try {
      const revision = await snapshot();
      errorReported = false;
      if (!stopped && revision !== previous) { const first = previous === undefined; previous = revision; if (!first || options.initial) await onChange(revision); }
    } catch { if (!stopped && !errorReported) { errorReported = true; options.onError?.(); } }
    finally { if (!stopped) { timer = setTimeout(tick, interval); timer.unref(); } }
  };
  void tick(); return () => { stopped = true; clearTimeout(timer); };
}
export function projectStateWatchPaths(cwd: string): string[] {
  return [join(projectStateDir(cwd), 'plans/index.json'), join(projectStateDir(cwd), 'goal-runs'), join(projectStateDir(cwd), 'ide-review.json'), join(projectStateDir(cwd), 'notifications.json'), join(homeStateDir(), 'teams'), join(homeStateDir(), 'agents'), join(homeStateDir(), 'tasks')];
}

/** Watch exactly the directories admitted by configuration, not implicit global
 * executable content. Configuration remains the authority for trusted roots. */
export function extensionStateWatchPaths(config: PlatformConfig): string[] {
  const paths = [...new Set([...config.skillsDirectories, ...config.agentsDirectories, ...config.pluginDirectories])];
  if (paths.length > 32) throw new Error('Extension watch supports at most 32 configured roots; use explicit reload');
  return paths;
}

/** User-owned trust changes must invalidate cached extension registries too. */
export function extensionAuthorityWatchPaths(cwd: string): string[] {
  return [join(projectStateDir(cwd), 'settings.json'), join(projectStateDir(cwd), 'plugin-sets/active.json'), join(homeStateDir(), 'settings.json'), join(homeStateDir(), 'extension-trust.json')];
}
