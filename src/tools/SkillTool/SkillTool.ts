import type { ToolContext, ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';
import { getSkillInfo } from './prompt.js';
import { expandSkillInstructions } from '../../skills.js';
import { isPlanMode } from '../modeState.js';

export const inputSchema = { type: 'object', properties: { skill: { type: 'string' }, args: { type: 'string' } }, required: ['skill'] };
export const outputSchema = { type: 'object' };
export type Output = { name: string; instructions: string; tools?: string[]; context?: 'fork'; agentId?: string };
export async function executeSkillTool(input: { skill: string; args?: string }, context: ToolContext): Promise<Output> {
  const skill = await getSkillInfo(input.skill, context.config, context.cwd);
  if (!skill) throw new Error(`Unknown skill: ${input.skill}. Use an exact name from the enabled skill catalog; do not guess aliases or retry unavailable skills.`);
  if (skill.context === 'fork') {
    const { spawnAgent } = await import('../../agent.js');
    const { loadPlatform } = await import('../../platform.js');
    const profile = skill.agent ? (await loadPlatform(context.cwd, context.config)).agents.find((agent) => agent.name === skill.agent) : undefined;
    if (skill.agent && !profile) throw new Error(`Unknown Skill Agent profile: ${skill.agent}`);
    const childConfig = structuredClone(context.config);
    if (skill.model && skill.model !== 'inherit') childConfig.model.name = skill.model;
    const allowedTools = skill.tools ? skill.tools.filter((name) => !context.capabilityTools || context.capabilityTools.includes(name)) : context.capabilityTools;
    const child = await spawnAgent({ goal: input.args || `Apply skill ${skill.name}`, cwd: context.cwd, config: childConfig, parentId: context.agentId, role: skill.agent ?? 'general', skills: [skill.name], background: false, isolation: profile?.isolation ?? 'none', planMode: isPlanMode(context.sessionId), ...(allowedTools ? { allowedTools } : {}) });
    return { name: skill.name, context: 'fork', agentId: child.id, instructions: child.result ?? child.error ?? `Subagent ${child.id}: ${child.status}` };
  }
  return { name: skill.name, instructions: expandSkillInstructions(skill, input.args), ...(skill.tools ? { tools: skill.tools } : {}) };
}
export const SkillTool: ToolDefinition = buildTool({ name: 'skill', description: 'Load a relevant, enabled skill using an exact name from the available skill catalog. Not needed for greetings or casual chat.', input_schema: inputSchema });
