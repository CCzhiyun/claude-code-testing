import { COMPANION_SPRITES } from './sprites.js';
import type { CompanionMood } from './types.js';
export function renderCompanionSprite(mood: CompanionMood, frame = 0): string { const frames = COMPANION_SPRITES[mood]; return frames[frame % frames.length]!.lines.join('\n'); }
