import type { AgentRecord } from '../../types.js';
export interface AgentSummary { id: string; role: string; status: string; goal: string; outcome?: string; durationMs: number }
export function summarizeAgent(agent: AgentRecord, now = Date.now()): AgentSummary { const durationMs = Math.max(0, now - Date.parse(agent.createdAt)); return { id: agent.id, role: agent.role, status: agent.status, goal: agent.goal.slice(0, 500), ...(agent.result || agent.error ? { outcome: (agent.result ?? agent.error)!.slice(0, 2_000) } : {}), durationMs }; }
