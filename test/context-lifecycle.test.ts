import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { contextLimits, conversationBudget, formatContextSnapshot, measureContext } from '../src/contextBudget.js';
import { QueryEngine } from '../src/QueryEngine.js';
import { compactSession, createSession, fullSessionMessages, loadSession, saveSession } from '../src/sessions.js';
import { exportSession, renderSessionExport } from '../src/sessionExport.js';
import { estimateTokens } from '../src/tokenUsage.js';
import { spawnAgent } from '../src/agent.js';
import { writeJson } from '../src/storage.js';
import { createCheckpoint, restoreCheckpoint } from '../src/checkpoints.js';
import type { ModelMessage, SessionRecord } from '../src/types.js';

function turns(count: number): ModelMessage[] {
  return Array.from({ length: count }, (_, index): ModelMessage[] => [
    { role: 'user', content: `Request ${index}: ${'architecture '.repeat(80)}` },
    { role: 'assistant', content: [{ type: 'tool_use', id: `read-${index}`, name: 'read_file', input: { path: 'README.md' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `read-${index}`, content: `Result ${index}: ${'details '.repeat(80)}` }] },
    { role: 'assistant', content: `Completed ${index}.` },
  ]).flat();
}

const sessionFixture = (messages: ModelMessage[]): SessionRecord => ({ id: 'session_1111111111111111', title: 'Lifecycle', cwd: process.cwd(), createdAt: '', updatedAt: '', messages });

test('request budget counts tools/system and reserves output; over-budget requests never call the provider', async () => {
  const config = structuredClone(defaultConfig);
  config.model.maxContextTokens = 2000; config.model.maxOutputTokens = 500;
  const limits = contextLimits(config.model);
  expect(limits).toEqual({ inputBudget: 1372, outputReserve: 500, safetyReserve: 128 });
  const tools = [{ name: 'read', description: 'Read a file', input_schema: { type: 'object' } }];
  const system = 'System instructions. 技能内容 Repository memory';
  expect(conversationBudget(config.model, system, tools)).toBeLessThan(limits.inputBudget);
  const snapshot = measureContext(config.model, system, [{ role: 'user', content: 'Hi' }], tools, { skills: '技能内容', memory: 'memory', repository: 'Repository' });
  expect(snapshot.sections.reduce((sum, part) => sum + part.tokens, 0)).toBe(snapshot.estimatedInput);
  expect(formatContextSnapshot(snapshot)).toContain('Output reserve: 500');
  expect(JSON.stringify(snapshot)).not.toContain('技能内容');
  let calls = 0;
  const engine = new QueryEngine(config, { now: Date.now, async callModel() { calls++; return { content: [{ type: 'text', text: 'Done' }] }; } });
  await expect(engine.query(system, [{ role: 'user', content: '界'.repeat(1500) }], tools)).rejects.toThrow('latest user turn was not silently truncated');
  expect(calls).toBe(0);
  await engine.query(system, [{ role: 'user', content: 'Small request' }], tools);
  expect(calls).toBe(1);
});

test('repeated compaction preserves complete tool exchanges, latest turn and exact original history', () => {
  const original = turns(18);
  const session = sessionFixture(structuredClone(original));
  compactSession(session, 5000);
  expect(session.archivedMessages!.length).toBeGreaterThan(0);
  expect(estimateTokens(session.messages)).toBeLessThan(5000);
  const archiveCount = session.archivedMessages!.length;
  compactSession(session, 2200, { force: true });
  expect(session.archivedMessages!.length).toBeGreaterThanOrEqual(archiveCount);
  expect(fullSessionMessages(session)).toEqual(original);
  const blocks = session.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
  expect(blocks.filter((block) => block.type === 'tool_use').map((block) => block.id)).toEqual(blocks.filter((block) => block.type === 'tool_result').map((block) => block.tool_use_id));
  expect(session.messages.slice(-4)).toEqual(original.slice(-4));
  const serialized = JSON.stringify(session);
  compactSession(session, 100000);
  expect(JSON.stringify(session)).toBe(serialized);
  expect(JSON.parse(renderSessionExport(session, 'json')).messages).toEqual(original);
  expect(renderSessionExport(session, 'markdown')).toContain('Request 0:');
  expect(renderSessionExport(session, 'markdown')).toContain('Completed 17.');
  expect(renderSessionExport(session, 'markdown')).not.toContain('[Earlier conversation summary]');
});

test('one oversized active turn is retained intact rather than silently destroying tool results', () => {
  const session = sessionFixture(turns(1));
  const original = structuredClone(session.messages);
  compactSession(session, 100, { force: true });
  expect(session.messages).toEqual(original);
  expect(session.archivedMessages).toBeUndefined();
});

test('conversation checkpoints restore exact history across compaction, later turns and rewind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-context-rewind-'));
  const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  try {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root]; config.hooks = [];
    const session = await createSession('Rewind fixture', root);
    session.messages = turns(10); await saveSession(session);
    const original = structuredClone(session.messages);
    const first = await createCheckpoint({ cwd: root, config, sessionId: session.id, files: [] });
    expect(first.conversationBackupFileName).toMatch(/^blobs\/[a-f0-9]{64}\.bin$/);
    compactSession(session, 2000); await saveSession(session);
    const compacted = structuredClone(session);
    const second = await createCheckpoint({ cwd: root, config, sessionId: session.id, files: [] });
    session.messages.push({ role: 'user', content: 'Future message that must not survive rewind' });
    await saveSession(session);
    await restoreCheckpoint({ cwd: root, config, id: first.id, restoreCode: false, restoreConversation: true });
    expect(fullSessionMessages(await loadSession(session.id))).toEqual(original);
    expect((await loadSession(session.id)).summary).toBeUndefined();
    await restoreCheckpoint({ cwd: root, config, id: second.id, restoreCode: false, restoreConversation: true });
    const restored = await loadSession(session.id);
    expect(restored.messages).toEqual(compacted.messages);
    expect(restored.archivedMessages).toEqual(compacted.archivedMessages);
    expect(restored.summary).toBe(compacted.summary);
    restored.messages.push({ role: 'user', content: 'Edit the file' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'unfinished', name: 'write_file', input: {} }] });
    await saveSession(restored);
    const pending = await createCheckpoint({ cwd: root, config, sessionId: session.id, files: [] });
    await restoreCheckpoint({ cwd: root, config, id: pending.id, restoreCode: false, restoreConversation: true });
    expect((await loadSession(session.id)).messages.at(-1)).toEqual({ role: 'user', content: 'Edit the file' });
  } finally {
    if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('exports do not overwrite files or bypass workspace/protected/restricted policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-export-'));
  const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
  try {
    const session = sessionFixture(turns(2));
    const target = await exportSession(session, 'exports/chat.json', root, config);
    expect(JSON.parse(await readFile(target, 'utf8')).messages).toEqual(session.messages);
    await expect(exportSession(session, 'exports/chat.json', root, config)).rejects.toThrow('already exists');
    await expect(exportSession(session, '../escape.md', root, config)).rejects.toThrow();
    await expect(exportSession(session, '.env.md', root, { ...config, policy: { ...config.policy, protectedPatterns: ['.env'] } })).rejects.toThrow('Protected path');
    await expect(exportSession(session, 'restricted.md', root, { ...config, policy: { ...config.policy, mode: 'restricted' } })).rejects.toThrow('restricted');
    await expect(exportSession(session, 'script.js', root, config)).rejects.toThrow('.md or .json');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Agent compacts full request budget then continues a real read tool round-trip and persists count-only snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-context-worker-'));
  const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ choices: [{ message: requests.length === 1 ? { content: null, tool_calls: [{ id: 'new-read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] } : { content: 'CONTEXT-ROUNDTRIP-DONE' } }] });
  } });
  try {
    const config = structuredClone(defaultConfig);
    config.model = { ...config.model, provider: 'compatible', baseUrl: `http://127.0.0.1:${server.port}/v1`, maxContextTokens: 10000, maxOutputTokens: 500 };
    config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
    config.policy.workspaceRoots = [root]; config.hooks = []; config.pluginDirectories = []; config.skillsDirectories = []; config.agentsDirectories = [];
    await writeJson(join(root, '.ccpt', 'settings.json'), config);
    await writeFile(join(root, 'README.md'), 'Context fixture ready.');
    const session = await createSession('Long history', root);
    session.messages = turns(35); await saveSession(session);
    const pressure: unknown[] = [];
    const agent = await spawnAgent({ sessionId: session.id, goal: 'Read README.md, then report.', cwd: root, config, allowedTools: ['read_file'], background: false, isolation: 'none', onEvent(event) { if (event.type === 'context_pressure') pressure.push(event.notice); } });
    expect(pressure).toHaveLength(1); expect(pressure[0]).toMatchObject({ action: 'compacted' });
    expect(agent.status).toBe('completed'); expect(agent.result).toBe('CONTEXT-ROUNDTRIP-DONE');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.find((message: any) => message.tool_call_id === 'new-read').content).toContain('Context fixture ready.');
    const saved = await loadSession(session.id);
    expect(saved.archivedMessages!.length).toBeGreaterThan(0);
    expect(fullSessionMessages(saved).slice(0, 140)).toEqual(session.messages);
    expect(saved.contextSnapshot!.tools).toBe(1);
    expect(saved.contextSnapshot!.estimatedInput + saved.contextSnapshot!.outputReserve + saved.contextSnapshot!.safetyReserve).toBeLessThanOrEqual(config.model.maxContextTokens);
    expect(JSON.stringify(saved.contextSnapshot)).not.toContain('Context fixture ready.');
  } finally {
    server.stop(true); if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
