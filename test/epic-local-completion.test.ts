import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeSessionGoal, listSessionGoals, setSessionGoal, updateSessionGoal } from '../src/automation.js';
import { createArtifact, refreshArtifactDataSources } from '../src/artifacts.js';
import { defaultConfig } from '../src/config.js';
import {
  LifecycleDispatcher,
  ManagedReview,
  acknowledgeTeammateShutdown,
  addQualityGate,
  approveMemberPlan,
  attachSupervisedAgent,
  auditTerminalAccessibility,
  buildAnalyticsDashboard,
  callWithModelFallback,
  createCommunicationKit,
  createDeepResearchWorkflow,
  createFanOutWorkflow,
  createReviewPlan,
  createIdeEditProposal,
  createIdePlanReview,
  createWorkflowRun,
  detectAccessibilityPreferences,
  decideIdeEditProposal,
  decideIdePlanReview,
  evaluateQualityGates,
  exportWorkflowBundle,
  importWorkflowBundle,
  lessonsForAudience,
  listIdeConversationState,
  listSupervisedAgents,
  listWorkflowRuns,
  loadTeamOrchestration,
  organizeSupervisedAgent,
  reconcileSupervisor,
  recordHypothesis,
  requestTeammateShutdown,
  resolveModelRoute,
  selectWinningHypothesis,
  setTeamDisplayMode,
  submitMemberPlan,
  updateWorkflowRun,
  workflowForRerun,
  MarketplaceRegistry,
  verifyMarketplaceArchive,
} from '../src/enhancements/index.js';
import type { UsageRecord } from '../src/usage.js';
import { includeWorktreeFiles } from '../src/worktree.js';

let root = ''; let previousHome: string | undefined;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ccpt-epic-local-')); previousHome = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'home'); });
afterEach(async () => { if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome; await rm(root, { recursive: true, force: true }); });

describe('model governance and complete lifecycle events', () => {
  test('resolves aliases, pins versions, selects advisor and fast routes, caps effort, and falls back', async () => {
    const policy = { defaultModel: 'sonnet', aliases: { sonnet: 'claude-sonnet', advisor: 'claude-opus' }, pins: { 'claude-sonnet': 'claude-sonnet-4-20260801' }, fallbacks: { 'claude-sonnet-fast': ['claude-sonnet-4-20260801', 'claude-haiku'] }, fastModels: { 'claude-sonnet-4-20260801': 'claude-sonnet-fast' }, advisorModel: 'advisor', availableModels: ['claude-sonnet-fast', 'claude-sonnet-4-20260801', 'claude-haiku', 'claude-opus'], maximumEffort: 'high' as const };
    const route = resolveModelRoute({ model: 'sonnet', fast: true, reasoningEffort: 'max' }, policy);
    expect(route).toMatchObject({ primary: 'claude-sonnet-fast', reasoningEffort: 'high', serviceTier: 'priority', usedAlias: true, pinned: true });
    const called: string[] = [];
    const result = await callWithModelFallback(route, async (model) => { called.push(model); if (model === 'claude-sonnet-fast') throw Object.assign(new Error('overloaded'), { status: 503 }); return 'ok'; });
    expect(result).toMatchObject({ value: 'ok', model: 'claude-sonnet-4-20260801', attempts: 2 }); expect(called).toHaveLength(2);
    expect(resolveModelRoute({ role: 'advisor' }, policy).primary).toBe('claude-opus');
  });

  test('emits every previously partial local Hook event through one ordered dispatcher', async () => {
    const config = structuredClone(defaultConfig); config.hooks = [];
    const dispatcher = new LifecycleDispatcher(config, root);
    expect(await dispatcher.submitPrompt('hello', 's')).toEqual({ prompt: 'hello', context: [] });
    await dispatcher.displayMessage('shown'); await dispatcher.stop({ sessionId: 's' }); await dispatcher.stop({ sessionId: 's' }, new Error('failed'));
    await dispatcher.teammateIdle('a'); await dispatcher.instructionsLoaded(['AGENTS.md']); await dispatcher.cwdChanged('a', 'b'); await dispatcher.directoryAdded('c'); await dispatcher.fileChanged('x.ts', 'modified'); await dispatcher.elicitation({ id: 'e' }); await dispatcher.elicitationResult({ id: 'e', accepted: true }); await dispatcher.sessionEnd('s', 'done');
    expect(dispatcher.history.map((item) => item.event)).toEqual(['UserPromptSubmit', 'UserPromptExpansion', 'MessageDisplay', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'Elicitation', 'ElicitationResult', 'SessionEnd']);
  });
});

