import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseMarkdownDocument, stringList } from '../frontmatter.js';
import type { MemoryEntry } from './memoryTypes.js';
export async function scanMemories(directory: string, scope: string): Promise<MemoryEntry[]> {
  let files: string[]; try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const output: MemoryEntry[] = [];
  for (const file of files.filter((name) => name.endsWith('.md'))) { const path = join(directory, file); const document = parseMarkdownDocument(await readFile(path, 'utf8')); const id = basename(file, '.md'); const updatedAt = String(document.attributes.updatedAt ?? new Date(0).toISOString()); output.push({ id, scope, title: String(document.attributes.title ?? id), content: document.body, createdAt: String(document.attributes.createdAt ?? updatedAt), updatedAt, tags: stringList(document.attributes.tags) ?? [] }); }
  return output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
