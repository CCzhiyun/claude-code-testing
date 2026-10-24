import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { continueAgent, loadAgent, saveAgent, spawnAgent, waitForAgent } from '../src/agent.js';
import { defaultConfig } from './legacyFixtureConfig.js';
import { createId, writeJson } from '../src/storage.js';
import { loadSession } from '../src/sessions.js';
import { createTask, loadTask, updateTask } from '../src/tasks.js';
import { discoverTeam, readTeamMailbox, sendTeamMessage } from '../src/mailbox.js';
import type { RuntimeEvent } from '../src/runtimeEvents.js';

let workspace = '';
let server: ReturnType<typeof Bun.serve>;
let calls = 0;
let previousCliEntry: string | undefined;
let previousHome: string | undefined;
let previousKey: string | undefined;
let completedAgentId = '';

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ccpt-operation-'));
  previousHome = process.env.CCPT_HOME;
  previousKey = process.env.CCPT_API_KEY;
  process.env.CCPT_HOME = join(workspace, 'state');
  process.env.CCPT_API_KEY = 'test-only';
  previousCliEntry = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '..', 'src', 'cli.ts');
  server = Bun.serve({
    port: 0,
    async fetch() {
      calls += 1;
      if (calls === 1) {
        return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'result.txt', content: 'CCPT operation succeeded' }) } }] }, finish_reason: 'tool_calls' }] });
      }
      if (calls === 4) await Bun.sleep(300);
      return Response.json({ choices: [{ message: { content: calls === 2 ? 'File operation completed.' : 'Conversation continued.' }, finish_reason: 'stop' }] });
    },
  });
  const config = structuredClone(defaultConfig);
  config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.policy.workspaceRoots = [workspace];
  config.agents.defaultIsolation = 'none';
  await writeJson(join(workspace, '.ccpt', 'settings.json'), config);
});

