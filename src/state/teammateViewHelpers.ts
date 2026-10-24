import type { AgentRecord } from '../types.js';
export const isActiveTeammate = (agent: AgentRecord): boolean => ['queued', 'working', 'waiting_for_input'].includes(agent.status);
export function sortTeammates(agents: AgentRecord[]): AgentRecord[] { return [...agents].sort((left, right) => Number(isActiveTeammate(right)) - Number(isActiveTeammate(left)) || right.updatedAt.localeCompare(left.updatedAt)); }
export function teammateLabel(agent: AgentRecord): string { return `${agent.role} · ${agent.status}`; }
