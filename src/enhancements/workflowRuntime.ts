import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { projectStateDir } from '../paths.js';
import { createId, readJson, withFileLock, writeJson } from '../storage.js';
import type { WorkflowDefinition, WorkflowTask } from '../workflow.js';

export type WorkflowRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface WorkflowRunRecord { id: string; definition: WorkflowDefinition; status: WorkflowRunStatus; taskStatus: Record<string, WorkflowRunStatus>; createdAt: string; updatedAt: string; parentRunId?: string }
interface WorkflowRuntimeState { runs: WorkflowRunRecord[] }
const pathFor = (cwd: string): string => join(projectStateDir(cwd), 'workflow-runs.json');
const load = (cwd: string): Promise<WorkflowRuntimeState> => readJson(pathFor(cwd), { runs: [] });

function validateDefinition(definition: WorkflowDefinition): void {
  if (!definition.name.trim() || definition.tasks.length === 0) throw new Error('Workflow requires a name and tasks');
  const ids = new Set(definition.tasks.map((task) => task.id));
  if (ids.size !== definition.tasks.length) throw new Error('Workflow task ids must be unique');
  for (const task of definition.tasks) for (const dependency of task.dependsOn ?? []) if (!ids.has(dependency) || dependency === task.id) throw new Error(`Invalid dependency ${dependency} for ${task.id}`);
}

export async function createWorkflowRun(definition: WorkflowDefinition, cwd = process.cwd(), parentRunId?: string): Promise<WorkflowRunRecord> {
  validateDefinition(definition);
  return withFileLock(`${pathFor(cwd)}.lock`, async () => {
    const state = await load(cwd);
    const now = new Date().toISOString();
    const run: WorkflowRunRecord = { id: createId('workflow'), definition: structuredClone(definition), status: 'queued', taskStatus: Object.fromEntries(definition.tasks.map((task) => [task.id, 'queued'])), createdAt: now, updatedAt: now, ...(parentRunId ? { parentRunId } : {}) };
    state.runs.push(run);
    await writeJson(pathFor(cwd), { runs: state.runs.slice(-1_000) });
    return run;
  });
}

export async function updateWorkflowRun(runId: string, patch: { status?: WorkflowRunStatus; taskId?: string; taskStatus?: WorkflowRunStatus }, cwd = process.cwd()): Promise<WorkflowRunRecord> {
  return withFileLock(`${pathFor(cwd)}.lock`, async () => {
    const state = await load(cwd);
    const run = state.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Workflow run not found: ${runId}`);
    if (patch.taskId && patch.taskStatus) {
      if (!(patch.taskId in run.taskStatus)) throw new Error(`Workflow task not found: ${patch.taskId}`);
      run.taskStatus[patch.taskId] = patch.taskStatus;
    }
    if (patch.status) run.status = patch.status;
    run.updatedAt = new Date().toISOString();
    await writeJson(pathFor(cwd), state);
    return run;
  });
}

export async function listWorkflowRuns(cwd = process.cwd()): Promise<WorkflowRunRecord[]> { return (await load(cwd)).runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }

export function workflowForRerun(previous: WorkflowRunRecord): WorkflowDefinition {
  const retry = new Set(Object.entries(previous.taskStatus).filter(([, status]) => status === 'failed' || status === 'cancelled').map(([id]) => id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of previous.definition.tasks) if (!retry.has(task.id) && (task.dependsOn ?? []).some((id) => retry.has(id))) { retry.add(task.id); changed = true; }
  }
  if (retry.size === 0) throw new Error('Workflow has no failed or cancelled tasks to re-run');
  const tasks = previous.definition.tasks.filter((task) => retry.has(task.id)).map((task) => ({ ...task, dependsOn: (task.dependsOn ?? []).filter((id) => retry.has(id)) }));
  return { ...previous.definition, name: `${previous.definition.name} (rerun)`, tasks };
}

export function createFanOutWorkflow(name: string, items: readonly string[], goal: (item: string, index: number) => string, options: { role?: string; isolation?: 'none' | 'worktree'; maximum?: number } = {}): WorkflowDefinition {
  const maximum = Math.min(Math.max(options.maximum ?? 64, 1), 256);
  if (items.length === 0 || items.length > maximum) throw new Error(`Fan-out requires 1-${maximum} items`);
  return { name, tasks: items.map((item, index): WorkflowTask => ({ id: `item-${index + 1}`, goal: goal(item, index), ...(options.role ? { role: options.role } : {}), ...(options.isolation ? { isolation: options.isolation } : {}) })) };
}

export function createDeepResearchWorkflow(question: string, sources: readonly string[]): WorkflowDefinition {
  if (!question.trim() || sources.length === 0) throw new Error('Deep research requires a question and at least one source');
  const research = sources.slice(0, 64).map((source, index): WorkflowTask => ({ id: `research-${index + 1}`, role: 'researcher', goal: `Research ${JSON.stringify(source)} for evidence relevant to: ${question}`, isolation: 'none' }));
  return { name: `Deep research: ${question.slice(0, 80)}`, tasks: [...research, { id: 'synthesis', role: 'synthesizer', goal: `Synthesize the research into an evidence-backed answer to: ${question}`, dependsOn: research.map((task) => task.id), isolation: 'none' }] };
}

export interface WorkflowBundle { schema: 1; definition: WorkflowDefinition; createdAt: string; checksum: string }
export function exportWorkflowBundle(definition: WorkflowDefinition): string {
  validateDefinition(definition);
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify({ schema: 1, definition, createdAt });
  return JSON.stringify({ schema: 1, definition, createdAt, checksum: createHash('sha256').update(payload).digest('hex') } satisfies WorkflowBundle, null, 2);
}
export function importWorkflowBundle(serialized: string): WorkflowDefinition {
  const bundle = JSON.parse(serialized) as WorkflowBundle;
  const payload = JSON.stringify({ schema: bundle.schema, definition: bundle.definition, createdAt: bundle.createdAt });
  if (bundle.schema !== 1 || createHash('sha256').update(payload).digest('hex') !== bundle.checksum) throw new Error('Workflow bundle integrity check failed');
  validateDefinition(bundle.definition);
  return bundle.definition;
}
