import { randomUUID } from 'node:crypto';
import type { MemoryEntry } from '../../memdir/memoryTypes.js';
import { saveProjectMemory } from '../../memdir/memdir.js';
export class DreamTask { constructor(private readonly cwd: string) {} async saveReflection(title: string, content: string, tags: string[] = []): Promise<MemoryEntry> { if (!content.trim()) throw new Error('Dream reflection cannot be empty'); const now = new Date().toISOString(); const memory: MemoryEntry = { id: `dream-${randomUUID().slice(0, 8)}`, scope: 'project', title: title.trim().slice(0, 160), content: content.trim(), createdAt: now, updatedAt: now, tags: [...new Set(tags)].slice(0, 20) }; await saveProjectMemory(this.cwd, memory); return memory; } }
