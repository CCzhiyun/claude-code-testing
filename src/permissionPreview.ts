import { readFile, stat } from 'node:fs/promises';
import { resolveWorkspacePath } from './paths.js';
import { protectPath } from './policy.js';
import type { PlatformConfig } from './types.js';

/** Bounded replacement hunk, deliberately not an O(n*m) diff of arbitrary repository files. */
export function replacementPreview(before: string, after: string): string {
  if (before === after) return '(No content change)';
  const oldLines = before.split('\n'), newLines = after.split('\n');
  let start = 0, suffix = 0;
  while (start < Math.min(oldLines.length, newLines.length) && oldLines[start] === newLines[start]) start++;
  while (suffix < Math.min(oldLines.length, newLines.length) - start && oldLines.at(-1 - suffix) === newLines.at(-1 - suffix)) suffix++;
  const oldChanged = oldLines.slice(start, oldLines.length - suffix), newChanged = newLines.slice(start, newLines.length - suffix);
  const limited = (lines: string[], prefix: string) => [...lines.slice(0, 60).map((line) => `${prefix}${line.slice(0, 500)}`), ...(lines.length > 60 ? [`… ${lines.length - 60} more ${prefix === '-' ? 'removed' : 'added'} lines omitted`] : [])];
  return [`@@ replacement at line ${start + 1}: -${oldChanged.length} +${newChanged.length} @@`, ...limited(oldChanged, '-'), ...limited(newChanged, '+'), 'Preview only; long lines are limited to 500 characters.'].join('\n');
}

export async function buildPermissionPreview(tool: string, input: Record<string, unknown>, cwd: string, config: PlatformConfig): Promise<string> {
  if (tool !== 'write_file') return `Arguments (JSON, up to 8000 characters):\n${JSON.stringify(input, null, 2).slice(0, 8000)}`;
  if (typeof input.path !== 'string' || typeof input.content !== 'string') return 'Preview unavailable: invalid write_file input.';
  // All reads obey exactly the same path policy as the tool; do not expose protected content to the dialog.
  const path = protectPath(resolveWorkspacePath(cwd, input.path, config.policy.workspaceRoots), config);
  let before = '';
  let exists = true;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 256_000) return 'Preview omitted: existing target is not a regular text file under 256 KB.';
    before = await readFile(path, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
  if (before.includes('\0') || input.content.includes('\0')) return 'Preview omitted: binary content.';
  if (input.content.length > 256_000) return 'Preview omitted: proposed content exceeds 256 KB.';
  return `${exists ? 'Replace' : 'Create'} ${input.path}\n${replacementPreview(before, input.content)}`;
}
