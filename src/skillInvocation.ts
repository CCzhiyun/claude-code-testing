import { loadPlatform } from './platform.js';
import { continueAgent, loadAgent, spawnAgent } from './agent.js';
import { userInvocableSkill } from './skills.js';
import type { PlatformConfig, AgentRecord } from './types.js';
import type { RuntimeEventListener } from './runtimeEvents.js';

/** Shared human slash invocation. Inline keeps the same Agent/session; fork does not replace it. */
export async function invokeUserSkill(options: { name: string; args?: string; cwd: string; config: PlatformConfig; agentId?: string; sessionId?: string; planMode?: boolean; background?: boolean; onEvent?: RuntimeEventListener }): Promise<{ agent: AgentRecord; forked: boolean }> {
  const platform = await loadPlatform(options.cwd, options.config);
  const skill = platform.skills.find((item) => item.name.toLowerCase() === options.name.toLowerCase() && userInvocableSkill(item));
  if (!skill) throw new Error(`Skill is not user-invocable: ${options.name}`);
  const profile = skill.context === 'fork' && skill.agent ? platform.agents.find((agent) => agent.name === skill.agent) : undefined;
  if (skill.context === 'fork' && skill.agent && !profile) throw new Error(`Unknown Skill Agent profile: ${skill.agent}`);
  const goal = options.args || `Apply the ${skill.name} skill to this conversation and workspace.`;
  const config = structuredClone(options.config);
  if (skill.model && skill.model !== 'inherit') config.model.name = skill.model;
  if (options.agentId) {
    const current = await loadAgent(options.agentId);
    if (current.status === 'waiting_for_input' || ['working', 'queued'].includes(current.status)) throw new Error('Finish the pending question or operation before invoking a Skill');
    if (skill.context !== 'fork') return { agent: await continueAgent(current.id, goal, { config, background: options.background ?? false, turnSkills: [skill.name], skillArguments: options.args ?? '', planMode: options.planMode ?? current.planMode ?? false, ...(options.onEvent ? { onEvent: options.onEvent } : {}) }), forked: false };
  }
  return { agent: await spawnAgent({ goal, cwd: options.cwd, config, role: skill.context === 'fork' ? skill.agent ?? 'general' : 'lead', background: options.background ?? false, isolation: profile?.isolation ?? 'none', planMode: options.planMode ?? false, ...(options.agentId ? { parentId: options.agentId } : options.sessionId ? { sessionId: options.sessionId } : {}), ...(skill.context === 'fork' && skill.tools ? { allowedTools: skill.tools } : {}), ...(options.onEvent ? { onEvent: options.onEvent } : {}), turnSkills: [skill.name], skillArguments: options.args ?? '' }), forked: skill.context === 'fork' };
}