describe('persistent supervisor and governed teams', () => {
  test('attaches, organizes, reconciles and detaches Agents across supervisor loads', async () => {
    await attachSupervisedAgent({ agentId: 'a1', sessionId: 's1', cwd: root, pid: 1234 });
    await organizeSupervisedAgent('a1', 'review');
    expect(await listSupervisedAgents({ group: 'review' })).toMatchObject([{ agentId: 'a1', state: 'attached' }]);
    expect(await reconcileSupervisor(() => false)).toMatchObject([{ agentId: 'a1', state: 'stale' }]);
  });

  test('supports display modes, plan-first approval, controlled shutdown, quality gates and competing hypotheses', async () => {
    await setTeamDisplayMode('team-1', 'grid'); await submitMemberPlan('team-1', 'reviewer', 'Inspect auth boundaries'); await approveMemberPlan('team-1', 'reviewer');
    await addQualityGate('team-1', { name: 'tests', metric: 'testsPassed', minimum: 100, blocking: true });
    let state = await recordHypothesis('team-1', { title: 'Cache race', evidence: ['trace'], ownerAgentId: 'a', score: 8 });
    state = await recordHypothesis('team-1', { title: 'Network race', evidence: ['logs'], ownerAgentId: 'b', score: 3 });
    await selectWinningHypothesis('team-1'); await requestTeammateShutdown('team-1', 'reviewer'); await acknowledgeTeammateShutdown('team-1', 'reviewer');
    state = await loadTeamOrchestration('team-1');
    expect(state).toMatchObject({ displayMode: 'grid', members: [{ agentId: 'reviewer', planApproved: true, state: 'stopped' }] });
    expect(state.hypotheses.find((item) => item.selected)?.title).toBe('Cache race');
    expect(evaluateQualityGates(state, { testsPassed: 99 }).passed).toBe(false); expect(evaluateQualityGates(state, { testsPassed: 100 }).passed).toBe(true);
  });
});

describe('durable workflow and goal runtime', () => {
  test('persists background runs and creates dependency-correct failure re-runs', async () => {
    const definition = { name: 'pipeline', tasks: [{ id: 'build', goal: 'build' }, { id: 'test', goal: 'test', dependsOn: ['build'] }, { id: 'ship', goal: 'ship', dependsOn: ['test'] }] };
    const run = await createWorkflowRun(definition, root); await updateWorkflowRun(run.id, { taskId: 'test', taskStatus: 'failed' }, root); await updateWorkflowRun(run.id, { status: 'failed' }, root);
    const persisted = (await listWorkflowRuns(root))[0]!; const rerun = workflowForRerun(persisted);
    expect(rerun.tasks.map((item) => item.id)).toEqual(['test', 'ship']); expect(rerun.tasks[0]?.dependsOn).toEqual([]);
  });

  test('builds bounded fan-out and deep-research workflows and verifies distributed bundles', () => {
    const fanout = createFanOutWorkflow('files', ['a.ts', 'b.ts'], (file) => `Review ${file}`, { isolation: 'worktree' }); expect(fanout.tasks).toHaveLength(2);
    const research = createDeepResearchWorkflow('Why?', ['docs', 'code']); expect(research.tasks.at(-1)?.dependsOn).toEqual(['research-1', 'research-2']);
    expect(importWorkflowBundle(exportWorkflowBundle(research))).toEqual(research);
    const tampered = exportWorkflowBundle(research).replace('Why?', 'How?'); expect(() => importWorkflowBundle(tampered)).toThrow('integrity');
  });

  test('persists one active goal per Session and retains completed goal history', async () => {
    const first = await setSessionGoal({ sessionId: 's', objective: 'ship', inputs: { branch: 'main' } }, root); expect((await activeSessionGoal('s', root))?.id).toBe(first.id);
    await updateSessionGoal(first.id, 'completed', root); const next = await setSessionGoal({ sessionId: 's', objective: 'observe' }, root);
    expect((await activeSessionGoal('s', root))?.id).toBe(next.id); expect(await listSessionGoals('s', root)).toHaveLength(2);
  });
});

