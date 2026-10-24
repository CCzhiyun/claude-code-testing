import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
export interface IndexedFile { path: string; size: number; modifiedMs: number }
export async function buildFileIndex(root: string, options: { maxFiles?: number; ignore?: (path: string) => boolean } = {}): Promise<IndexedFile[]> {
  const output: IndexedFile[] = []; const limit = options.maxFiles ?? 100_000;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name); const path = relative(root, absolute).replaceAll('\\', '/');
      if (options.ignore?.(path)) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) { const info = await stat(absolute); output.push({ path, size: info.size, modifiedMs: info.mtimeMs }); if (output.length > limit) throw new Error(`File index exceeds ${limit} entries`); }
    }
  }
  await walk(root); return output.sort((a, b) => a.path.localeCompare(b.path));
}
