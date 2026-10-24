import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
import { createId, readJson, withFileLock, writeJson } from '../storage.js';

export type TeamDisplayMode = 'summary' | 'split' | 'grid';
export interface TeamMemberControl { agentId: string; plan?: string; planApproved: boolean; state: 'active' | 'shutdown-requested' | 'stopped' }
export interface QualityGate { id: string; name: string; metric: string; minimum: number; blocking: boolean }
export interface Hypothesis { id: string; title: string; evidence: string[]; ownerAgentId: string; score: number; selected: boolean }
export interface TeamOrchestrationState { teamId: string; displayMode: TeamDisplayMode; members: TeamMemberControl[]; qualityGates: QualityGate[]; hypotheses: Hypothesis[]; updatedAt: string }

const pathFor = (teamId: string): string => { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(teamId)) throw new Error('Invalid team ID'); return join(homeStateDir(), 'teams', `${teamId}.orchestration.json`); };
const initial = (teamId: string): TeamOrchestrationState => ({ teamId, displayMode: 'summary', members: [], qualityGates: [], hypotheses: [], updatedAt: new Date(0).toISOString() });
const load = (teamId: string): Promise<TeamOrchestrationState> => readJson(pathFor(teamId), initial(teamId));
async function mutate(teamId: string, update: (state: TeamOrchestrationState) => void): Promise<TeamOrchestrationState> {
  return withFileLock(`${pathFor(teamId)}.lock`, async () => {
    const state = await load(teamId);
    update(state);
    state.updatedAt = new Date().toISOString();
    await writeJson(pathFor(teamId), state);
    return state;
  });
}

export function loadTeamOrchestration(teamId: string): Promise<TeamOrchestrationState> { return load(teamId); }
export function setTeamDisplayMode(teamId: string, displayMode: TeamDisplayMode): Promise<TeamOrchestrationState> { return mutate(teamId, (state) => { state.displayMode = displayMode; }); }

export function submitMemberPlan(teamId: string, agentId: string, plan: string): Promise<TeamOrchestrationState> {
  if (!plan.trim()) throw new Error('Member plan is required');
  return mutate(teamId, (state) => {
    const member = state.members.find((item) => item.agentId === agentId) ?? { agentId, planApproved: false, state: 'active' as const };
    member.plan = plan.trim().slice(0, 50_000);
    member.planApproved = false;
    if (!state.members.some((item) => item.agentId === agentId)) state.members.push(member);
  });
}

export function approveMemberPlan(teamId: string, agentId: string): Promise<TeamOrchestrationState> {
  return mutate(teamId, (state) => {
    const member = state.members.find((item) => item.agentId === agentId);
    if (!member?.plan) throw new Error(`No plan submitted for ${agentId}`);
    member.planApproved = true;
  });
}

export function requestTeammateShutdown(teamId: string, agentId: string): Promise<TeamOrchestrationState> {
  return mutate(teamId, (state) => {
    const member = state.members.find((item) => item.agentId === agentId);
    if (!member) throw new Error(`Team member not found: ${agentId}`);
    member.state = 'shutdown-requested';
  });
}

export function acknowledgeTeammateShutdown(teamId: string, agentId: string): Promise<TeamOrchestrationState> {
  return mutate(teamId, (state) => {
    const member = state.members.find((item) => item.agentId === agentId);
    if (member?.state !== 'shutdown-requested') throw new Error(`Shutdown was not requested for ${agentId}`);
    member.state = 'stopped';
  });
}

export function addQualityGate(teamId: string, gate: Omit<QualityGate, 'id'>): Promise<TeamOrchestrationState> {
  if (!gate.name.trim() || !gate.metric.trim() || !Number.isFinite(gate.minimum)) throw new Error('Quality gate requires a name, metric, and finite minimum');
  return mutate(teamId, (state) => { state.qualityGates.push({ ...gate, id: createId('gate') }); });
}

export function evaluateQualityGates(state: TeamOrchestrationState, metrics: Record<string, number>): { passed: boolean; results: Array<QualityGate & { actual?: number; passed: boolean }> } {
  const results = state.qualityGates.map((gate) => {
    const actual = metrics[gate.metric];
    return { ...gate, ...(actual !== undefined ? { actual } : {}), passed: actual !== undefined && actual >= gate.minimum };
  });
  return { passed: results.every((item) => item.passed || !item.blocking), results };
}

export function recordHypothesis(teamId: string, input: Omit<Hypothesis, 'id' | 'score' | 'selected'> & { score?: number }): Promise<TeamOrchestrationState> {
  if (!input.title.trim()) throw new Error('Hypothesis title is required');
  return mutate(teamId, (state) => { state.hypotheses.push({ ...input, evidence: input.evidence.slice(0, 100), id: createId('hypothesis'), score: input.score ?? 0, selected: false }); });
}

export function selectWinningHypothesis(teamId: string, hypothesisId?: string): Promise<TeamOrchestrationState> {
  return mutate(teamId, (state) => {
    const winner = hypothesisId ? state.hypotheses.find((item) => item.id === hypothesisId) : [...state.hypotheses].sort((a, b) => b.score - a.score)[0];
    if (!winner) throw new Error('No hypothesis is available');
    for (const item of state.hypotheses) item.selected = item.id === winner.id;
  });
}
