import { homedir } from 'node:os';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export function homeStateDir(): string {
  return process.env.CCPT_HOME
    ? resolve(process.env.CCPT_HOME)
    : join(homedir(), '.ccpt');
}

export function projectStateDir(cwd = process.cwd()): string {
  return join(resolve(cwd), '.ccpt');
}

export function assertWithinRoots(candidate: string, roots: string[]): string {
  const absolute = canonicalPath(candidate);
  const allowed = roots.some((root) => {
    const normalizedRoot = canonicalPath(root);
    return absolute === normalizedRoot || absolute.startsWith(`${normalizedRoot}${sep}`);
  });
  if (!allowed) throw new Error(`Path is outside permitted workspace roots: ${absolute}`);
  return absolute;
}

function canonicalPath(value: string): string {
  const absolute = resolve(value);
  if (existsSync(absolute)) return realpathSync.native(absolute);
  const missing: string[] = [];
  let parent = absolute;
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) return absolute;
    missing.unshift(absolute.slice(next.length + (next.endsWith(sep) ? 0 : 1), parent.length) || parent.slice(next.length + 1));
    parent = next;
  }
  const realParent = realpathSync.native(parent);
  return resolve(realParent, ...missing);
}

export function resolveWorkspacePath(cwd: string, value: string, roots: string[]): string {
  return assertWithinRoots(isAbsolute(value) ? value : resolve(cwd, value), roots);
}