describe('review, analytics, accessibility and adoption enhancements', () => {
  test('controls review effort, deduplicates findings and enforces a severity gate', () => {
    const plan = createReviewPlan({ scope: 'repository', effort: 'exhaustive', autoFix: true }); const review = new ManagedReview(plan);
    const finding = review.addFinding({ severity: 'high', title: 'Injection', description: 'Untrusted shell', file: 'a.ts', line: 1 }); review.addFinding({ severity: 'high', title: 'Injection', description: 'duplicate', file: 'a.ts', line: 1 });
    expect(review.findings).toHaveLength(1); expect(review.qualityGate('high').passed).toBe(false); review.updateFinding(finding.id, 'fixed'); expect(review.qualityGate('high').passed).toBe(true); expect(plan.maximumFiles).toBe(5_000);
  });

  test('builds a range-aware analytics dashboard and terminal visualization', async () => {
    const { renderAnalyticsDashboard } = await import('../src/enhancements/analyticsDashboard.js');
    const records: UsageRecord[] = [{ id: 'u', sessionId: 's', agentId: 'lead', model: 'm', inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0, costUsd: 0.1, durationMs: 200, toolCalls: 3, createdAt: '2026-08-31T00:00:00.000Z' }];
    const dashboard = buildAnalyticsDashboard(records); expect(dashboard.modelShare[0]).toMatchObject({ model: 'm', percent: 100 }); expect(renderAnalyticsDashboard(dashboard)).toContain('2026-08-31');
  });

  test('provides progressive lessons, champion materials and accessibility audits', () => {
    expect(lessonsForAudience('lead').map((item) => item.id)).toEqual(['first-run', 'context', 'parallel']); expect(createCommunicationKit().championChecklist.length).toBeGreaterThan(3);
    const preferences = detectAccessibilityPreferences({ NO_COLOR: '1', CCPT_SCREEN_READER: '1' }); expect(preferences.colorVision).toBe('monochrome'); expect(auditTerminalAccessibility({ width: 30, height: 8, colorDepth: 1, interactive: false }, preferences).passed).toBe(false);
  });
});

describe('marketplace, worktree, live Artifact and IDE enhancements', () => {
  test('syncs public and private organization marketplaces without persisting credentials and ranks recommendations', async () => {
    const bytes = new TextEncoder().encode('plugin archive');
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const registry = new MarketplaceRegistry([{ name: 'public', url: 'https://plugins.example/manifest.json' }, { name: 'acme', url: 'https://acme.example/manifest.json', private: true, tokenEnv: 'ACME_TOKEN', organization: 'acme' }]);
    const seen: Record<string, string>[] = [];
    await registry.sync(async (url, headers) => { seen.push(headers); return JSON.stringify({ schema: 1, ...(url.includes('acme') ? { organization: 'acme' } : {}), generatedAt: new Date().toISOString(), plugins: [{ name: url.includes('acme') ? 'secure-review' : 'typescript-tools', version: '1.0.0', description: 'x', archiveUrl: 'https://cdn.example/plugin.tgz', sha256, tags: url.includes('acme') ? ['security'] : ['typescript'], recommendedFor: ['backend'] }] }); }, { ACME_TOKEN: 'secret' });
    expect(seen).toEqual([{}, { authorization: 'Bearer secret' }]); expect(registry.recommend({ organization: 'acme', tags: ['security'] })[0]?.name).toBe('secure-review'); expect(verifyMarketplaceArchive(bytes, sha256)).toBe(true);
  });

  test('copies explicitly included regular files into a managed worktree without path escape', async () => {
    const repo = join(root, 'repo'); const target = join(root, '.ccpt-worktrees', 'repo', 'agent_0123456789abcdef'); await mkdir(join(repo, 'ignored'), { recursive: true }); await mkdir(target, { recursive: true }); await writeFile(join(repo, 'ignored', 'local.env.example'), 'safe');
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo, target];
    await expect(includeWorktreeFiles(repo, target, ['ignored/local.env.example'], config)).rejects.toThrow('Protected path');
    config.policy.protectedPatterns = []; // This fixture explicitly permits the public sample, not real credentials.
    expect(await includeWorktreeFiles(repo, target, ['ignored/local.env.example'], config)).toEqual(['ignored/local.env.example']); expect(await readFile(join(target, 'ignored', 'local.env.example'), 'utf8')).toBe('safe'); await expect(includeWorktreeFiles(repo, target, ['../escape'], config)).rejects.toThrow();
  });

  test('refreshes declared MCP data sources into an owned Artifact snapshot', async () => {
    const artifact = await createArtifact({ title: 'Live status', kind: 'json', content: '{}', owner: 'lead', dataSources: ['mcp://server/status'] }, root);
    const refreshed = await refreshArtifactDataSources(artifact.id, 'lead', async (uri) => ({ uri, healthy: true }), root);
    expect(refreshed.liveData?.['mcp://server/status']?.value).toEqual({ uri: 'mcp://server/status', healthy: true });
  });

  test('persists IDE plan decisions, edit acceptance and concurrent conversation review state', async () => {
    const plan = await createIdePlanReview('s1', 'Change the parser', root); await decideIdePlanReview(plan.id, 'approved', 'Proceed', root);
    const edit = await createIdeEditProposal({ sessionId: 's2', path: 'src/a.ts', before: 'a', after: 'b' }, root); await decideIdeEditProposal(edit.id, 'accepted', root);
    const state = await listIdeConversationState(root); expect(state.plans).toMatchObject([{ sessionId: 's1', status: 'approved' }]); expect(state.edits).toMatchObject([{ sessionId: 's2', status: 'accepted' }]);
  });
});
