import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commentOnArtifact, createArtifact, listArtifacts, updateArtifact } from '../src/artifacts.js';
import { drainChannelEvents, pairChannel, receiveChannelEvent, sendChannelEvent } from '../src/channels.js';
import { createRoutine, dueWakeups, finishRoutineRun, listRoutineRuns, scheduleWakeup, startRoutineRun } from '../src/automation.js';
import { defaultConfig } from '../src/config.js';
import { executeTool, tools } from '../src/tooling.js';
import { InMemorySessionStorage, InProcessToolRegistry, defineInProcessTool, parseStructuredOutput, validateStructuredOutput } from '../src/entrypoints/sdk/session.js';
import { listUsage, recordUsage, summarizeUsage, toOpenTelemetryMetrics, usageInsights } from '../src/usage.js';
import { ExternalSurfaceRegistry, applyProviderProfile, authorize, evaluateSpend, privacyBoundFeedback, providerProfile, retentionDeadline, signRunnerIdentity, verifyRunnerIdentity } from '../src/enterprise.js';
import { HttpSurfaceAdapter, loadSurfaceRegistry, surfaceCapabilities, surfaceHealth, type SurfaceKind } from '../src/integrations/surfaces.js';
import { grantPermissionOnce, parsePermissionRequest } from '../src/permissionApprovals.js';
import { createSession } from '../src/sessions.js';

let root = ''; let previousHome: string | undefined;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ccpt-epics-')); previousHome = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'home'); });
afterEach(async () => { if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome; await rm(root, { recursive: true, force: true }); });
const context = () => { const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root]; return { cwd: root, agentId: 'agent-epic', sessionId: 'session-epic', teamSessionId: 'session-epic', depth: 0, config }; };
const noDelegate = async (): Promise<string> => 'unused';

describe('Epic artifacts, channels, and autonomous routines', () => {
  test('persists governed artifacts with updates, comments, and replies', async () => {
    const artifact = await createArtifact({ title: 'Architecture', kind: 'diagram', content: 'A -> B', owner: 'lead', visibility: 'team', dataSources: ['mcp://docs'] }, root);
    expect((await listArtifacts(root))[0]?.id).toBe(artifact.id);
    const updated = await updateArtifact(artifact.id, { content: 'A -> B -> C' }, 'lead', root); expect(updated.content).toContain('C');
    const commented = await commentOnArtifact(artifact.id, { author: 'reviewer', body: 'Why C?' }, root); const parent = commented.comments[0]!;
    const replied = await commentOnArtifact(artifact.id, { author: 'lead', body: 'Audit stage', replyTo: parent.id }, root); expect(replied.comments[1]?.replyTo).toBe(parent.id);
    await expect(updateArtifact(artifact.id, { title: 'stolen' }, 'other', root)).rejects.toThrow('owner');
  });
  test('authenticates bidirectional channel events and preserves delivery state', async () => {
    const paired = await pairChannel({ name: 'jira-events', kind: 'webhook', allowedSenders: ['jira'] }, root);
    const inbound = await receiveChannelEvent({ channelId: paired.channel.id, token: paired.token, sender: 'jira', type: 'issue.updated', payload: { key: 'A-1' }, eventId: 'event-fixed' }, root);
    expect((await receiveChannelEvent({ channelId: paired.channel.id, token: paired.token, sender: 'jira', type: 'issue.updated', payload: {}, eventId: 'event-fixed' }, root)).id).toBe(inbound.id);
    await expect(receiveChannelEvent({ channelId: paired.channel.id, token: paired.token, sender: 'attacker', type: 'x', payload: {} }, root)).rejects.toThrow('not allowed');
    await sendChannelEvent({ channelId: paired.channel.id, sender: 'agent', type: 'ack', payload: { id: inbound.id } }, root);
    expect(await drainChannelEvents(paired.channel.id, 'inbound', root)).toHaveLength(1); expect(await drainChannelEvents(paired.channel.id, 'inbound', root)).toHaveLength(0);
    expect(await drainChannelEvents(paired.channel.id, 'outbound', root)).toHaveLength(1);
  });
  test('stores routine inputs, outcomes, history, and one-time wakeups', async () => {
    const routine = await createRoutine({ name: 'nightly review', prompt: 'Review changes', schedule: '0 2 * * *', inputs: { scope: 'diff' } }, root);
    const run = await startRoutineRun(routine.id, { branch: 'main' }, root); const finished = await finishRoutineRun(run.id, { result: 'clean' }, root);
    expect(finished.inputs).toEqual({ scope: 'diff', branch: 'main' }); expect((await listRoutineRuns(root))[0]?.status).toBe('completed');
    const wakeup = await scheduleWakeup({ sessionId: 's', prompt: 'continue', runAt: new Date(Date.now() + 60_000).toISOString() }, root);
    expect(await dueWakeups(Date.parse(wakeup.runAt) + 1, root)).toMatchObject([{ id: wakeup.id, status: 'scheduled' }]); expect(await dueWakeups(Date.parse(wakeup.runAt) + 2, root)).toMatchObject([{ id: wakeup.id }]);
  });
});

