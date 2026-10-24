import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { PlatformConfig } from '../../types.js';
import { homeStateDir } from '../../paths.js';
import { createId, readJson, withFileLock, writeJson } from '../../storage.js';
import { authorizeCommand, protectPath } from '../../policy.js';
import { modelCredentialNames, sanitizedEnvironment } from '../../environment.js';
import { runHooks } from '../../hooks.js';
import { audit } from '../../audit.js';
import type { ShellTaskRecord, ShellTaskRuntime } from '../types.js';
import { controlProcess } from '../../executionControl.js';

function validateId(id: string): string {
  if (!/^shell_[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid shell task id: ${id}`);
  return id;
}

function recordPath(id: string): string { return join(homeStateDir(), 'shell-tasks', `${validateId(id)}.json`); }
function runtimePath(id: string): string { return join(homeStateDir(), 'shell-tasks-runtime', `${validateId(id)}.json`); }

export async function loadShellTask(id: string): Promise<ShellTaskRecord> {
  const record = await readJson<ShellTaskRecord | null>(recordPath(id), null);
  if (!record) throw new Error(`Shell task not found: ${id}`);
  return record;
}

export async function listShellTasks(options: { cwd?: string; teamSessionId?: string; limit?: number } = {}): Promise<ShellTaskRecord[]> {
  const directory = join(homeStateDir(), 'shell-tasks');
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const records = await Promise.all(names.filter((name) => /^shell_[a-f0-9]{16}\.json$/.test(name)).map((name) => readJson<ShellTaskRecord | null>(join(directory, name), null)));
  return records.filter((record): record is ShellTaskRecord => record !== null
      && (!options.cwd || resolve(record.cwd) === resolve(options.cwd))
      && (!options.teamSessionId || record.teamSessionId === options.teamSessionId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, Math.min(options.limit ?? 100, 1_000)));
}

async function saveShellTask(record: ShellTaskRecord): Promise<void> {
  record.updatedAt = new Date().toISOString();
  await writeJson(recordPath(record.id), record);
}

async function mutateShellTask(id: string, update: (record: ShellTaskRecord) => void | Promise<void>): Promise<ShellTaskRecord> {
  return withFileLock(join(homeStateDir(), 'locks', `shell-${id}.lock`), async () => {
    const record = await loadShellTask(id);
    await update(record);
    await saveShellTask(record);
    return record;
  });
}

function workerInvocation(id: string): { command: string; args: string[] } {
  const entry = process.env.CCPT_CLI_ENTRY ?? process.argv[1];
  if (!entry) throw new Error('Unable to determine the CLI entry path for a shell worker');
  return { command: process.execPath, args: [entry, '_shell_worker', id] };
}

export async function startShellTask(options: { command: string; args?: string[]; cwd: string; config: PlatformConfig; actor?: string; teamSessionId?: string }): Promise<ShellTaskRecord> {
  if (options.config.ephemeralSession) throw new Error('Background shell tasks are disabled in no-session-persistence mode');
  const cwd = protectPath(resolve(options.cwd), options.config);
  const args = options.args ?? [];
  authorizeCommand(options.command, args, options.config);
  if (options.config.policy.mode !== 'bypass') await runHooks(options.config, 'PermissionRequest', { action: 'background-command', command: options.command, args, cwd, actor: options.actor }, cwd);
  const id = createId('shell');
  const directory = join(homeStateDir(), 'shell-task-output', id);
  await mkdir(directory, { recursive: true });
  const now = new Date().toISOString();
  const record: ShellTaskRecord = {
    id, command: options.command, args, cwd, ...(options.actor ? { actor: options.actor } : {}), ...(options.teamSessionId ? { teamSessionId: options.teamSessionId } : {}), status: 'queued',
    stdoutPath: join(directory, 'stdout.log'), stderrPath: join(directory, 'stderr.log'), createdAt: now, updatedAt: now,
  };
  await saveShellTask(record);
  await writeJson(runtimePath(id), { config: options.config } satisfies ShellTaskRuntime);
  const invocation = workerInvocation(id);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    detached: true,
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
    env: sanitizedEnvironment(options.config.policy.mode, Object.fromEntries(['CCPT_HOME', 'CCPT_MANAGED_CONFIG', 'CCPT_CLI_ENTRY'].flatMap((name) => process.env[name] ? [[name, process.env[name]]] : [])), options.config.policy.allowedEnvironmentVariables, modelCredentialNames(options.config)),
  });
  await new Promise<void>((resolvePromise, reject) => { child.once('spawn', resolvePromise); child.once('error', reject); });
  child.unref();
  await audit({ event: 'shell-task.started', ...(options.actor ? { actor: options.actor } : {}), outcome: 'success', details: { id, command: options.command, args, cwd: relative(process.cwd(), cwd) } });
  return record;
}

export async function runShellTaskWorker(id: string): Promise<void> {
  const record = await loadShellTask(id);
  if (record.status !== 'queued') return;
  const runtime = await readJson<ShellTaskRuntime | null>(runtimePath(id), null);
  if (!runtime) throw new Error(`Shell task runtime not found: ${id}`);
  authorizeCommand(record.command, record.args, runtime.config);
  const claimed = await mutateShellTask(id, (current) => { if (current.status !== 'queued') return; current.status = 'running'; current.workerPid = process.pid; });
  if (claimed.status !== 'running' || claimed.workerPid !== process.pid) return;
  const wrapper = runtime.config.policy.processWrapper;
  const child = spawn(wrapper ?? record.command, wrapper ? [record.command, ...record.args] : record.args, {
    cwd: record.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: sanitizedEnvironment(runtime.config.policy.mode, {}, runtime.config.policy.allowedEnvironmentVariables, modelCredentialNames(runtime.config)),
  });
  const controller = new AbortController();
  const control = controlProcess(child, runtime.config.policy.commandTimeoutMs, controller.signal);
  let checking = false;
  const poll = setInterval(() => {
    if (checking) return;
    checking = true;
    void loadShellTask(id).then((current) => { if (current.status === 'cancelled') controller.abort(); }).catch(() => {}).finally(() => { checking = false; });
  }, 200);
  let outputWrites = Promise.resolve();
  let writeError: string | undefined;
  for (const [stream, path] of [[child.stdout, record.stdoutPath], [child.stderr, record.stderrPath]] as const) {
    stream.on('data', (chunk) => {
      stream.pause();
      outputWrites = outputWrites.then(() => appendFile(path, chunk)).catch((error: unknown) => { writeError = String(error); controller.abort(); }).finally(() => { stream.resume(); });
    });
  }
  // Attach error/close listeners before awaiting disk I/O (spawn may fail immediately).
  const completion = new Promise<{ code: number; error?: string }>((resolvePromise) => {
    child.once('error', (error) => resolvePromise({ code: 1, error: error.message }));
    child.once('close', (code) => resolvePromise({ code: code ?? 1 }));
  });
  const commandPid = child.pid;
  if (commandPid) await mutateShellTask(id, (current) => { current.commandPid = commandPid; });
  const outcome = await completion;
  clearInterval(poll);
  control.dispose();
  await outputWrites;
  if (control.error() || writeError) { outcome.code = 1; outcome.error = writeError ?? control.error()!.message; }
  await withFileLock(join(homeStateDir(), 'locks', `shell-${id}.lock`), async () => {
    const current = await loadShellTask(id);
    if (current.status === 'cancelled') return;
    current.status = outcome.code === 0 ? 'completed' : 'failed';
    current.exitCode = outcome.code;
    current.completedAt = new Date().toISOString();
    if (outcome.error) current.error = outcome.error;
    await saveShellTask(current);
  });
  await audit({ event: 'shell-task.completed', ...(record.actor ? { actor: record.actor } : {}), outcome: outcome.code === 0 ? 'success' : 'failure', details: { id, code: outcome.code } });
}

async function tail(path: string, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  try {
    const text = await readFile(path, 'utf8');
    return text.length > maxChars ? { text: text.slice(-maxChars), truncated: true } : { text, truncated: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', truncated: false };
    throw error;
  }
}

export async function getShellTaskOutput(id: string, maxChars = 100_000, teamSessionId?: string): Promise<{ task: ShellTaskRecord; stdout: string; stderr: string; truncated: boolean }> {
  const task = await loadShellTask(id);
  if (teamSessionId && task.teamSessionId !== teamSessionId) throw new Error('Shell task is outside the active team scope');
  const limit = Math.max(1_000, Math.min(maxChars, 1_000_000));
  const [stdout, stderr] = await Promise.all([tail(task.stdoutPath, limit), tail(task.stderrPath, limit)]);
  return { task, stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated };
}

export async function stopShellTask(id: string, teamSessionId?: string): Promise<ShellTaskRecord> {
  return withFileLock(join(homeStateDir(), 'locks', `shell-${id}.lock`), async () => {
    const task = await loadShellTask(id);
    if (teamSessionId && task.teamSessionId !== teamSessionId) throw new Error('Shell task is outside the active team scope');
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;
    // The live worker observes this state and terminates its owned process tree.
    // Persisted PIDs may have been recycled and must never be killed blindly.
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    await saveShellTask(task);
    await audit({ event: 'shell-task.stopped', ...(task.actor ? { actor: task.actor } : {}), outcome: 'success', details: { id } });
    return task;
  });
}
