import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, forkSession, loadSession } from '../src/sessions.js';
import { getMemory, listMemory, setMemory } from '../src/memory.js';
import { compactMessages, compactSession } from '../src/sessions.js';
import { claimTask, createTask, listTasks, updateTask } from '../src/tasks.js';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from '../src/checkpoints.js';
import { defaultConfig } from '../src/config.js';
import { readJson, writeJson } from '../src/storage.js';

let state = '';

beforeAll(async () => {
  state = await mkdtemp(join(tmpdir(), 'agentic-state-'));
  process.env.CCPT_HOME = state;
});

afterAll(async () => {
  delete process.env.CCPT_HOME;
  await rm(state, { recursive: true, force: true });
});

describe('persistent state', () => {
  test('serializes high-frequency atomic writes to one Windows state path', async () => {
    const path = join(state, 'stream-state.json');
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeJson(path, { index, text: 'x'.repeat(index) })));
    const saved = await readJson<{ index: number; text: string }>(path, { index: -1, text: '' });
    expect(saved.index).toBe(99);
    expect(saved.text).toHaveLength(99);
  });

  test('forks sessions without sharing mutable message arrays', async () => {
    const source = await createSession('source', process.cwd());
    source.messages.push({ role: 'user', content: 'architecture decision' });
    const { saveSession } = await import('../src/sessions.js');
    await saveSession(source);
    const fork = await forkSession(source.id);
    fork.messages.push({ role: 'assistant', content: 'independent branch' });
    expect((await loadSession(source.id)).messages).toHaveLength(1);
    expect(fork.parentId).toBe(source.id);
  });

  test('stores scoped durable memory', async () => {
    await setMemory('testing', 'framework', 'Use Bun test');
    expect(await getMemory('testing', 'framework')).toBe('Use Bun test');
    expect(await listMemory('testing')).toEqual(['framework']);
  });

  test('compacts old context while preserving recent messages', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({ role: 'user' as const, content: `${index}:${'x'.repeat(500)}` }));
    const compacted = compactMessages(messages, 500);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(JSON.stringify(compacted)).toContain('19:');
    expect(JSON.stringify(compacted)).toContain('Context compacted');
  });

  test('archives compacted messages and carries summaries into forks', async () => {
    const session = await createSession('long task', process.cwd());
    session.messages = Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `${index}:${'context '.repeat(150)}` }));
    compactSession(session, 1_000);
    const archivedCount = session.archivedMessages?.length ?? 0;
    expect(archivedCount).toBeGreaterThan(0);
    expect(session.summary).toContain('0:');
    const firstSummary = session.summary;
    compactSession(session, 600);
    expect(session.archivedMessages?.filter((message) => typeof message.content === 'string' && message.content.startsWith('[Earlier conversation summary]'))).toHaveLength(0);
    await (await import('../src/sessions.js')).saveSession(session);
    const fork = await forkSession(session.id);
    expect(fork.summary).toBe(session.summary);
    expect(fork.archivedMessages?.length).toBeGreaterThanOrEqual(archivedCount);
    expect(firstSummary).toBeDefined();
  });

  test('persists dependency-aware team tasks', async () => {
    const session = await createSession('team work', process.cwd());
    const first = await createTask({ teamSessionId: session.id, title: 'Design the change' });
    const second = await createTask({ teamSessionId: session.id, title: 'Implement the change', dependencies: [first.id] });
    await expect(updateTask(second.id, { status: 'in_progress' })).rejects.toThrow('dependency is not complete');
    await updateTask(first.id, { status: 'completed', result: 'Design approved' });
    expect((await updateTask(second.id, { status: 'in_progress' })).status).toBe('in_progress');
    expect((await listTasks(session.id)).map((task) => task.id)).toContain(second.id);
  });

  test('restores code and conversation checkpoints', async () => {
    const workspace = join(state, 'checkpoint-workspace');
    await mkdir(workspace, { recursive: true });
    const existing = join(workspace, 'existing.txt');
    const created = join(workspace, 'created.txt');
    await writeFile(existing, 'before', 'utf8');
    const session = await createSession('checkpoint conversation', workspace);
    session.messages.push({ role: 'user', content: 'before edit' });
    await (await import('../src/sessions.js')).saveSession(session);
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [workspace];
    const checkpoint = await createCheckpoint({ cwd: workspace, config, files: [existing, created], sessionId: session.id, reason: 'test snapshot' });
    await writeFile(existing, 'after', 'utf8');
    await writeFile(created, 'new', 'utf8');
    session.messages.push({ role: 'assistant', content: 'after edit' });
    await (await import('../src/sessions.js')).saveSession(session);
    await restoreCheckpoint({ cwd: workspace, config, id: checkpoint.id, restoreConversation: true });
    expect(await readFile(existing, 'utf8')).toBe('before');
    await expect(access(created)).rejects.toThrow();
    expect((await loadSession(session.id)).messages).toHaveLength(1);
    expect((await listCheckpoints(workspace))[0]?.id).toBe(checkpoint.id);
    expect(checkpoint.entries[0]?.backupFileName).toMatch(/^blobs\/[a-f0-9]{64}\.bin$/);
  });

  test('claims dependency-ready tasks atomically', async () => {
    const session = await createSession('claim tasks', process.cwd());
    const task = await createTask({ teamSessionId: session.id, title: 'Exclusive work' });
    const claims = await Promise.allSettled([
      claimTask(task.id, session.id, 'agent_1111111111111111'),
      claimTask(task.id, session.id, 'agent_2222222222222222'),
    ]);
    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === 'rejected')).toHaveLength(1);
  });

  test('retains only the latest one hundred versioned checkpoints', async () => {
    const workspace = join(state, 'retention-workspace');
    await mkdir(workspace, { recursive: true });
    const file = join(workspace, 'tracked.txt');
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [workspace];
    for (let index = 0; index < 102; index += 1) {
      await writeFile(file, String(index), 'utf8');
      await createCheckpoint({ cwd: workspace, config, files: [file], reason: `snapshot ${index}` });
    }
    expect(await listCheckpoints(workspace)).toHaveLength(100);
  });
});