describe('complete product tool surface', () => {
  test('registers and executes structured questions, artifacts, findings, notifications, files, and deliberate completion', async () => {
    for (const name of ['ask_user_question', 'artifact', 'monitor', 'push_notification', 'end_conversation', 'report_findings', 'schedule_wakeup', 'routine', 'channel', 'send_user_file', 'send_feedback', 'share_onboarding_guide', 'wait_for_mcp_servers', 'workflow']) expect(tools.some((tool) => tool.name === name)).toBe(true);
    const question = await executeTool('ask_user_question', { questions: [{ id: 'scope', question: 'Which scope?', choices: ['diff', 'repo'] }] }, context(), noDelegate); expect(question.waiting).toBe(true); expect(question.content).toContain('choices');
    const artifact = JSON.parse((await executeTool('artifact', { action: 'create', title: 'Report', kind: 'markdown', content: '# Result' }, context(), noDelegate)).content) as { id: string }; expect(artifact.id).toStartWith('artifact_');
    expect(JSON.parse((await executeTool('report_findings', { scope: 'diff', findings: [{ severity: 'high', title: 'Issue', description: 'Details' }] }, context(), noDelegate)).content).findings).toHaveLength(1);
    expect(JSON.parse((await executeTool('push_notification', { title: 'Done', body: 'Review complete', level: 'success' }, context(), noDelegate)).content).title).toBe('Done');
    await writeFile(join(root, 'report.txt'), 'report'); expect((await executeTool('send_user_file', { path: 'report.txt' }, context(), noDelegate)).content).toContain('report.txt');
    expect((await executeTool('share_onboarding_guide', {}, context(), noDelegate)).content).toContain('/doctor'); expect((await executeTool('end_conversation', { reason: 'All acceptance criteria passed' }, context(), noDelegate)).ended).toBe(true);
  });
  test('pauses ask-rule tools and consumes an explicit one-time approval', async () => {
    const toolContext = context(); toolContext.sessionId = (await createSession('permission test', root)).id; toolContext.teamSessionId = toolContext.sessionId; toolContext.config.policy.permissionRules.ask = ['write_file(*)'];
    const pending = await executeTool('write_file', { path: 'approved.txt', content: 'approved' }, toolContext, noDelegate);
    expect(pending.waiting).toBe(true);
    const request = parsePermissionRequest(pending.content); expect(request).toBeDefined();
    await expect(readFile(join(root, 'approved.txt'), 'utf8')).rejects.toThrow();
    await grantPermissionOnce(request!);
    expect((await executeTool('write_file', { path: 'approved.txt', content: 'approved' }, toolContext, noDelegate)).content).toContain('Wrote approved.txt');
    expect(await readFile(join(root, 'approved.txt'), 'utf8')).toBe('approved');
    expect((await executeTool('write_file', { path: 'approved.txt', content: 'second attempt' }, toolContext, noDelegate)).waiting).toBe(true);
  });
});

describe('Agent SDK and observability enhancements', () => {
  test('supports external storage, custom in-process tools, and structured output validation', async () => {
    const storage = new InMemorySessionStorage<{ value: number }>(); await storage.save('s', { value: 1 }); expect(await storage.load('s')).toEqual({ value: 1 }); expect(await storage.list()).toEqual(['s']); await storage.delete('s'); expect(await storage.load('s')).toBeNull();
    const registry = new InProcessToolRegistry(); registry.register(defineInProcessTool({ name: 'sum', description: 'sum', input_schema: { type: 'object' } }, (input: { a: number; b: number }) => input.a + input.b)); expect(await registry.call('sum', { a: 2, b: 3 })).toBe(5);
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, count: { type: 'integer' } } }; expect(parseStructuredOutput('{"ok":true,"count":2}', schema)).toEqual({ ok: true, count: 2 }); expect(() => validateStructuredOutput({ ok: 'yes' }, schema)).toThrow('boolean');
  });
  test('records usage, produces insights, and exports OpenTelemetry metrics', async () => {
    await recordUsage({ sessionId: 's', agentId: 'lead', model: 'm', inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0, costUsd: 0.01, durationMs: 50, toolCalls: 2 });
    await recordUsage({ sessionId: 's', agentId: 'reviewer', model: 'm', inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.005, durationMs: 30, toolCalls: 1 });
    const records = await listUsage({ sessionId: 's' }); const summary = summarizeUsage(records); expect(summary.records).toBe(2); expect(summary.byAgent.lead?.tokens).toBe(120);
    expect((await usageInsights({ sessionId: 's' })).averageTokensPerTurn).toBe(90); expect(JSON.stringify(toOpenTelemetryMetrics(summary))).toContain('ccpt_tokens_total');
  });
});

