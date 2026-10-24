import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultConfig } from '../src/config.js';
import { readAudit } from '../src/audit.js';
import { handleMcpInteraction } from '../src/mcpInteraction.js';
import { auditMcpReply, withMcpAuditScope } from '../src/mcpInteractionAudit.js';
import { watchLocalState } from '../src/localStateWatch.js';
import { writeJson } from '../src/storage.js';
import { HOOK_EVENTS, hookCompatibilityMatrix } from '../src/hookContracts.js';
import { runHooks, HookDecisionError } from '../src/hooks.js';
import { automationDiagnostics } from '../src/automation.js';
import { conflictGuide, stageResolvedConflict, recoveryPage, pruneWorktreeRecovery } from '../src/worktree.js';
import { createProjectPlan, transitionProjectPlan } from '../src/plans.js';
import { listInterruptedPluginTransactions, recoverPluginTransaction } from '../src/pluginHistory.js';
import { computePluginDigest } from '../src/plugins.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

async function fixture(run: (root: string, config: typeof defaultConfig) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-table-followup-')), prior = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'home');
  const config = structuredClone(defaultConfig); config.hooks = []; config.marketplaceEnabled = false; config.policy.workspaceRoots = [root];
  try { await run(root, config); } finally { if (prior === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = prior; await removeOwnedTemporaryFixture(root); }
}
async function until(check: () => boolean) { const end = Date.now() + 5000; while (!check() && Date.now() < end) await Bun.sleep(20); expect(check()).toBe(true); }

test('MCP audit correlates approval, model and transport acknowledgement without prompts or values', () => fixture(async () => {
  const result = await withMcpAuditScope('server-secret-value', 'http', () => handleMcpInteraction('sampling/createMessage', { messages: [{ role: 'user', content: { type: 'text', text: 'PRIVATE-PROMPT' } }], maxTokens: 20 }, { confirmSampling: async () => true, sample: async () => ({ role: 'assistant', content: { type: 'text', text: 'PRIVATE-OUTPUT' }, model: 'fixture' }), confirmSamplingResult: async () => true }, new AbortController().signal));
  expect('result' in result).toBe(true); await auditMcpReply(result, 'reply-acknowledged');
  const text = await readAudit(), records = text.trim().split('\n').map(line => JSON.parse(line));
  expect(records.map(item => item.details.phase)).toEqual(['received','request-approval','request-approved','model-started','model-completed','share-approval','share-approved','result-authorized','reply-acknowledged']);
  expect(new Set(records.map(item => item.details.interactionId)).size).toBe(1); expect(new Set(records.map(item => item.details.operationId)).size).toBe(1);
  for (const value of ['PRIVATE-PROMPT', 'PRIVATE-OUTPUT', 'server-secret-value']) expect(text).not.toContain(value);
}));

test('MCP audit failure refuses sampling before human/model callbacks', () => fixture(async root => {
  await mkdir(join(root, 'home')); await writeFile(join(root, 'home/audit'), 'blocked-path'); let called = 0;
  const result = await handleMcpInteraction('sampling/createMessage', { messages: [{ role: 'user', content: { type: 'text', text: 'x' } }], maxTokens: 2 }, { confirmSampling: async () => { called++; return true; }, sample: async () => { called++; throw new Error(); }, confirmSamplingResult: async () => true }, new AbortController().signal);
  expect('error' in result).toBe(true); expect(called).toBe(0);
}));

test('two metadata subscribers observe atomic replacement, unsubscribe and never expose values', () => fixture(async root => {
  const path = join(root, 'index.json'); await writeJson(path, { secret: 'NEVER-SEND' }); const a: string[] = [], b: string[] = [];
  const stopA = watchLocalState([path], value => { a.push(value); }, { initial: true, intervalMs: 100 });
  const stopB = watchLocalState([path], value => { b.push(value); }, { initial: true, intervalMs: 100 });
  try { await until(() => a.length === 1 && b.length === 1); await writeJson(path, { secret: 'CHANGED' }); await until(() => a.length >= 2 && b.length >= 2); stopA(); const length = a.length; await writeJson(path, { secret: 'THIRD' }); await until(() => b.length >= 3); expect(a).toHaveLength(length); expect(a.every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true); }
  finally { stopA(); stopB(); }
}));

test('Hook matrix covers every declared event and common payload/exit-code dispatch', () => fixture(async (root, config) => {
  expect(hookCompatibilityMatrix()).toHaveLength(HOOK_EVENTS.length);
  const command = `node "${join(import.meta.dir, 'hook-contract-fixture.cjs')}"`;
  for (const event of HOOK_EVENTS) {
    const payloadPath = join(root, `hook-input-${event}.json`);
    config.hooks = [{ event, command: command + ` 0 "${payloadPath}"` }]; const result = await runHooks(config, event, { sessionId: 'session-fixture', agentId: 'agent-fixture' }, root);
    expect(JSON.parse(await readFile(payloadPath,'utf8'))).toMatchObject({ hook_event_name: event, cwd: root, session_id: 'session-fixture', agent_id: 'agent-fixture' });
    if (event === 'StopFailure' || event === 'MessageDisplay') expect(result).toEqual({additionalContext:[]});
    else { expect(JSON.parse(result.additionalContext[0]!)).toMatchObject({hook_event_name:event}); expect(result.updatedInput).toEqual({ verified: true }); }
  }
  config.hooks = [{ event: 'TaskCompleted', command: command + ' 2', source: 'plugin:fixture' }];
  let denied: unknown; try { await runHooks(config, 'TaskCompleted', {}, root); } catch (error) { denied = error; }
  expect(denied).toBeInstanceOf(HookDecisionError); expect((denied as HookDecisionError).retry).toBe(true); expect(String(denied)).toContain('plugin:fixture');
  config.hooks = [{ event: 'Setup', command: command + ' 3' }]; await expect(runHooks(config, 'Setup', {}, root)).rejects.toThrow('failed (3)');
}), 20000);

test('automation doctor identifies orphan wakeups without prompts, acknowledgement or replay', () => fixture(async root => {
  const path = join(root, '.ccpt/automation.json'); const state = { routines: [], goals: [], runs: [{ id: 'run_1111111111111111', routineId: 'routine_1111111111111111', status: 'running', inputs: {}, startedAt: '2020-01-01T00:00:00Z' }], wakeups: [{ id: 'wakeup_1111111111111111', sessionId: 'session_1111111111111111', status: 'scheduled', runAt: '2020-01-01T00:00:00Z', prompt: 'SECRET-PROMPT' }] };
  await writeJson(path, state); const before = await readFile(path, 'utf8'), result = await automationDiagnostics(root);
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain('session-missing'); expect(JSON.stringify(result)).not.toContain('SECRET-PROMPT'); expect(await readFile(path, 'utf8')).toBe(before); expect(result.automaticReplay).toBe(false);
}));

test('Git guide stages only a reviewed manual resolution; recovery prune needs a retaining ref and CAS', () => fixture(async (root, config) => {
  const repo = join(root, 'repo'); await mkdir(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'fixture@local'); git('config', 'user.name', 'Fixture'); git('config', 'core.autocrlf', 'false');
  await writeFile(join(repo, 'file.txt'), 'base\n'); git('add', 'file.txt'); git('commit', '-m', 'base'); git('checkout', '-b', 'side');
  await writeFile(join(repo, 'file.txt'), 'side\n'); git('commit', '-am', 'side'); git('checkout', 'main');
  await writeFile(join(repo, 'file.txt'), 'main\n'); git('commit', '-am', 'main'); const head = git('rev-parse', 'HEAD');
  try { git('merge', 'side'); } catch { /* Expected actual conflict. */ }
  const before = await conflictGuide(repo, 'file.txt', config); expect(before.markersRemain).toBe(true);
  await expect(stageResolvedConflict(repo, 'file.txt', before.version, true, config)).rejects.toThrow('markers');
  await writeFile(join(repo, 'file.txt'), 'resolved manually\n');
  await expect(stageResolvedConflict(repo, 'file.txt', before.version, true, config)).rejects.toThrow('changed');
  const reviewed = await conflictGuide(repo, 'file.txt', config); await stageResolvedConflict(repo, 'file.txt', reviewed.version, true, config);
  expect(git('ls-files', '--unmerged')).toBe(''); expect(git('rev-parse', 'HEAD')).toBe(head); expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('resolved manually\n');
  const ref = 'refs/ccpt/recovery/agent_1111111111111111/save_1111111111111111'; git('update-ref', ref, head);
  expect((await recoveryPage(repo, config, 0, 1)).total).toBe(1);
  await expect(pruneWorktreeRecovery(repo, ref, '0'.repeat(40), true, config)).rejects.toThrow('changed');
  await expect(pruneWorktreeRecovery(repo, ref, head, false, config)).rejects.toThrow('confirm');
  await pruneWorktreeRecovery(repo, ref, head, true, config); expect((await recoveryPage(repo, config)).total).toBe(0);
}), 20000);

test('64 same-version approvals accept exactly one decision', () => fixture(async root => {
  const plan = await createProjectPlan({ cwd: root, request: 'CAS pressure', content: '# Reviewed plan' });
  const attempts = await Promise.allSettled(Array.from({ length: 64 }, () => transitionProjectPlan(root, plan.id, 'approved', { expectedVersion: plan.version })));
  expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
}), 15000);

test('interrupted first install requires intact staged bytes, explicit recovery and an absent destination', () => fixture(async (root, config) => {
  await writeJson(join(root, '.ccpt/settings.json'), config);
  const pending = join(root, '.ccpt/plugin-transactions/install-fixture'), artifact = join(pending, 'team');
  await writeJson(join(artifact, 'plugin.json'), { name: 'team', version: '1.0.0', contributes: {} }); await writeFile(join(artifact, 'data.txt'), 'reviewed');
  const digest = await computePluginDigest(artifact);
  await writeJson(join(pending, 'journal.json'), { schemaVersion: 1, kind: 'install', name: 'team', scope: 'project', oldDigest: null, newDigest: digest });
  expect((await listInterruptedPluginTransactions(root))[0]?.kind).toBe('install');
  await expect(recoverPluginTransaction(root, 'install-fixture', false)).rejects.toThrow('confirmation');
  await writeFile(join(artifact, 'data.txt'), 'tampered'); await expect(recoverPluginTransaction(root, 'install-fixture', true)).rejects.toThrow('digest');
  await writeFile(join(artifact, 'data.txt'), 'reviewed'); const recovered = await recoverPluginTransaction(root, 'install-fixture', true); expect(recovered.restored).toBe(true);
  expect(await readFile(join(recovered.path, 'data.txt'), 'utf8')).toBe('reviewed'); expect(await listInterruptedPluginTransactions(root)).toHaveLength(0);
}));