afterAll(async () => {
  server.stop(true);
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  if (previousKey === undefined) delete process.env.CCPT_API_KEY; else process.env.CCPT_API_KEY = previousKey;
  if (previousCliEntry === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = previousCliEntry;
  await rm(workspace, { recursive: true, force: true });
});

describe.serial('coding agent operation loop', () => {
  test('uses a model tool call to modify the workspace', async () => {
    const config = structuredClone(defaultConfig);
    config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.policy.workspaceRoots = [workspace];
    config.agents.defaultIsolation = 'none';
    const phases: string[] = [];
    const events: RuntimeEvent[] = [];
    const agent = await spawnAgent({ goal: 'Create the requested result file', cwd: workspace, config, isolation: 'none', background: false, onStream: (update) => { phases.push(update.phase); }, onEvent: (event) => { events.push(event); } });
    completedAgentId = agent.id;
    expect(agent.status).toBe('completed');
    expect(await readFile(join(workspace, 'result.txt'), 'utf8')).toBe('CCPT operation succeeded');
    expect(phases).toContain('tool');
    expect(phases).toContain('responding');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['agent_status', 'turn_started', 'tool_started', 'tool_completed', 'text_delta', 'usage_updated', 'agent_completed']));
    expect(events.filter((event) => event.type === 'agent_status').map((event) => event.status)).toEqual(expect.arrayContaining(['queued', 'working', 'completed']));
    expect(events.every((event) => event.agentId === agent.id && event.sessionId === agent.sessionId)).toBe(true);
    const continued = await continueAgent(agent.id, 'Continue in the same conversation');
    expect(continued.id).toBe(agent.id);
    expect(continued.result).toBe('Conversation continued.');
  });

  test('runs a detached worker without overwriting its terminal status and reserves concurrency atomically', async () => {
    const config = structuredClone(defaultConfig);
    config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.policy.workspaceRoots = [workspace];
    config.agents.defaultIsolation = 'none';
    config.agents.maxConcurrent = 1;
    const agent = await spawnAgent({ goal: 'Complete in a detached worker', cwd: workspace, config, isolation: 'none', background: true });
    expect(agent.status).toBe('queued');
    await expect(spawnAgent({ goal: 'Must wait for the active slot', cwd: workspace, config, isolation: 'none', background: true })).rejects.toThrow('Maximum concurrent agent limit');
    const completed = await waitForAgent(agent.id, 10_000);
    expect(completed.status).toBe('completed');
    expect(typeof completed.pid).toBe('number');
    const continued = await continueAgent(agent.id, 'Continue asynchronously while the terminal stays interactive', { background: true });
    expect(continued.status).toBe('queued');
    expect((await waitForAgent(agent.id, 10_000)).status).toBe('completed');
  }, 30_000); // Two real detached workers; each existing wait is bounded to 10s.

  test('passes the configured Anthropic authorization token to a detached Skill Agent', async () => {
    const previousToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const settingsPath = join(workspace, '.ccpt', 'settings.json');
    const previousSettings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    process.env.ANTHROPIC_AUTH_TOKEN = '';
    let authorization = '';
    const anthropicServer = Bun.serve({
      port: 0,
      async fetch(request) {
        authorization = request.headers.get('authorization') ?? '';
        return Response.json({ content: [{ type: 'text', text: 'Authorized Skill Agent response.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
      },
    });
    try {
      const config = structuredClone(defaultConfig);
      config.model.provider = 'anthropic';
      config.model.baseUrl = `http://127.0.0.1:${anthropicServer.port}`;
      config.policy.workspaceRoots = [workspace];
      config.agents.defaultIsolation = 'none';
      await writeJson(settingsPath, { ...config, env: { ANTHROPIC_AUTH_TOKEN: 'settings-child-token' } });
      const started = await spawnAgent({ goal: 'Run a configured Skill', cwd: workspace, config, isolation: 'none', background: true, skills: ['test-skill'] });
      const completed = await waitForAgent(started.id, 10_000);
      expect(completed.status).toBe('completed');
      expect(completed.result).toBe('Authorized Skill Agent response.');
      expect(authorization).toBe('Bearer settings-child-token');
    } finally {
      anthropicServer.stop(true);
      await writeJson(settingsPath, previousSettings);
      if (previousToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = previousToken;
    }
  });

  test('derives nested depth from the parent instead of trusting caller input', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [workspace];
    config.agents.defaultIsolation = 'none';
    config.agents.maxDepth = 0;
    await expect(spawnAgent({ goal: 'Attempt depth bypass', cwd: workspace, config, parentId: completedAgentId, depth: 0, isolation: 'none', background: false })).rejects.toThrow('Maximum delegation depth');
  });

  test('gives delegated Agents independent context while retaining team and task lineage', async () => {
    const config = structuredClone(defaultConfig);
    config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.policy.workspaceRoots = [workspace];
    config.agents.defaultIsolation = 'none';
    config.agents.maxDepth = 1;
    const parent = await loadAgent(completedAgentId);
    const child = await spawnAgent({ goal: 'Inspect independently', cwd: workspace, config, parentId: parent.id, isolation: 'none', background: true });
    expect(child.sessionId).not.toBe(parent.sessionId);
    expect(child.teamSessionId).toBe(parent.teamSessionId);
    expect((await loadSession(child.sessionId)).parentId).toBe(parent.sessionId);
    const completed = await waitForAgent(child.id, 10_000);
    expect(completed.status).toBe('completed');
    expect(completed.taskId).toBeDefined();
    expect((await loadTask(completed.taskId as string)).status).toBe('completed');
  });

  test('publishes completed Agents only after their linked task and does not overwrite cancellation', async () => {
    const template = await loadAgent(completedAgentId);
    for (const cancelled of [false, true]) {
      const task = await createTask({ teamSessionId: template.teamSessionId!, title: 'Completion ordering' });
      const record = { ...template, id: createId('agent'), taskId: task.id, status: 'working' as const };
      await saveAgent(record);
      if (cancelled) {
        await saveAgent({ ...record, status: 'cancelled' });
        await updateTask(task.id, { status: 'cancelled' });
      }
      await saveAgent({ ...record, status: 'completed', result: 'done' });
      expect((await loadAgent(record.id)).status).toBe(cancelled ? 'cancelled' : 'completed');
      expect((await loadTask(task.id)).status).toBe(cancelled ? 'cancelled' : 'completed');
      if (!cancelled) expect((await loadTask(task.id)).result).toBe('done');
    }
  });

  test('forks parent context into an independent session and blocks recursive forks', async () => {
    const config = structuredClone(defaultConfig);
    config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.policy.workspaceRoots = [workspace];
    config.agents.defaultIsolation = 'none';
    config.agents.maxDepth = 2;
    const parent = await loadAgent(completedAgentId);
    const parentSession = await loadSession(parent.sessionId);
    const fork = await spawnAgent({ goal: 'Use inherited evidence', cwd: workspace, config, parentId: parent.id, contextMode: 'fork', isolation: 'none', background: true });
    const forkSession = await loadSession(fork.sessionId);
    expect(fork.contextMode).toBe('fork');
    expect(fork.sessionId).not.toBe(parent.sessionId);
    expect(forkSession.messages.length).toBeGreaterThan(parentSession.messages.length);
    expect(JSON.stringify(forkSession.messages)).toContain('Forked Agent directive');
    await waitForAgent(fork.id, 10_000);
    await expect(spawnAgent({ goal: 'Recursive fork', cwd: workspace, config, parentId: fork.id, contextMode: 'fork', isolation: 'none', background: false })).rejects.toThrow('cannot recursively fork');
  });

  test('discovers team members and exchanges durable direct messages', async () => {
    const parent = await loadAgent(completedAgentId);
    const members = await discoverTeam(parent.teamSessionId ?? parent.sessionId);
    const child = members.find((member) => member.parentId === parent.id);
    expect(child).toBeDefined();
    const sent = await sendTeamMessage({ teamSessionId: parent.teamSessionId ?? parent.sessionId, fromAgentId: parent.id, toAgentId: child!.id, content: 'Review the shared task state' });
    const unread = await readTeamMailbox({ teamSessionId: parent.teamSessionId ?? parent.sessionId, agentId: child!.id, unreadOnly: true, markRead: true });
    expect(unread.map((message) => message.id)).toContain(sent.id);
    expect(await readTeamMailbox({ teamSessionId: parent.teamSessionId ?? parent.sessionId, agentId: child!.id, unreadOnly: true })).toHaveLength(0);
  });
});
