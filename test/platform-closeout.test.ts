import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { createId, readJson, writeJson } from '../src/storage.js';
import { createSession, loadSession, saveSession } from '../src/sessions.js';
import { cancelWakeup, deliverPendingWakeups, dueWakeups, listWakeups, scheduleWakeup, setSessionGoal } from '../src/automation.js';
import { continueAgent, spawnAgent, waitForAgent } from '../src/agent.js';
import { createProjectPlan, loadProjectPlan, transitionProjectPlan } from '../src/plans.js';
import { createIdePlanReview, decideIdePlanReview } from '../src/enhancements/ideReview.js';
import { diagnosticBundle, exportDiagnosticBundle } from '../src/diagnosticBundle.js';
import { storeModelCredential, prepareModelCredential, removeModelCredential, listModelCredentials } from '../src/protectedModelCredentials.js';
import { modelAuthHeaders } from '../src/modelConnection.js';
import { callModel } from '../src/model.js';
import { runHooks } from '../src/hooks.js';
import { executeGrep } from '../src/tools/GrepTool/GrepTool.js';
import { withExecutionSignal } from '../src/executionControl.js';
import { computePluginDigest, loadPluginAt } from '../src/plugins.js';
import { listInterruptedPluginTransactions, recoverPluginTransaction } from '../src/pluginHistory.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-closeout-'));
  const oldHome = process.env.CCPT_HOME, oldEntry = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_HOME = join(root, 'state'); process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '../src/cli.ts');
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.hooks = []; config.disableBundledSkills = true;
  config.model.apiKeyEnv = ''; config.model.apiProtocol = 'chat-completions'; config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push({ body: await request.json(), authorization: request.headers.get('authorization'), apiKey: request.headers.get('api-key') });
    if (new URL(request.url).pathname.endsWith('/responses')) return Response.json({ id: 'resp_closeout', object: 'response', status: 'completed', output: [{ id: 'msg_closeout', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Responses fixture outcome', annotations: [] }] }] });
    return Response.json({ choices: [{ message: { content: 'Fixture outcome' }, finish_reason: 'stop' }] });
  } });
  config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`; config.network.allowedHosts = ['127.0.0.1'];
  const persist = () => writeJson(join(root, '.ccpt/settings.json'), config);
  await persist();
  return { root, config, requests, persist, async close() {
    await Bun.sleep(150); server.stop(true);
    if (oldHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = oldHome;
    if (oldEntry === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = oldEntry;
    await removeOwnedTemporaryFixture(root);
  } };
}

test('wakeup inspection does not consume, delivery is idempotent across an acknowledgement crash', async () => {
  const f = await fixture();
  try {
    const session = await createSession('Wakeup recovery', f.root);
    const wakeup = await scheduleWakeup({ sessionId: session.id, prompt: 'Recheck validation', runAt: new Date(Date.now() + 60000).toISOString() }, f.root);
    const now = Date.parse(wakeup.runAt) + 1;
    expect(await dueWakeups(now, f.root)).toHaveLength(1); expect(await dueWakeups(now, f.root)).toHaveLength(1);
    expect(await deliverPendingWakeups(f.root, session, now)).toBe(1);
    expect((await listWakeups(f.root))[0]?.status).toBe('delivered');
    const state = await readJson<any>(join(f.root, '.ccpt/automation.json'), null); state.wakeups[0].status = 'scheduled'; await writeJson(join(f.root, '.ccpt/automation.json'), state);
    const reloaded = await loadSession(session.id); await deliverPendingWakeups(f.root, reloaded, now);
    expect(reloaded.messages.filter(message => JSON.stringify(message.content).includes(wakeup.id))).toHaveLength(1);
    await expect(cancelWakeup(wakeup.id, f.root)).rejects.toThrow('Delivered');
  } finally { await f.close(); }
});

test('a resumed real worker reloads persistent goal and delivers only its own due wakeups', async () => {
  const f = await fixture();
  try {
    const agent = await spawnAgent({ cwd: f.root, goal: 'Inspect a bounded fixture', config: f.config, background: false });
    await setSessionGoal({ sessionId: agent.sessionId, objective: 'PERSISTENT-GOAL-FIXTURE' }, f.root);
    await scheduleWakeup({ sessionId: agent.sessionId, prompt: 'WAKEUP-OWN-FIXTURE', runAt: new Date(Date.now() + 20).toISOString() }, f.root);
    await scheduleWakeup({ sessionId: 'other-session', prompt: 'DO-NOT-DELIVER', runAt: new Date(Date.now() + 20).toISOString() }, f.root);
    await Bun.sleep(30);
    const continued = await continueAgent(agent.id, 'Continue verification', { config: f.config });
    expect(continued.status).toBe('completed'); expect(continued.sessionId).toBe(agent.sessionId);
    const request = JSON.stringify(f.requests[1].body); expect(request).toContain('PERSISTENT-GOAL-FIXTURE'); expect(request).toContain('WAKEUP-OWN-FIXTURE'); expect(request).not.toContain('DO-NOT-DELIVER');
  } finally { await f.close(); }
}, 20000);

test('Plan CAS and immutable IDE review admit one decision under concurrent approval', async () => {
  const f = await fixture();
  try {
    const plan = await createProjectPlan({ cwd: f.root, request: 'Concurrent approval', content: '# Safe approval' });
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => transitionProjectPlan(f.root, plan.id, 'approved', { expectedVersion: plan.version })));
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect((await loadProjectPlan(f.root, plan.id)).version).toBe(2);
    const review = await createIdePlanReview('session', '# Immutable review', f.root);
    const decisions = await Promise.allSettled([decideIdePlanReview(review.id, 'approved', '', f.root), decideIdePlanReview(review.id, 'changes-requested', '', f.root)]);
    expect(decisions.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  } finally { await f.close(); }
});

test('diagnostics are allowlisted/redacted and export never overwrites a file', async () => {
  const f = await fixture(); const previous = process.env.CLOSEOUT_API_KEY;
  try {
    process.env.CLOSEOUT_API_KEY = 'fixture-hidden-diagnostic-key'; f.config.model.apiKeyEnv = 'CLOSEOUT_API_KEY';
    f.config.model.endpointUrl = 'https://user:password@company.example/v1/responses?api-version=2026&token=never-export'; f.config.model.apiProtocol = 'responses';
    const text = JSON.stringify(await diagnosticBundle(f.config, 'fixture'));
    expect(text).not.toContain('fixture-hidden-diagnostic-key'); expect(text).not.toContain('never-export'); expect(text).not.toContain('user:password');
    const path = await exportDiagnosticBundle(f.root, 'diagnostics.json', f.config, 'fixture');
    expect(await readFile(path, 'utf8')).toContain('CCPT');
    await expect(exportDiagnosticBundle(f.root, 'diagnostics.json', f.config, 'fixture')).rejects.toThrow('EEXIST');
    await expect(exportDiagnosticBundle(f.root, '../outside.json', f.config, 'fixture')).rejects.toThrow('outside'); expect(f.requests).toHaveLength(0);
  } finally { if (previous === undefined) delete process.env.CLOSEOUT_API_KEY; else process.env.CLOSEOUT_API_KEY = previous; await f.close(); }
});

test.skipIf(process.platform !== 'win32')('DPAPI model credentials reach foreground and background requests without config/env serialization', async () => {
  const f = await fixture(); const key = 'fixture-protected-model-key-793';
  try {
    await storeModelCredential('company', key, f.config.model); f.config.model.credentialRef = 'company';
    expect(await listModelCredentials()).toEqual(['company']);
    expect(await readFile(join(f.root, 'state/model-credentials.dpapi.json'), 'utf8')).not.toContain(key);
    await prepareModelCredential(f.config.model); expect(modelAuthHeaders(f.config.model).authorization).toBe(`Bearer ${key}`);
    expect(JSON.stringify(f.config)).not.toContain(key);
    await callModel(f.config, 'Fixture only', [{ role: 'user', content: 'Inspect protected authentication' }], []);
    expect(f.requests[0].authorization).toBe(`Bearer ${key}`);
    await f.persist();
    const started = await spawnAgent({ cwd: f.root, goal: 'Verify protected background authentication', config: f.config, background: true });
    const agent = await waitForAgent(started.id); expect(agent.status).toBe('completed');
    expect(f.requests[1].authorization).toBe(`Bearer ${key}`);
    expect(await readFile(join(f.root, 'state/agents-runtime', `${agent.id}.json`), 'utf8')).not.toContain(key);
    const responses = structuredClone(f.config); responses.model.apiProtocol = 'responses'; responses.model.endpointUrl = f.config.model.endpointUrl!.replace('/chat/completions', '/responses'); responses.model.apiKeyHeader = 'api-key'; responses.model.apiKeyPrefix = ''; responses.model.credentialRef = 'company-responses';
    await storeModelCredential('company-responses', key, responses.model);
    const native = await callModel(responses, 'Fixture only', [{ role: 'user', content: 'Verify the Responses wire contract' }], []);
    expect(native.content[0]?.text).toBe('Responses fixture outcome'); expect(f.requests[2].apiKey).toBe(key); expect(f.requests[2].body.input).toBeDefined(); expect(f.requests[2].body.messages).toBeUndefined();
    const wrong = structuredClone(f.config.model); wrong.endpointUrl = 'https://other.example/v1/chat/completions'; await expect(prepareModelCredential(wrong)).rejects.toThrow('another endpoint');
    await removeModelCredential('company'); await expect(prepareModelCredential(f.config.model)).rejects.toThrow('missing');
  } finally { await f.close(); }
}, 30000);

test('regex matching cannot freeze the main thread and can be cancelled', async () => {
  const f = await fixture();
  const context = { cwd: f.root, config: f.config, agentId: createId('agent'), sessionId: 'fixture', depth: 0 };
  try {
    await writeFile(join(f.root, 'plain.txt'), 'Hello\nworld'); expect((await executeGrep({ query: 'hello' }, context))[0]?.line).toBe(1);
    await expect(executeGrep({ query: '[' }, context)).rejects.toThrow('Invalid');
    await writeFile(join(f.root, 'evil.txt'), 'a'.repeat(50000) + '!'); let beats = 0; const timer = setInterval(() => beats++, 20);
    try { await expect(executeGrep({ query: '^(a+)+$', glob: '**/evil.txt' }, context)).rejects.toThrow('time limit'); } finally { clearInterval(timer); }
    expect(beats).toBeGreaterThan(1);
    const controller = new AbortController(); const cancel = setTimeout(() => controller.abort(), 50);
    try { await expect(withExecutionSignal(controller.signal, () => executeGrep({ query: '^(a+)+$', glob: '**/evil.txt' }, context))).rejects.toThrow('cancelled'); } finally { clearTimeout(cancel); }
  } finally { await f.close(); }
}, 10000);

test('Hook nested outputs, common payload and plugin provenance are enforced', async () => {
  const f = await fixture(); const command = `node "${join(import.meta.dir, 'closeout-hook-fixture.cjs')}"`;
  try {
    f.config.hooks = [{ event: 'PreToolUse', command: command + ' nested-input' }];
    expect(await runHooks(f.config, 'PreToolUse', { agentId: 'a', sessionId: 's' }, f.root)).toMatchObject({ additionalContext: ['Nested context'], updatedInput: { limit: 5 } });
    f.config.hooks = [{ event: 'PreToolUse', command: command + ' payload' }];
    const payload = JSON.parse((await runHooks(f.config, 'PreToolUse', { agentId: 'a', sessionId: 's' }, f.root)).additionalContext[0]!);
    expect(payload).toMatchObject({ event: 'PreToolUse', session: 's', agent: 'a', cwd: f.root });
    f.config.hooks = [{ event: 'PreToolUse', command: command + ' nested-deny', source: 'plugin:fixture' }];
    await expect(runHooks(f.config, 'PreToolUse', {}, f.root)).rejects.toThrow('[plugin:fixture]');
    await expect(runHooks(f.config, 'PreToolUse', { large: 'x'.repeat(1_000_001) }, f.root)).rejects.toThrow('1 MB');
  } finally { await f.close(); }
});

test('confirmed plugin journal recovery restores verified backup without overwriting another installation', async () => {
  const f = await fixture();
  try {
    const transaction = join(f.root, '.ccpt/plugin-transactions/replace-fixture'); const backup = join(transaction, 'backup'); await mkdir(backup, { recursive: true });
    await writeJson(join(backup, 'plugin.json'), { name: 'team', version: '1.0.0', contributes: {} }); await writeFile(join(backup, 'guide.md'), 'Retain reviewed bytes');
    const digest = await computePluginDigest(backup);
    await writeJson(join(transaction, 'journal.json'), { schemaVersion: 1, name: 'team', scope: 'project', oldDigest: digest, newDigest: 'b'.repeat(64) });
    expect(await listInterruptedPluginTransactions(f.root)).toHaveLength(1);
    await expect(recoverPluginTransaction(f.root, 'replace-fixture', false)).rejects.toThrow('confirmation');
    const restored = await recoverPluginTransaction(f.root, 'replace-fixture', true); expect(restored.restored).toBe(true); expect((await loadPluginAt(restored.path)).version).toBe('1.0.0');
    expect(await listInterruptedPluginTransactions(f.root)).toHaveLength(0);
    expect(await readFile(join(restored.path, 'guide.md'), 'utf8')).toBe('Retain reviewed bytes');
  } finally { await f.close(); }
});

test('plugin recovery refuses tampering/live owners and recovers a conclusively dead operation lock', async () => {
  const f = await fixture();
  try {
    const transaction = join(f.root, '.ccpt/plugin-transactions/replace-dead-owner'); const backup = join(transaction, 'backup'); await mkdir(backup, { recursive: true });
    await writeJson(join(backup, 'plugin.json'), { name: 'team', version: '1.0.0', contributes: {} });
    const digest = await computePluginDigest(backup); const journal = { schemaVersion: 1, name: 'team', scope: 'project', oldDigest: digest, newDigest: 'c'.repeat(64) };
    await writeJson(join(transaction, 'journal.json'), { ...journal, oldDigest: 'd'.repeat(64) });
    await expect(recoverPluginTransaction(f.root, 'replace-dead-owner', true)).rejects.toThrow('digest');
    await writeJson(join(transaction, 'journal.json'), journal);
    const lock = join(f.root, '.ccpt/plugin-operations/project-team.lock'); await writeJson(lock, { pid: process.pid });
    await expect(recoverPluginTransaction(f.root, 'replace-dead-owner', true)).rejects.toThrow('still alive');
    await unlink(lock);
    const pid = Number(execFileSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })); await writeJson(lock, { pid });
    expect((await recoverPluginTransaction(f.root, 'replace-dead-owner', true)).restored).toBe(true);
    const second = join(f.root, '.ccpt/plugin-transactions/replace-existing'); await mkdir(join(second, 'backup'), { recursive: true });
    await writeJson(join(second, 'backup/plugin.json'), { name: 'team', version: '1.0.0', contributes: {} });
    await writeJson(join(second, 'journal.json'), journal);
    await expect(recoverPluginTransaction(f.root, 'replace-existing', true)).rejects.toThrow('already exists');
  } finally { await f.close(); }
});

test('actual CLI protects model credentials, exports diagnostics and rejects stale Plan approval', async () => {
  const f = await fixture();
  const env: Record<string, string> = { CCPT_HOME: join(f.root, 'state'), CCPT_CLI_ENTRY: join(import.meta.dir, '../src/cli.ts'), FIXTURE_INPUT_KEY: 'fixture-cli-vault-key' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/cli.ts'), ...args, '--cwd', f.root], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, code };
  };
  try {
    if (process.platform === 'win32') {
      const stored = await cli('credentials', 'set', 'fixture', '--from-env', 'FIXTURE_INPUT_KEY'); expect(stored.code, stored.stderr).toBe(0); expect(stored.stdout).not.toContain(env.FIXTURE_INPUT_KEY!);
      expect(JSON.parse((await cli('credentials', 'list')).stdout).names).toEqual(['fixture']);
      f.config.model.credentialRef = 'fixture'; await f.persist();
    }
    const exported = await cli('doctor', 'export', 'support.json'); expect(exported.code, exported.stderr).toBe(0);
    expect(await readFile(join(f.root, 'support.json'), 'utf8')).not.toContain(env.FIXTURE_INPUT_KEY!); expect(f.requests).toHaveLength(0);
    const plan = await createProjectPlan({ cwd: f.root, request: 'CLI CAS', content: '# Exact reviewed version' });
    expect((await cli('plan', 'approve', plan.id, '--expected-version', '99')).code).not.toBe(0);
    expect((await loadProjectPlan(f.root, plan.id)).status).toBe('pending_approval');
    const approved = await cli('plan', 'approve', plan.id, '--expected-version', '1'); expect(approved.code, approved.stderr).toBe(0);
  } finally { await f.close(); }
}, 20000);

test('actual IDE bridge requires the reviewed Plan version and refuses a second window’s stale decision', async () => {
  const f = await fixture();
  try {
    const plan = await createProjectPlan({ cwd: f.root, request: 'Two windows', content: '# IDE version check' });
    const legacy = await createIdePlanReview('session', '# Reject malformed bridge decision', f.root);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/cli.ts'), 'ide', 'serve', '--cwd', f.root], { env: { ...process.env, CCPT_HOME: join(f.root, 'state') }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    for (const request of [
      { id: 1, method: 'plan/decide', params: { id: plan.id, decision: 'approved' } },
      { id: 2, method: 'plan/decide', params: { id: plan.id, decision: 'approved', expectedVersion: 1 } },
      { id: 3, method: 'plan/decide', params: { id: plan.id, decision: 'rejected', expectedVersion: 1 } },
      { id: 4, method: 'ide/plan/decide', params: { id: legacy.id, decision: 'typo' } },
      { id: 5, method: 'ide/plan/decide', params: { id: legacy.id, decision: 'approved' } },
    ]) child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); expect(code, error).toBe(0);
    const replies = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(replies.find(item => item.id === 1).error).toBeDefined(); expect(replies.find(item => item.id === 2).result.status).toBe('approved'); expect(replies.find(item => item.id === 3).error).toBeDefined();
    expect(replies.find(item => item.id === 4).error).toBeDefined(); expect(replies.find(item => item.id === 5).result.status).toBe('approved');
    expect((await loadProjectPlan(f.root, plan.id)).status).toBe('approved'); expect(f.requests).toHaveLength(0);
  } finally { await f.close(); }
}, 20000);
