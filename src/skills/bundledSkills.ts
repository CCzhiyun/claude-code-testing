import * as bundled from './bundled/index.js';
export interface BundledSkillDefinition { name: string; description: string; instructions: string }
export const BUNDLED_SKILLS: readonly BundledSkillDefinition[] = Object.freeze(Object.values(bundled));
