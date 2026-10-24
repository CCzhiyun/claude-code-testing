import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { applyManagedConfiguration, defaultConfig, managedModelFields } from '../src/config.js';
import { spawnAgent, continueAgent, loadAgent } from '../src/agent.js';
import { createSession, forkSession, loadSession, saveSession } from '../src/sessions.js';
import { forkResumeState, reconcileInterruptedTools, sessionOwner, sessionResumeCommand, sameSessionWorkspace } from '../src/sessionRecovery.js';
import { sessionGitIdentity } from '../src/sessionGit.js';
import { navigateResource, resourceItems, sessionItems, type ResourceDialogState } from '../src/components/resourceDialog.js';
import { writeJson } from '../src/storage.js';
import type { AgentRecord, ModelMessage, SessionRecord } from '../src/types.js';

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-resume-state-')); const previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state');
  try { await action(root); }
  finally {
    if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup root');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
const record = (id: string, status: AgentRecord['status'], session: SessionRecord): AgentRecord => ({ id, status, sessionId: session.id, cwd: session.cwd, goal: 'fixture', role: 'reviewer', depth: 0, createdAt: '2026-10-16', updatedAt: '2026-10-16' });

test('owner selection preserves waiting approval and rejects competing writers or mismatched directories', () => {
  const session: SessionRecord = { id: 'session_0000000000000001', title: 'Saved', cwd: resolve('a'), createdAt: '', updatedAt: '', messages: [] };
  const waiting = record('agent_waiting', 'waiting_for_input', session), finished = { ...record('agent_finished', 'completed', session), updatedAt: '2026-10-17' };
  expect(sessionOwner(session, [finished, waiting])?.id).toBe(waiting.id);
  expect(() => sessionOwner(session, [waiting, record('agent_other', 'working', session)])).toThrow('Multiple active');
  expect(() => sessionOwner(session, [{ ...waiting, cwd: resolve('elsewhere') }])).toThrow('workspace mismatch');
  expect(forkResumeState({ version: 1, role: 'lead', planMode: false }, { ...waiting, planMode: true, allowedTools: ['read_file'], pendingPlanId: 'plan_pending' })).toMatchObject({ role: 'reviewer', planMode: true, allowedTools: ['read_file'] });
  expect(JSON.stringify(forkResumeState(undefined, waiting))).not.toContain('pendingPlanId');
  expect(sessionResumeCommand({ id: session.id, cwd: "C:\\Team's Workspace\\$data" })).toContain("'C:\\Team''s Workspace\\$data'");
  expect(() => sessionResumeCommand({ id: session.id, cwd: 'path\ncommand' })).toThrow('Invalid session handoff');
  expect(sameSessionWorkspace(resolve('Workspace'), resolve('workspace'))).toBe(process.platform === 'win32');
});

test('interrupted parallel tools receive UNKNOWN error records once, without changing or replaying calls', () => {
  const messages: ModelMessage[] = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'write', name: 'write_file', input: { path: 'side-effect.txt' } }, { type: 'tool_use', id: 'read', name: 'read_file', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read', content: 'already recorded' }] },
    { role: 'user', content: 'Continue after crash' },
  ];
  const original = JSON.stringify(messages); const fixed = reconcileInterruptedTools(messages);
  expect(fixed.repaired).toBe(1); expect(JSON.stringify(messages)).toBe(original);
  expect(JSON.stringify(fixed.messages[2])).toContain('UNKNOWN'); expect(JSON.stringify(fixed.messages[2])).toContain('write');
  expect(reconcileInterruptedTools(fixed.messages).repaired).toBe(0);
  expect(fixed.messages.at(-1)).toBe(messages.at(-1));
});

test('real Git worktrees share identity; repository and historical-branch filters do not mix unrelated projects', async () => fixture(async root => {
  const repo = join(root, 'repo'), tree = join(root, 'feature'); await mkdir(repo);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=' + join(root, 'no-hooks'), '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', repo, ...args], { windowsHide: true, stdio: 'pipe' });
  git('init', '-b', 'main'); await writeFile(join(repo, 'file.txt'), 'fixture'); git('add', 'file.txt'); git('commit', '-m', 'fixture'); git('worktree', 'add', '-b', 'feature', tree);
  const main = await createSession('Main', repo), feature = await createSession('Feature', tree), foreign = await createSession('Foreign', root);
  expect(main.git?.repository).toBe(feature.git?.repository); expect(main.git?.branch).toBe('main'); expect(feature.git?.branch).toBe('feature');
  expect(await sessionGitIdentity(root)).toBeUndefined();
  const state: ResourceDialogState = { type: 'resource', kind: 'resume', title: 'Resume', query: '', selected: 0, tab: 0, tabs: ['Conversations'], groups: [sessionItems([main, feature, foreign])], expanded: false, cwd: repo, allProjects: false, repository: main.git!.repository, currentBranch: 'main' };
  expect(resourceItems(state).map(row => row.id)).toEqual([main.id]);
  navigateResource(state, 'w', '', true); expect(resourceItems(state)).toHaveLength(2);
  navigateResource(state, 'b', '', true); expect(resourceItems(state).map(row => row.id)).toEqual([main.id]);
  navigateResource(state, 'b', '', true); navigateResource(state, 'a', '', true); expect(resourceItems(state)).toHaveLength(3);
  const loaded = await loadSession(feature.id); expect(loaded.git?.branch).toBe('feature');
}));

