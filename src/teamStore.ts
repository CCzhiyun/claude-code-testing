import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { createId, readJson, writeJson, withFileLock } from './storage.js';
import { commitRuntimeSnapshot, readRuntimeSnapshot, publicRuntimeSnapshot } from './runtimeOutbox.js';
export interface TeamRecord { id: string; name: string; ownerAgentId: string; createdAt: string; teamSessionId?: string; cwd?: string }
const path = (id: string) => { if (!/^team_[a-f0-9]{16}$/.test(id)) throw new Error('Invalid team ID'); return join(homeStateDir(), 'teams', `${id}.json`); };
export async function createTeam(name: string, ownerAgentId: string): Promise<TeamRecord> {
  if (!name.trim()) throw new Error('Team name is required');
  const { loadAgent } = await import('./agent.js'); const owner = await loadAgent(ownerAgentId);
  if (owner.parentId || (owner.teamSessionId ?? owner.sessionId) !== owner.sessionId) throw new Error('Only the root lead can create a named team');
  return withFileLock(join(homeStateDir(), 'teams', 'registry.lock'), async () => {
    const existing = (await listTeams()).find((team) => team.teamSessionId === owner.sessionId); if (existing) return existing;
    const team: TeamRecord = { id: createId('team'), name: name.trim().slice(0, 120), ownerAgentId, teamSessionId: owner.sessionId, cwd: owner.cwd, createdAt: new Date().toISOString() };
    await commitRuntimeSnapshot(path(team.id), 'teams', team.id, team, [owner.cwd]); return team;
  });
}
export async function loadTeam(id: string): Promise<TeamRecord> {
  const stored = await readRuntimeSnapshot(path(id));
  const team = stored && !stored._deletedAt ? publicRuntimeSnapshot<TeamRecord>(stored) : undefined;
  if (!team || team.id !== id || !/^agent_[a-f0-9]{16}$/.test(team.ownerAgentId)) throw new Error(`Team not found or invalid: ${id}`); return team;
}
export async function listTeams(): Promise<TeamRecord[]> {
  let files: string[]; try { files = await readdir(join(homeStateDir(), 'teams')); } catch { return []; }
  const records = await Promise.all(files.filter((file) => /^team_[a-f0-9]{16}\.json$/.test(file)).map(async file => {
    const value = await readRuntimeSnapshot(join(homeStateDir(), 'teams', file));
    return value && !value._deletedAt ? publicRuntimeSnapshot<TeamRecord>(value) : undefined;
  }));
  return records.filter((team): team is TeamRecord => Boolean(team && /^team_[a-f0-9]{16}$/.test(team.id) && /^agent_[a-f0-9]{16}$/.test(team.ownerAgentId)));
}
/** Remove named registry metadata only; preserve task, conversation and worktree evidence. */
export async function deleteTeam(id: string): Promise<void> {
  await withFileLock(join(homeStateDir(), 'teams', 'registry.lock'), async () => {
    const team = await loadTeam(id); const { listAgents } = await import('./agent.js');
    if (!team.teamSessionId) throw new Error('Legacy team is not bound to a runtime session; cannot safely clean it up');
    await withFileLock(join(homeStateDir(), 'locks', 'agents.lock'), async () => {
      const active = (await listAgents()).filter((agent) => (agent.teamSessionId ?? agent.sessionId) === team.teamSessionId && ['queued', 'working', 'waiting_for_input'].includes(agent.status));
      if (active.length) throw new Error(`Team has ${active.length} active Agent(s); finish or stop them before cleanup`);
      // Retain a tombstone with the committed deletion event; deleting the file
      // first would lose the outbox if the journal is unavailable.
      await commitRuntimeSnapshot(path(id), 'teams', id, { ...team, _deletedAt: new Date().toISOString() }, team.cwd ? [team.cwd] : []);
    });
  });
}
