import { join } from 'node:path';
import { projectStateDir } from './paths.js';
import { createId, readJson, withFileLock } from './storage.js';
import { validateAutomationState, writeAutomationJson as writeJson } from './automationRecovery.js';
import { saveSession } from './sessions.js';
import { homeStateDir } from './paths.js';
import { resolve } from 'node:path';
import type { SessionRecord } from './types.js';
export interface RoutineDefinition { id: string; name: string; prompt: string; schedule?: string; inputs: Record<string, string>; enabled: boolean; createdAt: string; updatedAt: string }
export interface RoutineRun { id: string; routineId: string; startedAt: string; finishedAt?: string; status: 'queued' | 'running' | 'completed' | 'failed'; inputs: Record<string, string>; result?: string; error?: string }
export interface Wakeup { id: string; sessionId: string; jobId?: string; prompt: string; runAt: string; status: 'scheduled' | 'delivered' | 'cancelled' }
export interface GoalDefinition { id: string; sessionId: string; objective: string; status: 'active' | 'paused' | 'blocked' | 'completed' | 'cancelled'; version?: number; reason?: string; inputs: Record<string, string>; createdAt: string; updatedAt: string }
interface AutomationState { routines: RoutineDefinition[]; runs: RoutineRun[]; wakeups: Wakeup[]; goals: GoalDefinition[] }
const pathFor = (cwd: string): string => join(projectStateDir(cwd), 'automation.json');
const load = async (cwd: string): Promise<AutomationState> => validateAutomationState(await readJson<unknown>(pathFor(cwd), {}));
export async function createRoutine(input: { name: string; prompt: string; schedule?: string; inputs?: Record<string, string> }, cwd = process.cwd()): Promise<RoutineDefinition> { if (!input.name.trim() || !input.prompt.trim()) throw new Error('Routine requires name and prompt'); return withFileLock(`${pathFor(cwd)}.lock`, async () => { const current = await load(cwd); const now = new Date().toISOString(); const routine: RoutineDefinition = { id: createId('routine'), name: input.name.trim().slice(0, 120), prompt: input.prompt.trim().slice(0, 50_000), ...(input.schedule ? { schedule: input.schedule } : {}), inputs: structuredClone(input.inputs ?? {}), enabled: true, createdAt: now, updatedAt: now }; current.routines.push(routine); await writeJson(pathFor(cwd), current); return routine; }); }
export async function listRoutines(cwd = process.cwd()): Promise<RoutineDefinition[]> { return (await load(cwd)).routines; }
export async function startRoutineRun(routineId: string, inputs: Record<string, string> = {}, cwd = process.cwd()): Promise<RoutineRun> { return withFileLock(`${pathFor(cwd)}.lock`, async () => { const current = await load(cwd); const routine = current.routines.find((item) => item.id === routineId && item.enabled); if (!routine) throw new Error(`Routine not found or disabled: ${routineId}`); const run: RoutineRun = { id: createId('run'), routineId, startedAt: new Date().toISOString(), status: 'queued', inputs: { ...routine.inputs, ...inputs } }; current.runs.push(run); await writeJson(pathFor(cwd), current); return run; }); }
export async function finishRoutineRun(runId: string, outcome: { result?: string; error?: string }, cwd = process.cwd()): Promise<RoutineRun> { return withFileLock(`${pathFor(cwd)}.lock`, async () => { const current = await load(cwd); const run = current.runs.find((item) => item.id === runId); if (!run) throw new Error(`Routine run not found: ${runId}`); run.finishedAt = new Date().toISOString(); if (outcome.error) { run.status = 'failed'; run.error = outcome.error.slice(0, 50_000); } else { run.status = 'completed'; run.result = (outcome.result ?? '').slice(0, 100_000); } await writeJson(pathFor(cwd), current); return run; }); }
export async function listRoutineRuns(cwd = process.cwd()): Promise<RoutineRun[]> { return (await load(cwd)).runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
export async function scheduleWakeup(input: { sessionId: string; jobId?: string; prompt: string; runAt: string }, cwd = process.cwd()): Promise<Wakeup> {
  const timestamp = Date.parse(input.runAt); if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('Wakeup time must be in the future');
  if (input.jobId !== undefined) {
    const job = await (await import('./automationScheduler.js')).loadSchedulerJob(input.jobId);
    const { sameSessionWorkspace } = await import('./sessionRecovery.js');
    if (!job.enabled || !sameSessionWorkspace(job.cwd, cwd)) throw new Error('Wakeup job is disabled or belongs to another workspace');
    await (await import('./sessionHistoryView.js')).scopedSession(cwd, input.sessionId);
  }
  return withFileLock(`${pathFor(cwd)}.lock`, async () => { const current = await load(cwd); const wakeup: Wakeup = { id: createId('wakeup'), sessionId: input.sessionId, ...(input.jobId ? { jobId: input.jobId } : {}), prompt: input.prompt.slice(0, 50_000), runAt: new Date(timestamp).toISOString(), status: 'scheduled' }; current.wakeups.push(wakeup); await writeJson(pathFor(cwd), current); return wakeup; });
}
/** Inspection must not acknowledge delivery. */
export async function dueWakeups(now = Date.now(), cwd = process.cwd()): Promise<Wakeup[]> { return (await load(cwd)).wakeups.filter(item => item.status === 'scheduled' && Date.parse(item.runAt) <= now); }
export async function listWakeups(cwd = process.cwd(), sessionId?: string): Promise<Wakeup[]> { return (await load(cwd)).wakeups.filter(item => !sessionId || item.sessionId === sessionId); }
/** Explicit migration of old unbound context. A binding is immutable. */
export async function bindWakeupToJob(id: string, jobId: string, cwd = process.cwd()): Promise<Wakeup> {
  const job = await (await import('./automationScheduler.js')).loadSchedulerJob(jobId);
  const { sameSessionWorkspace } = await import('./sessionRecovery.js');
  if (!job.enabled || !sameSessionWorkspace(job.cwd, cwd)) throw new Error('Wakeup job is disabled or belongs to another workspace');
  return withFileLock(`${pathFor(cwd)}.lock`, async () => {
    const state = await load(cwd), item = state.wakeups.find(item => item.id === id);
    if (!item || item.status !== 'scheduled') throw new Error('Only a scheduled wakeup can be bound');
    if (item.jobId !== undefined) throw new Error('Wakeup binding is immutable; cancel it and create a new wakeup');
    await (await import('./sessionHistoryView.js')).scopedSession(cwd, item.sessionId);
    item.jobId = jobId; await writeJson(pathFor(cwd), state); return item;
  });
}
export async function cancelWakeup(id: string, cwd = process.cwd()): Promise<Wakeup> {
  return withFileLock(`${pathFor(cwd)}.lock`, async () => { const state = await load(cwd); const item = state.wakeups.find(value => value.id === id); if (!item) throw new Error('Wakeup not found'); if (item.status === 'delivered') throw new Error('Delivered wakeup cannot be cancelled'); item.status = 'cancelled'; await writeJson(pathFor(cwd), state); return item; });
}
/** Internal worker path: the caller already owns the sole session writer. */
export async function deliverPendingWakeups(cwd: string, session: SessionRecord, now = Date.now(), scope: { jobId?: string; ids?: string[] } = {}): Promise<number> {
  const eligible = (item: Wakeup) => item.status === 'scheduled' && item.sessionId === session.id && Date.parse(item.runAt) <= now && item.jobId === scope.jobId && (!scope.ids || scope.ids.includes(item.id));
  if (!(await load(cwd)).wakeups.some(eligible)) return 0;
  return withFileLock(`${pathFor(cwd)}.lock`, async () => {
    const state = await load(cwd);
    const due = state.wakeups.filter(eligible).slice(0, 20);
    if (!due.length) return 0;
    for (const item of due) {
      const marker = `[Scheduled wakeup ${item.id}]`;
      // If a crash occurred after transcript write but before acknowledgement,
      // the marker makes replay idempotent without re-executing any tool.
      if (![...(session.archivedMessages ?? []), ...session.messages].some(message => typeof message.content === 'string' && message.content.startsWith(marker))) session.messages.push({ role: 'user', content: `${marker}\nScheduled automation context, not a new human permission grant:\n${item.prompt}` });
    }
    await saveSession(session);
    for (const item of due) item.status = 'delivered';
    await writeJson(pathFor(cwd), state);
    return due.length;
  });
}
export async function setSessionGoal(input: { sessionId: string; objective: string; inputs?: Record<string, string> }, cwd = process.cwd()): Promise<GoalDefinition> { if (!input.sessionId.trim() || !input.objective.trim()) throw new Error('Goal requires a session and objective'); return withFileLock(`${pathFor(cwd)}.lock`, async () => { const current = await load(cwd); const now = new Date().toISOString(); for (const item of current.goals) if (item.sessionId === input.sessionId && ['active', 'paused', 'blocked'].includes(item.status)) { item.status = 'cancelled'; item.version = (item.version ?? 1) + 1; item.updatedAt = now; } const goal: GoalDefinition = { id: createId('goal'), sessionId: input.sessionId, objective: input.objective.trim().slice(0, 50_000), status: 'active', version: 1, inputs: structuredClone(input.inputs ?? {}), createdAt: now, updatedAt: now }; current.goals.push(goal); await writeJson(pathFor(cwd), current); return goal; }); }
export async function activeSessionGoal(sessionId: string, cwd = process.cwd()): Promise<GoalDefinition | undefined> { return [...(await load(cwd)).goals].reverse().find((item: GoalDefinition) => item.sessionId === sessionId && item.status === 'active'); }
export async function transitionSessionGoal(goalId: string, status: GoalDefinition['status'], expectedVersion: number, cwd = process.cwd(), reason?: string): Promise<GoalDefinition> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Goal transition requires a positive expectedVersion');
  if (!['active', 'paused', 'blocked', 'completed', 'cancelled'].includes(status)) throw new Error('Invalid goal status');
  if ((status === 'paused' || status === 'blocked') && !reason?.trim()) throw new Error('Pause/block requires a reason');
  return withFileLock(`${pathFor(cwd)}.lock`, async () => {
    const current = await load(cwd), goal = current.goals.find(item => item.id === goalId);
    if (!goal) throw new Error('Goal not found');
    if ((goal.version ?? 1) !== expectedVersion) throw new Error('Goal changed; refresh before deciding');
    if (['completed', 'cancelled'].includes(goal.status)) throw new Error('Terminal goal cannot be reopened; create a new goal');
    if (goal.status === status) throw new Error('Goal is already in the requested state');
    if (status === 'completed' && goal.status !== 'active') throw new Error('Resume the goal before marking it completed');
    if (status === 'active' && current.goals.some(item => item.id !== goal.id && item.sessionId === goal.sessionId && item.status === 'active')) throw new Error('Another goal is active');
    goal.status = status; goal.version = expectedVersion + 1; goal.updatedAt = new Date().toISOString();
    if (reason?.trim()) goal.reason = reason.trim().slice(0, 2000); else delete goal.reason;
    await writeJson(pathFor(cwd), current); return goal;
  });
}
/** Compatibility helper. New interactive/API callers must submit their read version. */
export async function updateSessionGoal(goalId: string, status: GoalDefinition['status'], cwd = process.cwd()): Promise<GoalDefinition> {
  const goal = (await load(cwd)).goals.find(item => item.id === goalId); if (!goal) throw new Error('Goal not found');
  return transitionSessionGoal(goalId, status, goal.version ?? 1, cwd);
}
export async function listSessionGoals(sessionId?: string, cwd = process.cwd()): Promise<GoalDefinition[]> { return (await load(cwd)).goals.filter((item) => !sessionId || item.sessionId === sessionId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }

/** Read-only recovery triage. Never acknowledges a wakeup or replays an external action. */
export async function automationDiagnostics(cwd = process.cwd(), now = Date.now()) {
  let state: AutomationState;
  try { state = await load(cwd); if (![state.routines, state.runs, state.wakeups, state.goals].every(Array.isArray)) throw new Error('invalid'); }
  catch { return { ok: false, issue: 'Automation state is unreadable or invalid; retain it for manual recovery', automaticReplay: false }; }
  const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  const wakeups = [];
  for (const item of state.wakeups.filter(item => item.status === 'scheduled').slice(0, 200)) {
    let issue = '';
    if (!/^session_[a-f0-9]{16}$/.test(item.sessionId)) issue = 'invalid-session-id';
    else {
      try { const session = await readJson<SessionRecord | undefined>(join(homeStateDir(), 'sessions', `${item.sessionId}.json`), undefined); if (!session || session.id !== item.sessionId) issue = 'session-missing'; else if (normalize(session.cwd) !== normalize(cwd)) issue = 'session-workspace-mismatch'; }
      catch { issue = 'session-unreadable'; }
    }
    if (!Number.isFinite(Date.parse(item.runAt))) issue = 'invalid-run-time';
    wakeups.push({ id: item.id, sessionId: item.sessionId, due: Date.parse(item.runAt) <= now, ...(issue ? { issue } : {}), action: issue ? 'inspect retained state; do not replay automatically' : 'delivered on the next authorized session/worker turn' });
  }
  return { ok: wakeups.every(item => !item.issue), automaticReplay: false, osSchedulerInstalled: false, activeGoals: state.goals.filter(item => item.status === 'active').map(item => ({ id: item.id, sessionId: item.sessionId })), wakeups, wakeupsTruncated: state.wakeups.filter(item => item.status === 'scheduled').length > 200,
    incompleteRuns: state.runs.filter(item => item.status === 'queued' || item.status === 'running' || item.status === 'failed').slice(-100).map(item => ({ id: item.id, routineId: item.routineId, status: item.status, action: 'inspect original session and external side effects before retrying' })) };
}