test('fork and resumed worker retain specialist Plan/tool ceilings, and missing profiles fail before model requests', async () => fixture(async root => {
  const requests: any[] = []; const server = Bun.serve({ port: 0, async fetch(request) { requests.push(await request.json()); return Response.json({ choices: [{ message: { content: 'Reviewed without edits.' }, finish_reason: 'stop' }] }); } });
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.agents.defaultIsolation = 'none'; config.policy.workspaceRoots = [root];
  config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`; config.model.name = 'snapshot-model';
  config.agentDefinitions = { reviewer: { description: 'Read only', prompt: 'Review only', tools: ['read_file'], disallowedTools: ['shell'], permissionMode: 'plan' } };
  try {
    const first = await spawnAgent({ cwd: root, goal: 'Review this module', role: 'reviewer', config, background: false, isolation: 'none' });
    const saved = await loadSession(first.sessionId); expect(saved.resume).toMatchObject({ version: 1, role: 'reviewer', modelName: 'snapshot-model', planMode: true, profileName: 'reviewer', allowedTools: ['read_file'] });
    expect(saved.resume?.thinkingEnabled).toBe(false);
    const fork = await forkSession(first.sessionId);
    const next = await spawnAgent({ cwd: root, goal: 'Review another module', sessionId: fork.id, config, background: false, isolation: 'none' });
    expect(next.role).toBe('reviewer'); expect(next.planMode).toBe(true); expect(requests[1].tools.map((tool: any) => tool.function.name)).toEqual(['read_file']);
    expect(JSON.stringify(saved.resume)).not.toMatch(/apiKey|endpoint|baseUrl|authorization|permissionMode/);
    const absent = structuredClone(config); absent.agentDefinitions = {};
    const failed = await continueAgent(first.id, 'Continue reviewing', { config: absent });
    expect(failed.status).toBe('failed'); expect(failed.error).toContain('broader default tools'); expect(requests).toHaveLength(2);
  } finally { server.stop(true); }
}));

test('concurrent continuations reserve one writer and repair crash history without replaying filesystem operations', async () => fixture(async root => {
  let release!: () => void; const gate = new Promise<void>(resolveGate => { release = resolveGate; }); const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) { requests.push(await request.json()); if (requests.length === 2) await gate; return Response.json({ choices: [{ message: { content: 'Continued safely.' }, finish_reason: 'stop' }] }); } });
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.agents.defaultIsolation = 'none'; config.policy.workspaceRoots = [root];
  config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`;
  try {
    const first = await spawnAgent({ cwd: root, goal: 'Initial engineering question', config, background: false, isolation: 'none' });
    const saved = await loadSession(first.sessionId); saved.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'crash-write', name: 'write_file', input: { path: 'never-replay.txt', content: 'unsafe' } }] }); await saveSession(saved);
    const both = [continueAgent(first.id, 'Follow-up A', { config }), continueAgent(first.id, 'Follow-up B', { config })];
    const outcomes = Promise.allSettled(both);
    const deadline = Date.now() + 5000; while (requests.length < 2 && Date.now() < deadline) await Bun.sleep(20);
    release(); const result = await outcomes;
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(result.filter(item => item.status === 'rejected')).toHaveLength(1); expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain('UNKNOWN'); expect((await loadAgent(first.id)).status).toBe('completed');
    await expect(readFile(join(root, 'never-replay.txt'))).rejects.toThrow();
  } finally { release(); server.stop(true); }
}));

test('managed model restore fields expose names only, never administrator values', async () => fixture(async root => {
  const previous = process.env.CCPT_MANAGED_CONFIG; process.env.CCPT_MANAGED_CONFIG = join(root, 'managed.json');
  try {
    await writeJson(process.env.CCPT_MANAGED_CONFIG, { model: { name: 'managed-deployment', apiKeyEnv: 'PRIVATE_ENV', reasoningEffort: 'low' }, policy: { mode: 'restricted' } });
    expect(managedModelFields()).toEqual(expect.arrayContaining(['name', 'apiKeyEnv', 'reasoningEffort'])); expect(JSON.stringify(managedModelFields())).not.toContain('PRIVATE_ENV');
    const snapshot = structuredClone(defaultConfig); snapshot.policy.mode = 'bypass'; snapshot.model.name = 'stale-model';
    const restored = applyManagedConfiguration(snapshot); expect(restored.policy.mode).toBe('restricted'); expect(restored.model.name).toBe('managed-deployment'); expect(snapshot.model.name).toBe('stale-model');
  }
  finally { if (previous === undefined) delete process.env.CCPT_MANAGED_CONFIG; else process.env.CCPT_MANAGED_CONFIG = previous; }
}));
