import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homeStateDir } from './paths.js';
import { protectPath } from './policy.js';
import { createId, readJson, writeJson } from './storage.js';
import { assertSessionIdle, loadSession, saveSession } from './sessions.js';
import { runHooks } from './hooks.js';
import { notifyLifecycle } from './lifecycleNotifications.js';
import type { CheckpointEntry, CheckpointRecord, PlatformConfig, SessionRecord } from './types.js';

const ignoredDirectories = new Set(['.git', '.ccpt', '.ccpt-worktrees', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target']);
const maximumSnapshots = 100;

interface CheckpointIndex {
  ids: string[];
  versions: Record<string, number>;
  snapshotSequence: number;
}

function workspaceKey(cwd: string): string {
  return createHash('sha256').update(resolve(cwd).toLowerCase()).digest('hex').slice(0, 24);
}

function checkpointPath(cwd: string, id: string): string {
  if (!/^checkpoint_[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid checkpoint id: ${id}`);
  return join(homeStateDir(), 'checkpoints', workspaceKey(cwd), `${id}.json`);
}

function checkpointDirectory(cwd: string): string {
  return join(homeStateDir(), 'checkpoints', workspaceKey(cwd));
}

function checkpointIndexPath(cwd: string): string {
  return join(checkpointDirectory(cwd), 'index.json');
}

function safeBackupPath(cwd: string, name: string): string {
  if (!/^blobs\/[a-f0-9]{64}\.bin$/.test(name)) throw new Error(`Invalid checkpoint backup name: ${name}`);
  return join(checkpointDirectory(cwd), ...name.split('/'));
}

async function writeBackup(cwd: string, content: Buffer): Promise<string> {
  const name = `blobs/${createHash('sha256').update(content).digest('hex')}.bin`;
  const path = safeBackupPath(cwd, name);
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, content, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return name;
}

async function directoryRecords(cwd: string): Promise<CheckpointRecord[]> {
  const directory = checkpointDirectory(cwd);
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const records = await Promise.all(names.filter((name) => /^checkpoint_[a-f0-9]{16}\.json$/.test(name)).map((name) => readJson<CheckpointRecord | null>(join(directory, name), null)));
  return records.filter((record): record is CheckpointRecord => record !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function loadCheckpointIndex(cwd: string): Promise<CheckpointIndex> {
  const existing = await readJson<CheckpointIndex | null>(checkpointIndexPath(cwd), null);
  if (existing && Array.isArray(existing.ids) && existing.versions && typeof existing.snapshotSequence === 'number') return existing;
  const records = await directoryRecords(cwd);
  const versions: Record<string, number> = {};
  for (const record of [...records].reverse()) for (const entry of record.entries) versions[entry.path] = Math.max(versions[entry.path] ?? 0, entry.version ?? 0);
  const index = { ids: records.map((record) => record.id), versions, snapshotSequence: records.length };
  await writeJson(checkpointIndexPath(cwd), index);
  return index;
}

async function updateIndexAndPrune(cwd: string, checkpoint: CheckpointRecord, index: CheckpointIndex): Promise<void> {
  index.ids = [checkpoint.id, ...index.ids.filter((id) => id !== checkpoint.id)];
  index.snapshotSequence += 1;
  for (const entry of checkpoint.entries) index.versions[entry.path] = entry.version ?? index.versions[entry.path] ?? 0;
  const removed = index.ids.splice(maximumSnapshots);
  await writeJson(checkpointIndexPath(cwd), index);
  if (removed.length === 0) return;
  await Promise.all(removed.map((id) => rm(checkpointPath(cwd, id), { force: true })));
  const kept = (await Promise.all(index.ids.map((id) => readJson<CheckpointRecord | null>(checkpointPath(cwd, id), null)))).filter((record): record is CheckpointRecord => record !== null);
  const referenced = new Set(kept.flatMap((record) => record.entries.map((entry) => entry.backupFileName).filter((value): value is string => Boolean(value))));
  for (const record of kept) if (record.conversationBackupFileName) referenced.add(record.conversationBackupFileName);
  const blobDirectory = join(checkpointDirectory(cwd), 'blobs');
  let blobs: string[];
  try { blobs = await readdir(blobDirectory); } catch { return; }
  await Promise.all(blobs.filter((name) => !referenced.has(`blobs/${name}`)).map((name) => rm(join(blobDirectory, name), { force: true })));
}

async function collectFiles(directory: string, config: PlatformConfig, output: string[], limits: { files: number; bytes: number }): Promise<void> {
  if (output.length >= limits.files || limits.bytes <= 0) return;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (output.length >= limits.files || limits.bytes <= 0) return;
    if (entry.isSymbolicLink() || ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    try { protectPath(path, config); } catch { continue; }
    if (entry.isDirectory()) await collectFiles(path, config, output, limits);
    else if (entry.isFile()) {
      const info = await stat(path);
      if (info.size > 20_000_000 || info.size > limits.bytes) continue;
      output.push(path);
      limits.bytes -= info.size;
    }
  }
}

export async function createCheckpoint(options: {
  cwd: string;
  config: PlatformConfig;
  files?: string[];
  sessionId?: string;
  agentId?: string;
  reason?: string;
}): Promise<CheckpointRecord> {
  const workspace = resolve(options.cwd);
  const selected = options.files === undefined ? [] : options.files.map((path) => resolve(path));
  if (options.files === undefined) await collectFiles(workspace, options.config, selected, { files: 5_000, bytes: 100_000_000 });
  const unique = [...new Set(selected)];
  const entries: CheckpointEntry[] = [];
  const index = await loadCheckpointIndex(workspace);
  for (const candidate of unique) {
    const path = protectPath(candidate, options.config);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (info.size > 20_000_000) throw new Error(`Checkpoint file exceeds 20 MB: ${path}`);
      const content = await readFile(path);
      const priorVersion = index.versions[path] ?? 0;
      entries.push({ path, existed: true, backupFileName: await writeBackup(workspace, content), version: priorVersion + 1, backupTime: new Date().toISOString(), mode: info.mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const priorVersion = index.versions[path] ?? 0;
        entries.push({ path, existed: false, version: priorVersion + 1, backupTime: new Date().toISOString() });
      }
      else throw error;
    }
  }
  const checkpoint: CheckpointRecord = {
    id: createId('checkpoint'),
    workspace,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    reason: options.reason ?? 'Manual checkpoint',
    createdAt: new Date().toISOString(),
    entries,
  };
  if (options.sessionId) {
    const session = await loadSession(options.sessionId);
    // A before-edit checkpoint can be taken while a tool batch has no results yet.
    // Rewind to before that batch, not to an orphaned tool_use that breaks resume.
    const results = new Set(session.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((block) => block.type === 'tool_result').map((block) => block.tool_use_id) : []));
    const pendingIndex = session.messages.findIndex((message) => message.role === 'assistant' && Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_use' && !results.has(block.id)));
    const messages = pendingIndex < 0 ? session.messages : session.messages.slice(0, pendingIndex);
    checkpoint.sessionMessageCount = messages.length;
    checkpoint.conversationBackupFileName = await writeBackup(workspace, Buffer.from(JSON.stringify({ sessionId: session.id, messages, archivedMessages: session.archivedMessages ?? [], summary: session.summary ?? '' })));
  }
  await writeJson(checkpointPath(workspace, checkpoint.id), checkpoint);
  await updateIndexAndPrune(workspace, checkpoint, index);
  await runHooks(options.config, 'CheckpointCreated', { checkpointId: checkpoint.id, files: entries.map((entry) => entry.path), reason: checkpoint.reason }, workspace);
  return checkpoint;
}

export async function createTurnCheckpoint(options: {
  cwd: string;
  config: PlatformConfig;
  sessionId: string;
  agentId: string;
}): Promise<CheckpointRecord> {
  const tracked = [...new Set((await listCheckpoints(options.cwd)).flatMap((record) => record.entries.map((entry) => entry.path)))];
  return createCheckpoint({ ...options, files: tracked, reason: `Conversation turn ${((await loadSession(options.sessionId)).messages.length) + 1}` });
}

export async function loadCheckpoint(cwd: string, id: string): Promise<CheckpointRecord> {
  const checkpoint = await readJson<CheckpointRecord | null>(checkpointPath(cwd, id), null);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${id}`);
  if (resolve(checkpoint.workspace) !== resolve(cwd)) throw new Error('Checkpoint belongs to another workspace');
  return checkpoint;
}

export async function listCheckpoints(cwd: string): Promise<CheckpointRecord[]> {
  const index = await loadCheckpointIndex(cwd);
  const records = await Promise.all(index.ids.map((id) => readJson<CheckpointRecord | null>(checkpointPath(cwd, id), null)));
  return records.filter((record): record is CheckpointRecord => record !== null);
}

export async function restoreCheckpoint(options: {
  cwd: string;
  config: PlatformConfig;
  id?: string;
  restoreCode?: boolean;
  restoreConversation?: boolean;
}): Promise<CheckpointRecord> {
  const id = options.id ?? (await listCheckpoints(options.cwd))[0]?.id;
  if (!id) throw new Error('No checkpoint is available for this workspace');
  const checkpoint = await loadCheckpoint(options.cwd, id);
  let conversation: SessionRecord | undefined;
  // Validate the conversation before changing any code: legacy offsets are unsafe after compaction.
  if (options.restoreConversation) {
    if (!checkpoint.sessionId || checkpoint.sessionMessageCount === undefined) throw new Error('Checkpoint has no conversation snapshot');
    await assertSessionIdle(checkpoint.sessionId);
    conversation = await loadSession(checkpoint.sessionId);
    if (checkpoint.conversationBackupFileName) {
      const snapshot = JSON.parse(await readFile(safeBackupPath(checkpoint.workspace, checkpoint.conversationBackupFileName), 'utf8'));
      if (snapshot.sessionId !== conversation.id || !Array.isArray(snapshot.messages) || !Array.isArray(snapshot.archivedMessages) || typeof snapshot.summary !== 'string') throw new Error('Invalid conversation checkpoint snapshot');
      conversation.messages = snapshot.messages;
      conversation.archivedMessages = snapshot.archivedMessages;
      if (snapshot.summary) conversation.summary = snapshot.summary; else delete conversation.summary;
    } else {
      if (conversation.archivedMessages?.length || conversation.messages.length < checkpoint.sessionMessageCount) throw new Error('Legacy checkpoint cannot safely restore a compacted conversation. Code-only restore is still available.');
      conversation.messages = conversation.messages.slice(0, checkpoint.sessionMessageCount);
    }
    delete conversation.contextSnapshot;
  }
  if (options.restoreCode !== false) {
    for (const entry of checkpoint.entries) {
      const path = protectPath(entry.path, options.config);
      if (entry.existed) {
        await mkdir(dirname(path), { recursive: true });
        const content = entry.backupFileName
          ? await readFile(safeBackupPath(checkpoint.workspace, entry.backupFileName))
          : Buffer.from(entry.contentBase64 ?? '', 'base64');
        await writeFile(path, content);
        if (entry.mode !== undefined) await chmod(path, entry.mode);
      } else {
        await rm(path, { force: true });
      }
      await notifyLifecycle(options.config, options.cwd, 'FileChanged', { path, change: entry.existed ? 'modified' : 'deleted', tool:'checkpoint_restore', checkpointId:checkpoint.id, sessionId:checkpoint.sessionId, agentId:checkpoint.agentId });
    }
  }
  if (conversation) await saveSession(conversation);
  await runHooks(options.config, 'CheckpointRestored', { checkpointId: checkpoint.id, restoreCode: options.restoreCode !== false, restoreConversation: options.restoreConversation === true }, checkpoint.workspace);
  return checkpoint;
}
