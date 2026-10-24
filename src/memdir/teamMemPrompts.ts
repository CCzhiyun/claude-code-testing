import type { MemoryEntry } from './memoryTypes.js';
export function teamMemoryPrompt(memories: MemoryEntry[], maxChars = 20_000): string { return memories.map((memory) => `## ${memory.title}\n${memory.content}`).join('\n\n').slice(0, maxChars); }
