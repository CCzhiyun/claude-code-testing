export interface MemoryEntry { id: string; scope: string; title: string; content: string; createdAt: string; updatedAt: string; tags: string[] }
export interface ScoredMemory { memory: MemoryEntry; score: number; reasons: string[] }
