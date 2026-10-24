export interface SecretFinding { type: string; start: number; end: number; preview: string; confidence: 'high' | 'medium' }
export interface TeamMemoryChange { path: string; content: string; revision: number; author: string; updatedAt: string }
