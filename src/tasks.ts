import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import type { TaskRecord, TaskStatus } from './types.js';
import { commitRuntimeSnapshot, readRuntimeSnapshot, publicRuntimeSnapshot } from './runtimeOutbox.js';

const terminalStatuses = new Set<TaskStatus>(['completed', 'failed', 'cancelled']);

function taskPath(id: string): string {
  if (!/^task_[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid task id: ${id}`);
  return join(homeStateDir(), 'tasks', `${id}.json`);
}

function taskLockPath(id: string): string {
  taskPath(id); // Validate before using an external id in any filesystem path.
  return join(homeStateDir(), 'locks', `task-${id}.lock`);
}

export async function createTask(options: {
  teamSessionId: string;
  title: string;
  description?: string;
  sessionId?: string;
  parentTaskId?: string;
  agentId?: string;
  ownerAgentId?: string;
  dependencies?: string[];
}): Promise<TaskRecord> {
  const dependencies = [...new Set(options.dependencies ?? [])];
  for (const dependency of dependencies) {
    const task = await loadTask(dependency);
    if (task.teamSessionId !== options.teamSessionId) throw new Error(`Task dependency is outside the team: ${dependency}`);
  }
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: createId('task'),
    teamSessionId: options.teamSessionId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.parentTaskId ? { parentTaskId: options.parentTaskId } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.ownerAgentId ? { ownerAgentId: options.ownerAgentId } : {}),
    title: options.title.slice(0, 160),
    description: options.description ?? options.title,
    status: 'queued',
    dependencies,
    createdAt: now,
    updatedAt: now,
  };
  await saveTask(task);
  return task;
}

export async function loadTask(id: string): Promise<TaskRecord> {
  const stored = await readRuntimeSnapshot(taskPath(id));
  const task = stored ? publicRuntimeSnapshot<TaskRecord>(stored) : null;
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

export async function saveTask(task: TaskRecord): Promise<void> {
  return withFileLock(taskLockPath(task.id), () => saveTaskLocked(task));
}
async function saveTaskLocked(task: TaskRecord): Promise<void> {
  const session = /^session_[a-f0-9]{16}$/.test(task.teamSessionId) ? await readJson<{ cwd?: string } | null>(join(homeStateDir(), 'sessions', `${task.teamSessionId}.json`), null) : null;
  task.updatedAt = new Date().toISOString();
  await commitRuntimeSnapshot(taskPath(task.id), 'tasks', task.id, task, typeof session?.cwd === 'string' ? [session.cwd] : []);
}

export async function updateTask(id: string, patch: {
  status?: TaskStatus;
  result?: string;
  error?: string;
  agentId?: string;
  ownerAgentId?: string;
}): Promise<TaskRecord> {
  return withFileLock(taskLockPath(id), async () => {
    const task = await loadTask(id);
    if (patch.status) {
      if (terminalStatuses.has(task.status) && patch.status === 'in_progress') throw new Error(`Terminal task cannot be restarted: ${id}`);
      if (patch.status === 'in_progress') {
        for (const dependencyId of task.dependencies) {
          const dependency = await loadTask(dependencyId);
          if (dependency.status !== 'completed') throw new Error(`Task dependency is not complete: ${dependencyId}`);
        }
      }
      task.status = patch.status;
    }
    if (patch.result !== undefined) task.result = patch.result;
    if (patch.error !== undefined) task.error = patch.error;
    if (patch.agentId !== undefined) task.agentId = patch.agentId;
    if (patch.ownerAgentId !== undefined) task.ownerAgentId = patch.ownerAgentId;
    await saveTaskLocked(task);
    return task;
  });
}

export async function claimTask(id: string, teamSessionId: string, agentId: string): Promise<TaskRecord> {
  return withFileLock(taskLockPath(id), async () => {
    const task = await loadTask(id);
    if (task.teamSessionId !== teamSessionId) throw new Error('Task is outside the active team scope');
    if (task.ownerAgentId && task.ownerAgentId !== agentId) throw new Error(`Task is already owned by ${task.ownerAgentId}`);
    for (const dependencyId of task.dependencies) {
      const dependency = await loadTask(dependencyId);
      if (dependency.status !== 'completed') throw new Error(`Task dependency is not complete: ${dependencyId}`);
    }
    if (terminalStatuses.has(task.status)) throw new Error(`Terminal task cannot be claimed: ${id}`);
    task.ownerAgentId = agentId;
    task.status = 'in_progress';
    await saveTaskLocked(task);
    return task;
  });
}

export async function listTasks(teamSessionId?: string): Promise<TaskRecord[]> {
  const directory = join(homeStateDir(), 'tasks');
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const tasks = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) =>
    readRuntimeSnapshot(join(directory, name)).then(value => value ? publicRuntimeSnapshot<TaskRecord>(value) : null)));
  return tasks.filter((task): task is TaskRecord => task !== null && (!teamSessionId || task.teamSessionId === teamSessionId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
