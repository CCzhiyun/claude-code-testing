import { recencyScore } from './memoryAge.js';
import type { MemoryEntry, ScoredMemory } from './memoryTypes.js';
const words = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
export function findRelevantMemories(memories: MemoryEntry[], query: string, limit = 8): ScoredMemory[] {
  const queryWords = words(query); if (!queryWords.size) return [];
  return memories.map((memory) => { const haystack = words(`${memory.title} ${memory.tags.join(' ')} ${memory.content}`); const matching = [...queryWords].filter((word) => haystack.has(word)); const lexical = matching.length / queryWords.size; const recent = recencyScore(memory.updatedAt); return { memory, score: lexical * 0.85 + recent * 0.15, reasons: matching.slice(0, 10) }; }).filter((item) => item.reasons.length > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit));
}
