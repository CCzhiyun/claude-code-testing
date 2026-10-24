import type { ModelMessage } from '../../types.js';
import type { MemoryEntry } from '../../memdir/memoryTypes.js';
import { messageText } from '../SessionMemory/sessionMemoryUtils.js';
export function extractMemories(messages: ModelMessage[], scope = 'project'): MemoryEntry[] { const now = new Date().toISOString(); const candidates = messages.flatMap((message) => messageText(message).split(/\r?\n/)).map((line) => line.trim()).filter((line) => /^(?:remember|decision|constraint|记住|决定|约束)\s*[:：]/i.test(line)); return [...new Set(candidates)].slice(-20).map((content, index) => ({ id: `extracted-${Date.now().toString(36)}-${index}`, scope, title: content.split(/[:：]/, 1)[0]!.slice(0, 80), content, createdAt: now, updatedAt: now, tags: ['extracted'] })); }
