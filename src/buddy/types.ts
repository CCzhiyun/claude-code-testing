export type CompanionMood = 'idle' | 'working' | 'celebrating' | 'concerned' | 'sleeping';
export interface CompanionState { mood: CompanionMood; message?: string; updatedAt: string }
export interface SpriteFrame { lines: string[]; durationMs: number }
