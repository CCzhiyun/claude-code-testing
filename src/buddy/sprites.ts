import type { CompanionMood, SpriteFrame } from './types.js';
export const COMPANION_SPRITES: Record<CompanionMood, SpriteFrame[]> = {
  idle: [{ lines: [' /\\_/\\', '( o.o )', ' > ^ <'], durationMs: 1_000 }],
  working: [{ lines: [' /\\_/\\', '( -.- )', ' /|_|\\'], durationMs: 500 }],
  celebrating: [{ lines: [' \\(^o^)/', '  /|\\', '  / \\'], durationMs: 700 }],
  concerned: [{ lines: [' /\\_/\\', '( o_o )', ' > ! <'], durationMs: 800 }],
  sleeping: [{ lines: [' /\\_/\\  zZ', '( -.- )', ' > ^ <'], durationMs: 1_500 }],
};
