import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import { enqueueCommit, deliverCommits, outboxSummary, validateCommitOutbox, type CommitOutbox } from './commitOutbox.js';

export type ProjectPlanStatus = 'drafting' | 'pending_approval' | 'changes_requested' | 'approved' | 'executing' | 'blocked' | 'completed' | 'failed' | 'rejected' | 'cancelled';
export type ProjectPlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';

export interface ProjectPlanStep {
  id: string;
  title: string;
  status: ProjectPlanStepStatus;
  updatedAt: string;
  note?: string;
}

export interface ProjectPlanRecord {
  id: string;
  version: number;
  request: string;
  title: string;
  content: string;
  markdownPath: string;
  sessionId?: string;
  planningAgentId?: string;
  executionAgentId?: string;
  status: ProjectPlanStatus;
  steps: ProjectPlanStep[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  completedAt?: string;
  decisionComment?: string;
  error?: string;
}

interface ProjectPlanState { schemaVersion: 1; plans: ProjectPlanRecord[]; outbox?: CommitOutbox }

const transitions: Record<ProjectPlanStatus, readonly ProjectPlanStatus[]> = {
  drafting: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'changes_requested', 'rejected', 'cancelled'],
  changes_requested: ['drafting', 'pending_approval', 'rejected', 'cancelled'],
  approved: ['executing', 'cancelled'],
  executing: ['blocked', 'completed', 'failed', 'cancelled'],
  blocked: ['executing', 'cancelled'],
  completed: [],
  failed: ['executing', 'cancelled'],
  rejected: ['drafting', 'cancelled'],
  cancelled: [],
};

export function projectPlansDirectory(cwd = process.cwd()): string {
  return join(resolve(cwd), '.ccpt', 'plans');
}

function statePath(cwd: string): string { return join(projectPlansDirectory(cwd), 'index.json'); }
function lockPath(cwd: string): string { return `${statePath(cwd)}.lock`; }

function planSlug(request: string): string {
  const slug = request.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'implementation-plan';
}