describe('enterprise governance and deployment boundaries', () => {
  test('enforces RBAC, spend, provider, retention, and signed runner identity', () => {
    expect(authorize({ subject: 'u', organization: 'acme', roles: ['developer'] }, 'session.run', 'acme').allowed).toBe(true); expect(authorize({ subject: 'u', organization: 'acme', roles: ['viewer'] }, 'git.push').allowed).toBe(false);
    expect(evaluateSpend({ monthlyLimitUsd: 100, warningPercent: 80, hardLimit: true }, 95, 10)).toMatchObject({ allowed: false, warning: true, remainingUsd: 0 });
    const profile = providerProfile({ provider: 'foundry', model: 'deployment', endpointUrl: 'https://models.acme.test/openai' }); const configured = applyProviderProfile(structuredClone(defaultConfig), profile); expect(configured.model.apiKeyHeader).toBe('api-key'); expect(configured.network.allowedHosts).toContain('models.acme.test');
    const policy = { mode: 'zero-retention' as const, sessionDays: 30, auditDays: 365, allowFeedbackContent: false }; const created = '2026-01-01T00:00:00.000Z'; expect(retentionDeadline(created, policy, 'session')).toBe(created); expect(privacyBoundFeedback('secret', policy)).toEqual({ metadataOnly: true });
    const unsigned = { sessionId: 's', runnerId: 'r', organization: 'acme', expiresAt: new Date(Date.now() + 60_000).toISOString() }; const identity = signRunnerIdentity(unsigned, 'enterprise-secret'); expect(verifyRunnerIdentity(identity, 'enterprise-secret', 'acme')).toBe(true); expect(verifyRunnerIdentity(identity, 'wrong', 'acme')).toBe(false);
  });
  test('requires explicit healthy adapters for desktop, browser, computer-use, cloud, and IDE surfaces', async () => {
    const registry = new ExternalSurfaceRegistry(); registry.register({ name: 'browser', capabilities: ['navigate'], health: async () => ({ ready: true }), invoke: async (action, input) => ({ action, input }) });
    expect(registry.list()[0]?.capabilities).toEqual(['navigate']); expect(await registry.invoke('browser', 'navigate', { url: 'https://example.test' })).toEqual({ action: 'navigate', input: { url: 'https://example.test' } });
    await expect(registry.invoke('desktop', 'click', {})).rejects.toThrow('not installed'); await expect(registry.invoke('browser', 'click', {})).rejects.toThrow('does not support');
  });
  test('loads authenticated HTTP adapters for every external surface family', async () => {
    const previousToken = process.env.CCPT_SURFACE_TEST_TOKEN; process.env.CCPT_SURFACE_TEST_TOKEN = 'surface-secret';
    const server = Bun.serve({ port: 0, async fetch(request) {
      expect(request.headers.get('authorization')).toBe('Bearer surface-secret');
      if (new URL(request.url).pathname === '/health') return Response.json({ ready: true, detail: 'connected' });
      const body = await request.json() as { action: string; input: unknown };
      return Response.json({ result: { action: body.action, input: body.input } });
    } });
    try {
      const kinds: SurfaceKind[] = ['jetbrains', 'desktop', 'cloud', 'browser', 'computer-use', 'scm', 'identity', 'runner'];
      await writeFile(join(root, 'surfaces.json'), JSON.stringify({ adapters: kinds.map((kind) => ({ name: kind, kind, endpoint: `http://127.0.0.1:${server.port}`, tokenEnv: 'CCPT_SURFACE_TEST_TOKEN' })) }));
      const config = structuredClone(defaultConfig); const registry = await loadSurfaceRegistry(root, config, join(root, 'surfaces.json'));
      expect(registry.list()).toHaveLength(8);
      for (const kind of kinds) expect(registry.list().find((item) => item.name === kind)?.capabilities).toEqual(surfaceCapabilities[kind]);
      expect(await surfaceHealth(registry, 'browser')).toEqual([{ name: 'browser', ready: true, detail: 'connected' }]);
      expect(await registry.invoke('browser', 'navigate', { url: 'https://example.test' })).toEqual({ action: 'navigate', input: { url: 'https://example.test' } });
      expect(() => new HttpSurfaceAdapter({ name: 'bad', kind: 'browser', endpoint: 'http://external.test' }, config.network)).toThrow('HTTPS');
    } finally {
      server.stop(true);
      if (previousToken === undefined) delete process.env.CCPT_SURFACE_TEST_TOKEN; else process.env.CCPT_SURFACE_TEST_TOKEN = previousToken;
    }
  });
});
