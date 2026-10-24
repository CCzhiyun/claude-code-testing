import { mkdir, writeFile } from 'node:fs/promises';
import { memoryFilePath, projectMemoryDirectory } from './paths.js';
import { scanMemories } from './memoryScan.js';
import type { MemoryEntry } from './memoryTypes.js';
export async function saveProjectMemory(cwd: string, memory: MemoryEntry): Promise<string> { const directory = projectMemoryDirectory(cwd); await mkdir(directory, { recursive: true }); const path = memoryFilePath(directory, memory.id); const frontmatter = `---\ntitle: ${JSON.stringify(memory.title)}\ncreatedAt: ${JSON.stringify(memory.createdAt)}\nupdatedAt: ${JSON.stringify(memory.updatedAt)}\ntags: ${JSON.stringify(memory.tags)}\n---\n`; await writeFile(path, `${frontmatter}${memory.content.trim()}\n`, { mode: 0o600 }); return path; }
export const loadProjectMemories = (cwd: string) => scanMemories(projectMemoryDirectory(cwd), 'project');