function titleFrom(content: string, request: string): string {
  const heading = content.split(/\r?\n/).map((line) => /^#\s+(.+)$/.exec(line)?.[1]?.trim()).find(Boolean);
  return (heading ?? request.trim() ?? 'Implementation plan').slice(0, 160) || 'Implementation plan';
}

function stepsFrom(content: string, now: string): ProjectPlanStep[] {
  const titles = content.split(/\r?\n/).flatMap((line) => {
    const checkbox = /^\s*[-*]\s+\[[ xX]\]\s+(.+)$/.exec(line);
    const heading = /^\s*#{2,4}\s+(?:Task|Step|Phase)\s*\d*[:.\s-]*(.+)$/i.exec(line);
    return checkbox?.[1]?.trim() ? [checkbox[1].trim()] : heading?.[1]?.trim() ? [heading[1].trim()] : [];
  });
  return [...new Set(titles)].slice(0, 200).map((title, index) => ({ id: `step_${String(index + 1).padStart(3, '0')}`, title: title.slice(0, 300), status: 'pending', updatedAt: now }));
}

async function loadState(cwd: string): Promise<ProjectPlanState> {
  for (const path of [join(resolve(cwd), '.ccpt'), projectPlansDirectory(cwd), statePath(cwd)]) {
    try { const info = await lstat(path); if (info.isSymbolicLink() || (path === statePath(cwd) ? !info.isFile() || info.size > 32_000_000 : !info.isDirectory())) throw new Error('Invalid Plan state path/size'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const state = await readJson<ProjectPlanState>(statePath(cwd), { schemaVersion: 1, plans: [] });
  if (state?.schemaVersion !== 1 || !Array.isArray(state.plans)) throw new Error('Invalid Plan snapshot');
  validateCommitOutbox(state.outbox);
  return state;
}

async function mutatePlan<T>(cwd: string, update: (state: ProjectPlanState) => T | Promise<T>): Promise<T> {
  await loadState(cwd);
  return withFileLock(lockPath(cwd), async () => {
    const state = await loadState(cwd);
    state.outbox = enqueueCommit(state.outbox);
    const result = await update(state);
    await writeJson(statePath(cwd), state);
    // Delivery failure must not turn a successful approval into a retryable failure.
    try { await deliverCommits(cwd, 'plans', state.outbox); await writeJson(statePath(cwd), state); } catch { /* retained intent is recovered on reconnect/CLI */ }
    return result;
  });
}

export async function recoverPlanOutbox(cwd: string) {
  const initial = await loadState(cwd);
  if (!initial.outbox?.pending.length) return { delivered: 0, ...outboxSummary(initial.outbox) };
  return withFileLock(lockPath(cwd), async () => {
    const state = await loadState(cwd), delivered = await deliverCommits(cwd, 'plans', state.outbox);
    await writeJson(statePath(cwd), state);
    return { delivered, ...outboxSummary(state.outbox) };
  });
}

export async function saveProjectPlan(cwd: string, content: string, request = 'implementation plan'): Promise<string> {
  if (!content.trim()) throw new Error('Cannot save an empty plan');
  const directory = projectPlansDirectory(cwd);
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(directory, `${timestamp}-${planSlug(request)}-${randomUUID().slice(0, 8)}.md`);
  await writeFile(path, `${content.trim()}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return path;
}

export async function createProjectPlan(input: { cwd: string; request: string; content: string; title?: string; sessionId?: string; planningAgentId?: string; status?: 'drafting' | 'pending_approval' }): Promise<ProjectPlanRecord> {
  const content = input.content.trim();
  if (!content) throw new Error('Cannot create an empty plan');
  const cwd = resolve(input.cwd);
  return mutatePlan(cwd, async (state) => {
    const now = new Date().toISOString();
    const id = createId('plan');
    const markdownPath = join(projectPlansDirectory(cwd), `${id}-${planSlug(input.request)}.md`);
    const plan: ProjectPlanRecord = {
      id,
      version: 1,
      request: input.request.trim().slice(0, 20_000) || 'implementation plan',
      title: (input.title?.trim() || titleFrom(content, input.request)).slice(0, 160),
      content,
      markdownPath: relative(cwd, markdownPath),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.planningAgentId ? { planningAgentId: input.planningAgentId } : {}),
      status: input.status ?? 'pending_approval',
      steps: stepsFrom(content, now),
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(projectPlansDirectory(cwd), { recursive: true });
    await writeFile(markdownPath, `${content}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    state.plans.push(plan);
    return structuredClone(plan);
  });
}

export async function listPlanRecords(cwd = process.cwd()): Promise<ProjectPlanRecord[]> {
  return (await loadState(resolve(cwd))).plans.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadProjectPlan(cwd: string, id: string): Promise<ProjectPlanRecord> {
  if (!/^plan_[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid plan id: ${id}`);
  const plan = (await loadState(resolve(cwd))).plans.find((item) => item.id === id);
  if (!plan) throw new Error(`Plan not found: ${id}`);
  return structuredClone(plan);
}

export async function transitionProjectPlan(cwd: string, id: string, status: ProjectPlanStatus, options: { expectedVersion?: number; expectedExecutionAgentId?: string; comment?: string; executionAgentId?: string; error?: string } = {}): Promise<ProjectPlanRecord> {
  cwd = resolve(cwd);
  return mutatePlan(cwd, (state) => {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) throw new Error(`Plan not found: ${id}`);
    if (options.expectedVersion !== undefined && plan.version !== options.expectedVersion) throw new Error(`Plan ${id} changed from version ${options.expectedVersion} to ${plan.version}`);
    if (options.expectedExecutionAgentId && plan.executionAgentId !== options.expectedExecutionAgentId) throw new Error(`Plan ${id} belongs to another execution Agent`);
    if (plan.status !== status && !transitions[plan.status].includes(status)) throw new Error(`Cannot transition plan ${id} from ${plan.status} to ${status}`);
    const now = new Date().toISOString();
    if (status === 'executing' && plan.status !== 'executing') delete plan.executionAgentId;
    plan.status = status;
    plan.version += 1;
    plan.updatedAt = now;
    if (status === 'approved') plan.approvedAt = now;
    if (status === 'completed') plan.completedAt = now;
    if (options.comment?.trim()) plan.decisionComment = options.comment.trim().slice(0, 20_000);
    if (options.executionAgentId) plan.executionAgentId = options.executionAgentId;
    if (options.error) plan.error = options.error.slice(0, 40_000); else if (status === 'executing') delete plan.error;
    return structuredClone(plan);
  });
}

export async function linkProjectPlanExecution(cwd: string, id: string, executionAgentId: string): Promise<ProjectPlanRecord> {
  if (!/^agent_[a-f0-9]{16}$/.test(executionAgentId)) throw new Error(`Invalid execution Agent id: ${executionAgentId}`);
  cwd = resolve(cwd);
  return mutatePlan(cwd, (state) => {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) throw new Error(`Plan not found: ${id}`);
    if (plan.status !== 'executing') throw new Error(`Plan ${id} is not executing (${plan.status})`);
    if (plan.executionAgentId && plan.executionAgentId !== executionAgentId) throw new Error(`Plan ${id} already has an execution Agent`);
    if (plan.executionAgentId === executionAgentId) return structuredClone(plan);
    plan.executionAgentId = executionAgentId;
    plan.version += 1;
    plan.updatedAt = new Date().toISOString();
    return structuredClone(plan);
  });
}

export async function reviseProjectPlan(cwd: string, id: string, content: string, comment?: string): Promise<ProjectPlanRecord> {
  content = content.trim();
  if (!content) throw new Error('Revised plan content is required');
  cwd = resolve(cwd);
  return mutatePlan(cwd, async (state) => {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) throw new Error(`Plan not found: ${id}`);
    if (!['drafting', 'changes_requested', 'rejected'].includes(plan.status)) throw new Error(`Plan ${id} cannot be revised while ${plan.status}`);
    const now = new Date().toISOString();
    plan.content = content;
    plan.title = titleFrom(content, plan.request);
    plan.steps = stepsFrom(content, now);
    plan.status = 'pending_approval';
    delete plan.approvedAt;
    delete plan.completedAt;
    delete plan.executionAgentId;
    delete plan.error;
    plan.version += 1;
    plan.updatedAt = now;
    if (comment?.trim()) plan.decisionComment = comment.trim().slice(0, 20_000);
    await writeFile(resolve(cwd, plan.markdownPath), `${content}\n`, { encoding: 'utf8', mode: 0o600 });
    return structuredClone(plan);
  });
}

export async function updateProjectPlanStep(cwd: string, id: string, stepId: string, status: ProjectPlanStepStatus, note?: string): Promise<ProjectPlanRecord> {
  cwd = resolve(cwd);
  return mutatePlan(cwd, (state) => {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) throw new Error(`Plan not found: ${id}`);
    if (!['executing', 'blocked'].includes(plan.status)) throw new Error(`Plan ${id} steps cannot change while ${plan.status}`);
    const step = plan.steps.find((item) => item.id === stepId);
    if (!step) throw new Error(`Plan step not found: ${stepId}`);
    step.status = status;
    step.updatedAt = new Date().toISOString();
    if (note?.trim()) step.note = note.trim().slice(0, 20_000);
    plan.version += 1;
    plan.updatedAt = step.updatedAt;
    return structuredClone(plan);
  });
}

export async function listProjectPlans(cwd = process.cwd()): Promise<string[]> {
  try {
    return (await readdir(projectPlansDirectory(cwd))).filter((name) => name.endsWith('.md')).sort().reverse();
  } catch {
    return [];
  }
}
