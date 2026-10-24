import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
import { readJson, withFileLock, writeJson } from '../storage.js';

export type SupervisedAgentState = 'attached' | 'detached' | 'stale';
export interface SupervisedAgent {
  agentId: string;
  sessionId: string;
  cwd: string;
  pid?: number;
  group: string;
  state: SupervisedAgentState;
  attachedAt: string;
  updatedAt: string;
}

interface SupervisorState { agents: SupervisedAgent[] }
const statePath = (): string => join(homeStateDir(), 'supervisor.json');
const load = (): Promise<SupervisorState> => readJson(statePath(), { agents: [] });

export async function attachSupervisedAgent(input: { agentId: string; sessionId: string; cwd: string; pid?: number; group?: string }): Promise<SupervisedAgent> {
  if (!input.agentId.trim() || !input.sessionId.trim()) throw new Error('Agent and session ids are required');
  return withFileLock(`${statePath()}.lock`, async () => {
    const current = await load();
    const now = new Date().toISOString();
    const existing = current.agents.find((item) => item.agentId === input.agentId);
    const record: SupervisedAgent = {
      agentId: input.agentId,
      sessionId: input.sessionId,
      cwd: input.cwd,
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
      group: input.group?.trim() || existing?.group || 'default',
      state: 'attached',
      attachedAt: existing?.attachedAt ?? now,
      updatedAt: now,
    };
    if (existing) current.agents[current.agents.indexOf(existing)] = record;
    else current.agents.push(record);
    await writeJson(statePath(), current);
    return record;
  });
}

export async function detachSupervisedAgent(agentId: string): Promise<SupervisedAgent> {
  return withFileLock(`${statePath()}.lock`, async () => {
    const current = await load();
    const record = current.agents.find((item) => item.agentId === agentId);
    if (!record) throw new Error(`Supervised agent not found: ${agentId}`);
    record.state = 'detached';
    record.updatedAt = new Date().toISOString();
    delete record.pid;
    await writeJson(statePath(), current);
    return record;
  });
}

export async function organizeSupervisedAgent(agentId: string, group: string): Promise<SupervisedAgent> {
  if (!group.trim()) throw new Error('Supervisor group is required');
  return withFileLock(`${statePath()}.lock`, async () => {
    const current = await load();
    const record = current.agents.find((item) => item.agentId === agentId);
    if (!record) throw new Error(`Supervised agent not found: ${agentId}`);
    record.group = group.trim().slice(0, 120);
    record.updatedAt = new Date().toISOString();
    await writeJson(statePath(), current);
    return record;
  });
}

export async function listSupervisedAgents(options: { group?: string; includeDetached?: boolean } = {}): Promise<SupervisedAgent[]> {
  return (await load()).agents
    .filter((item) => (options.includeDetached || item.state !== 'detached') && (!options.group || item.group === options.group))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function reconcileSupervisor(isAlive: (pid: number) => boolean = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
}): Promise<SupervisedAgent[]> {
  return withFileLock(`${statePath()}.lock`, async () => {
    const current = await load();
    const changed: SupervisedAgent[] = [];
    for (const record of current.agents) {
      if (record.state === 'attached' && record.pid !== undefined && !isAlive(record.pid)) {
        record.state = 'stale';
        record.updatedAt = new Date().toISOString();
        changed.push(record);
      }
    }
    if (changed.length) await writeJson(statePath(), current);
    return changed;
  });
}
