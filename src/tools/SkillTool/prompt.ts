import type { Skill } from '../../skills.js';
import type { PlatformConfig } from '../../types.js';
import { modelInvocableSkill, skillCatalog } from '../../skills.js';

export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01, CHARS_PER_TOKEN = 4, DEFAULT_CHAR_BUDGET = 8_000, MAX_LISTING_DESC_CHARS = 250;
export function getCharBudget(tokens = 200_000): number {
  return Math.max(2_000, Math.floor(tokens * SKILL_BUDGET_CONTEXT_PERCENT * CHARS_PER_TOKEN));
}
export function formatCommandsWithinBudget(skills: Skill[], budget = DEFAULT_CHAR_BUDGET): string {
  let output = '';
  for (const skill of skills) {
    const line = `${skillCatalog([{ ...skill, description: skill.description.slice(0, MAX_LISTING_DESC_CHARS) }])}\n`;
    if (!line.trim()) continue;
    if (output.length + line.length > budget) break;
    output += line;
  }
  return output.trim();
}

// Share the UI/Agent registry, including plugin aliases and disabled-skill rules.
export async function getLimitedSkillToolCommands(cwd: string, config: PlatformConfig): Promise<Skill[]> {
  const { loadPlatform } = await import('../../platform.js');
  return (await loadPlatform(cwd, config)).skills.filter(modelInvocableSkill);
}
export async function getPrompt(cwd: string, config?: PlatformConfig): Promise<string> {
  return config ? `Load a relevant skill using an exact catalog name. Do not load skills for greetings alone.\n${formatCommandsWithinBudget(await getLimitedSkillToolCommands(cwd, config))}` : 'Load one configured skill by name.';
}
export async function getSkillToolInfo(cwd: string, config: PlatformConfig): Promise<{ skills: Skill[]; prompt: string }> {
  const skills = await getLimitedSkillToolCommands(cwd, config);
  return { skills, prompt: formatCommandsWithinBudget(skills) };
}
export function clearPromptCache(): void {}
export async function getSkillInfo(name: string, config: PlatformConfig, cwd = process.cwd()): Promise<Skill | undefined> {
  return (await getLimitedSkillToolCommands(cwd, config)).find((skill) => skill.name.toLowerCase() === name.toLowerCase());
}
