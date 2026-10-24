import { readFile } from 'node:fs/promises';
import type { AgentRecord, PlatformConfig } from './types.js';
import { cancelAgent, saveAgent, spawnAgent, waitForAgent } from './agent.js';
import { mergeWorktree } from './worktree.js';

export interface WorkflowTask {
  id: string;
  goal: string;
  role?: string;
  dependsOn?: string[];
  isolation?: 'none' | 'worktree';
}

export interface WorkflowDefinition { name: string; tasks: WorkflowTask[]; integration?: 'none' | 'merge' }

export function validateWorkflow(value: unknown): asserts value is WorkflowDefinition {
  if (!value || typeof value !== 'object') throw new Error('Workflow must be an object');
  const definition = value as WorkflowDefinition;
  if (typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 160) throw new Error('Workflow requires a name of at most 160 characters');
  if (!Array.isArray(definition.tasks) || definition.tasks.length < 1 || definition.tasks.length > 200) throw new Error('Workflow requires 1–200 tasks');
  if (definition.integration !== undefined && !['none', 'merge'].includes(definition.integration)) throw new Error('Invalid workflow integration mode');
  for (const task of definition.tasks) {
    if (!task || typeof task !== 'object' || typeof task.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(task.id)) throw new Error('Workflow task id must contain 1–64 letters, digits, underscores or hyphens');
    if (['skip', 'when', 'if'].some(field => field in task)) throw new Error('Conditional/skipped workflow tasks are not supported; use an explicit dependency graph instead');
    if (typeof task.goal !== 'string' || !task.goal.trim() || task.goal.length > 100_000) throw new Error(`Workflow task ${task.id} requires a bounded non-empty goal`);
    if (task.role !== undefined && (typeof task.role !== 'string' || !task.role.trim() || task.role.length > 160)) throw new Error(`Invalid role for workflow task ${task.id}`);
    if (task.isolation !== undefined && !['none', 'worktree'].includes(task.isolation)) throw new Error(`Invalid isolation for workflow task ${task.id}`);
    if (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.length > 200 || task.dependsOn.some(id => typeof id !== 'string'))) throw new Error(`Invalid dependencies for workflow task ${task.id}`);
  }
  const ids = new Set(definition.tasks.map((task) => task.id));
  if (ids.size !== definition.tasks.length) throw new Error('Workflow task ids must be unique');
  for (const task of definition.tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for task ${task.id}`);
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
    }
  }
  const waiting = new Map(definition.tasks.map(task => [task.id, new Set(task.dependsOn ?? [])]));
  while (waiting.size) {
    const ready = [...waiting].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id);
    if (!ready.length) throw new Error('Workflow dependency graph contains a cycle');
    for (const id of ready) { waiting.delete(id); for (const dependencies of waiting.values()) dependencies.delete(id); }
  }
}

export async function loadWorkflow(path: string): Promise<WorkflowDefinition> {
  const definition: unknown = JSON.parse(await readFile(path, 'utf8'));
  validateWorkflow(definition);
  return definition;
}

export async function runWorkflow(
  definition: WorkflowDefinition,
  cwd: string,
  config: PlatformConfig,
): Promise<Map<string, AgentRecord>> {
  validateWorkflow(definition);
  if (!Number.isSafeInteger(config.agents.maxConcurrent) || config.agents.maxConcurrent < 1) throw new Error('Workflow requires a positive concurrency limit');
  const results = new Map<string, AgentRecord>();
  const pending = new Map(definition.tasks.map((task) => [task.id, task]));
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((task) => (task.dependsOn ?? []).every((id) => results.get(id)?.status === 'completed'));
    if (ready.length === 0) {
      const blocked = [...pending.values()].map((task) => task.id).join(', ');
      throw new Error(`Workflow is cyclic or blocked by a failed task: ${blocked}`);
    }
    const batch = ready.slice(0, config.agents.maxConcurrent);
    const launched = await Promise.allSettled(batch.map((task) => spawnAgent({
      goal: task.goal,
      role: task.role ?? task.id,
      cwd,
      config,
      isolation: task.isolation ?? config.agents.defaultIsolation,
      background: true,
    })));
    const agents = launched.filter((item): item is PromiseFulfilledResult<AgentRecord> => item.status === 'fulfilled').map(item => item.value);
    const launchFailure = launched.find((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (launchFailure) {
      await Promise.all(agents.map(agent => cancelAgent(agent.id)));
      throw new Error(`Workflow launch failed; stopped its started Agents [${agents.map(agent => agent.id).join(', ')}]: ${String(launchFailure.reason)}`);
    }
    const completed = await Promise.all(agents.map((agent) => waitForAgent(agent.id)));
    completed.forEach((agent, index) => {
      const task = batch[index];
      if (task) {
        results.set(task.id, agent);
        pending.delete(task.id);
      }
    });
    const failed = completed.find((agent) => agent.status !== 'completed');
    if (failed) throw new Error(`Workflow agent ${failed.id} ended with ${failed.status}: ${failed.error ?? failed.result ?? ''}`);
    if (definition.integration === 'merge') {
      for (const agent of completed) {
        if (!agent.worktree) continue;
        await mergeWorktree(agent.cwd, agent.worktree, agent.id, config);
        delete agent.worktree;
        await saveAgent(agent);
      }
    }
  }
  return results;
}
