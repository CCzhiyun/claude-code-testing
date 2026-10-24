import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHooksSettings } from '../src/schemas/hooks.js';
import { AppStateStore } from '../src/state/AppStateStore.js';
import { createInitialAppState } from '../src/state/AppState.js';
import { onChangeAppState } from '../src/state/onChangeAppState.js';
import { colorDistance, nearestColor } from '../src/native-ts/color-diff/index.js';
import { buildFileIndex } from '../src/native-ts/file-index/index.js';
import { computeColumnLayout } from '../src/native-ts/yoga-layout/index.js';
import { validatePluginManifest } from '../src/types/plugin.js';
import { buildQueryConfig } from '../src/query/config.js';
import { decodeChunk, encodeChunk } from '../src/upstreamproxy/relay.js';
import { ndjsonSafeStringify } from '../src/cli/ndjsonSafeStringify.js';
import { StructuredMessageDecoder } from '../src/cli/structuredIO.js';
import { SseDecoder } from '../src/cli/transports/SSETransport.js';
import { SerialBatchEventUploader } from '../src/cli/transports/SerialBatchEventUploader.js';
import { findRelevantMemories } from '../src/memdir/findRelevantMemories.js';
import { pillLabel } from '../src/tasks/pillLabel.js';
import { BUNDLED_SKILLS } from '../src/skills/bundledSkills.js';
import { buildMcpSkill } from '../src/skills/mcpSkillBuilders.js';
import { loadSkills } from '../src/skills.js';
import { defaultConfig } from '../src/config.js';
import { CostTracker } from '../src/cost-tracker.js';
import { terminalWidth, truncateTerminal } from '../src/ink.js';
import { Companion } from '../src/buddy/companion.js';
import { renderCompanionSprite } from '../src/buddy/CompanionSprite.js';
import { groupMessagesByApiRound } from '../src/services/compact/grouping.js';
import { microcompactMessages, TIME_BASED_MC_CLEARED_MESSAGE } from '../src/services/compact/microCompact.js';
import { compact } from '../src/services/compact/compact.js';
import { canonicalManagedSettings, verifyManagedSettings } from '../src/services/remoteManagedSettings/securityCheck.js';
import { scanSecrets } from '../src/services/teamMemorySync/secretScanner.js';
import { assertTeamMemorySafe, redactTeamMemorySecrets } from '../src/services/teamMemorySync/teamMemSecretGuard.js';
import { mergeSettings } from '../src/services/settingsSync/index.js';
import { applyPolicyLimits } from '../src/services/policyLimits/index.js';
import { executeFileWrite } from '../src/tools/FileWriteTool/FileWriteTool.js';
import { executeFileEdit } from '../src/tools/FileEditTool/FileEditTool.js';
import { executeFileRead } from '../src/tools/FileReadTool/FileReadTool.js';
import { executeGlob } from '../src/tools/GlobTool/GlobTool.js';
import { executeGrep } from '../src/tools/GrepTool/GrepTool.js';
import { roughTokenCountEstimation } from '../src/services/tokenEstimation.js';
import { DiagnosticTrackingService } from '../src/services/diagnosticTracking.js';
import { processRateLimitHeaders } from '../src/services/rateLimitMocking.js';
import { getRateLimitWarning } from '../src/services/rateLimitMessages.js';
import { createLinkedTransportPair } from '../src/services/mcp/InProcessTransport.js';
import { expandEnvVarsInString } from '../src/services/mcp/envExpansion.js';
import { normalizeNameForMCP } from '../src/services/mcp/normalization.js';
import { validateElicitationResponse } from '../src/services/mcp/elicitationHandler.js';
import { buildDownloadPath } from '../src/services/api/filesApi.js';
import { withRetry } from '../src/services/api/withRetry.js';
import { ApiAuthenticationError, ApiError } from '../src/services/api/errors.js';
import { buildAuthorizationUrl, generateCodeChallenge, generateCodeVerifier, generateState, verifyState } from '../src/services/oauth/index.js';
import { _resetForTesting as resetAnalytics, attachAnalyticsSink, logEventAsync, stripProtoFields } from '../src/services/analytics/index.js';
import { extractMcpToolDetails, getFileExtensionForAnalytics } from '../src/services/analytics/metadata.js';
import { clearGrowthBookConfigOverrides, getFeatureValue_CACHED_MAY_BE_STALE, setGrowthBookConfigOverride } from '../src/services/analytics/growthbook.js';
import { clearTrackedMagicDocs, detectMagicDocHeader, getTrackedMagicDocs, registerMagicDoc, updateTrackedMagicDocs } from '../src/services/MagicDocs/magicDocs.js';
import { buildConsolidationPrompt } from '../src/services/autoDream/consolidationPrompt.js';
import { checkForLSPDiagnostics, getPendingLSPDiagnosticCount, registerPendingLSPDiagnostic, resetAllLSPDiagnosticState } from '../src/services/lsp/LSPDiagnosticRegistry.js';
import { formatDiagnosticsForAttachment } from '../src/services/lsp/passiveFeedback.js';
import { generateToolUseSummary } from '../src/services/toolUseSummary/toolUseSummaryGenerator.js';
import { disablePluginOp, enablePluginOp, getPluginInstallationFromV2, installPluginOp, uninstallPluginOp } from '../src/services/plugins/pluginOperations.js';
import { handleMcpjsonServerApprovals } from '../src/services/mcpServerApproval.js';
import { checkVoiceDependencies } from '../src/services/voice.js';
import { isVoiceStreamAvailable } from '../src/services/voiceStreamSTT.js';
import { executeBashTool, detectBlockedSleepPattern as detectBlockedBashSleep } from '../src/tools/BashTool/BashTool.js';
import { bashCommandIsSafe_DEPRECATED } from '../src/tools/BashTool/bashSecurity.js';
import { applySedSubstitution, parseSedEditCommand } from '../src/tools/BashTool/sedEditParser.js';
import { executePowerShellTool } from '../src/tools/PowerShellTool/PowerShellTool.js';
import { powershellCommandIsSafe } from '../src/tools/PowerShellTool/powershellSecurity.js';
import { executeConfigTool } from '../src/tools/ConfigTool/ConfigTool.js';
import { executeEnterPlanMode } from '../src/tools/EnterPlanModeTool/EnterPlanModeTool.js';
import { executeExitPlanMode } from '../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js';
import { isPlanMode } from '../src/tools/modeState.js';
import { getBuiltInAgents } from '../src/tools/AgentTool/builtInAgents.js';
import { parseAgentFromMarkdown } from '../src/tools/AgentTool/loadAgentsDir.js';
import { executeBrief } from '../src/tools/BriefTool/BriefTool.js';
import { executeCronCreate } from '../src/tools/ScheduleCronTool/CronCreateTool.js';
import { executeCronDelete } from '../src/tools/ScheduleCronTool/CronDeleteTool.js';
import { executeCronList } from '../src/tools/ScheduleCronTool/CronListTool.js';
import { executeSkillTool } from '../src/tools/SkillTool/SkillTool.js';
import { executeWebFetch } from '../src/tools/WebFetchTool/WebFetchTool.js';
import { executeWebSearch } from '../src/tools/WebSearchTool/WebSearchTool.js';
import { executeRemoteTrigger } from '../src/tools/RemoteTriggerTool/RemoteTriggerTool.js';
import { detectGitOperation } from '../src/tools/shared/gitOperationTracking.js';
import { executeTool } from '../src/tooling.js';

describe('reference-shaped source foundations', () => {
  test('validates persisted hook matcher structures', () => {
    const hooks = parseHooksSettings({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node check.js' }] }] });
    expect(hooks.PreToolUse?.[0]?.hooks[0]).toMatchObject({ event: 'PreToolUse', command: 'node check.js' });
    expect(() => parseHooksSettings({ Stop: [{ hooks: [{ type: 'http' }] }] })).toThrow('requires url');
  });

  test('publishes immutable app-state transitions to focused listeners', () => {
    const store = new AppStateStore(createInitialAppState('/workspace'));
    const changes: boolean[] = [];
    const unsubscribe = onChangeAppState(store, 'connected', (value) => changes.push(value));
    store.set({ connected: true }); store.set({ unreadMessages: 1 }); unsubscribe(); store.set({ connected: false });
    expect(changes).toEqual([true]);
  });

  test('provides native TypeScript color and layout fallbacks', () => {
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 })).toBe(0);
    expect(nearestColor({ r: 250, g: 0, b: 0 }, [{ r: 0, g: 0, b: 0 }, { r: 255, g: 0, b: 0 }])).toEqual({ r: 255, g: 0, b: 0 });
    const layout = computeColumnLayout({ children: [{ height: 20 }, { flexGrow: 1 }] }, 100, 100);
    expect(layout.children.map((child) => [child.y, child.height])).toEqual([[0, 20], [20, 80]]);
  });

  test('builds bounded deterministic file indexes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-index-'));
    try {
      await mkdir(join(root, 'nested')); await writeFile(join(root, 'b.txt'), 'bb'); await writeFile(join(root, 'nested', 'a.txt'), 'a');
      expect((await buildFileIndex(root)).map((entry) => entry.path)).toEqual(['b.txt', 'nested/a.txt']);
      await expect(buildFileIndex(root, { maxFiles: 1 })).rejects.toThrow('exceeds 1');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('validates plugin manifests and snapshots query gates', () => {
    expect(validatePluginManifest({ name: 'foundation', version: '1.2.3', skills: ['skills'] }).version).toBe('1.2.3');
    expect(() => validatePluginManifest({ name: '../bad', version: 'latest' })).toThrow();
    expect(buildQueryConfig('session-1').sessionId).toBe('session-1');
  });

  test('round-trips upstream CONNECT protobuf chunks and rejects malformed frames', () => {
    const payload = new Uint8Array(200_000).fill(7);
    expect(decodeChunk(encodeChunk(payload))).toEqual(payload);
    expect(decodeChunk(new Uint8Array([0x09, 0]))).toBeNull();
    expect(decodeChunk(new Uint8Array([0x0a, 10, 1]))).toBeNull();
  });

  test('handles circular NDJSON, fragmented structured IO, and SSE frames', () => {
    const circular: Record<string, unknown> = { count: 1n }; circular.self = circular;
    expect(ndjsonSafeStringify(circular)).toContain('[Circular]');
    const structured = new StructuredMessageDecoder();
    expect(structured.push('{"type":"pro')).toEqual([]);
    expect(structured.push('gress","data":1}\n')).toEqual([{ type: 'progress', data: 1 }]);
    const sse = new SseDecoder();
    expect(sse.push('event: message\ndata: one\ndata: two\n\n')).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  test('uploads batches serially without dropping failed items', async () => {
    const batches: number[][] = [];
    const uploader = new SerialBatchEventUploader<number>(async (batch) => { batches.push(batch); }, 2);
    uploader.enqueue(1); uploader.enqueue(2); uploader.enqueue(3); await uploader.flush();
    expect(batches).toEqual([[1, 2], [3]]); expect(uploader.pending).toBe(0);
  });

  test('ranks relevant memories and renders task status pills', () => {
    const now = new Date().toISOString();
    const results = findRelevantMemories([{ id: 'm1', scope: 'project', title: 'Database migration', content: 'Postgres schema rollout', tags: ['database'], createdAt: now, updatedAt: now }], 'database schema');
    expect(results[0]?.memory.id).toBe('m1');
    expect(pillLabel('waiting_for_input')).toBe('Needs input');
  });

  test('loads bundled skills with project override semantics and builds MCP skills', async () => {
    expect(BUNDLED_SKILLS.some((skill) => skill.name === 'verify')).toBe(true);
    const config = structuredClone(defaultConfig); config.skillsDirectories = [];
    expect((await loadSkills(config)).some((skill) => skill.path === 'bundled:debug')).toBe(true);
    expect(buildMcpSkill('internal', 'deploy', 'Deploy safely', ['preview']).tools).toEqual(['mcp__internal__preview']);
  });

  test('tracks configurable model cost and renders terminal-safe companion state', () => {
    const tracker = new CostTracker();
    expect(tracker.add({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputPerMillion: 2, outputPerMillion: 4 })).toBe(4);
    expect(terminalWidth('A中')).toBe(3); expect(truncateTerminal('abcdef', 4)).toBe('abc…');
    const companion = new Companion(); expect(companion.updateAgent('completed').mood).toBe('celebrating');
    expect(renderCompanionSprite('idle')).toContain('/\\_/\\');
  });

  test('groups API rounds, clears only old tool results, and archives compacted history', () => {
    const messages = [
      { role: 'user' as const, content: 'start' },
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'Read', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 't1', content: 'old result' }] },
      { role: 'assistant' as const, content: 'next round' },
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 't2', content: 'new result' }] },
    ];
    expect(groupMessagesByApiRound(messages)).toHaveLength(2);
    const micro = microcompactMessages(messages, 1);
    expect((micro.messages[2]!.content as Array<{ content?: string }>)[0]?.content).toBe(TIME_BASED_MC_CLEARED_MESSAGE);
    expect((micro.messages[4]!.content as Array<{ content?: string }>)[0]?.content).toBe('new result');
    const many = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `message-${index}-${'x'.repeat(100)}` }));
    const result = compact({ id: 's', title: 's', cwd: '/w', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: many }, 100);
    expect(result.archivedMessages).toBeGreaterThan(0); expect(result.session.messages[0]?.content).toContain('Earlier conversation summary');
  });

  test('verifies signed managed settings and rejects tampering', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const now = Date.now();
    const unsigned = { version: 1 as const, issuedAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), settings: { policy: { allowNetwork: false } }, keyId: 'enterprise' };
    const signature = sign(null, Buffer.from(canonicalManagedSettings(unsigned)), privateKey).toString('base64');
    const envelope = { ...unsigned, signature }; const keys = { enterprise: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    expect(() => verifyManagedSettings(envelope, keys, now)).not.toThrow();
    expect(() => verifyManagedSettings({ ...envelope, settings: { changed: true } }, keys, now)).toThrow('signature');
  });

  test('blocks secrets from team memory and enforces centrally capped settings', () => {
    const content = 'deploy token=super-secret-value'; expect(scanSecrets(content)).toHaveLength(1);
    expect(() => assertTeamMemorySafe(content)).toThrow('possible secret'); expect(redactTeamMemorySecrets(content)).toContain('[redacted:credential-assignment]');
    const config = structuredClone(defaultConfig); config.agents.maxConcurrent = 10; config.policy.allowNetwork = true;
    const limited = applyPolicyLimits(config, { maxConcurrentAgents: 2, denyNetwork: true }); expect(limited.agents.maxConcurrent).toBe(2); expect(limited.policy.allowNetwork).toBe(false);
    const merged = mergeSettings({ version: 1, revision: 1, updatedAt: '2025-01-01', settings: { model: { name: 'a' } } }, { version: 1, revision: 2, updatedAt: '2025-01-02', settings: { model: { name: 'b' } } });
    expect(merged.record.settings).toEqual({ model: { name: 'b' } }); expect(merged.conflicts[0]?.path).toBe('model.name');
  });

  test('executes reference-shaped file tools under workspace policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-files-')); const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
    const context = { cwd: root, agentId: 'a', sessionId: 's', depth: 0, config };
    try {
      await executeFileWrite({ path: 'src/value.ts', content: 'export const value = 1;\n' }, context);
      await executeFileEdit({ path: 'src/value.ts', oldText: 'value = 1', newText: 'value = 2' }, context);
      expect((await executeFileRead({ path: 'src/value.ts' }, context)).content).toContain('value = 2');
      expect(await executeGlob({ pattern: '**/*.ts' }, context)).toEqual(['src/value.ts']);
      expect((await executeGrep({ query: 'value = 2' }, context))[0]).toMatchObject({ path: 'src/value.ts', line: 1 });
      config.policy.mode = 'restricted'; await expect(executeFileWrite({ path: 'blocked.ts', content: '' }, context)).rejects.toThrow('restricted');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('estimates multilingual tokens, diffs diagnostics, and parses rate limits', () => {
    expect(roughTokenCountEstimation('hello世界')).toBeGreaterThan(1);
    const tracking = new DiagnosticTrackingService(); const base = { uri: 'file:///a.ts', diagnostics: [{ message: 'old', severity: 'Warning' as const, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }] }; tracking.capture(base);
    const diff = tracking.compare({ uri: 'file:///A.ts', diagnostics: [{ message: 'new', severity: 'Error', range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } } }] }); expect(diff.added).toHaveLength(1); expect(diff.removed).toHaveLength(1);
    const limit = processRateLimitHeaders({ 'x-ratelimit-status': 'warning', 'x-ratelimit-utilization': '0.9' }); expect(getRateLimitWarning(limit)).toContain('90%');
  });

  test('expands MCP configuration, validates elicitation, and links in-process transports', async () => {
    expect(expandEnvVarsInString('${TOKEN}-${MISSING:-fallback}', { TOKEN: 'ok' })).toEqual({ expanded: 'ok-fallback', missingVars: [] });
    expect(normalizeNameForMCP('team tools.v2')).toBe('team_tools_v2');
    expect(validateElicitationResponse({ id: 'e1', message: 'choose', schema: { type: 'object', properties: { answer: {} }, required: ['answer'] } }, { answer: 'yes' })).toEqual({ answer: 'yes' });
    expect(() => validateElicitationResponse({ id: 'e1', message: 'choose', schema: { type: 'object', required: ['answer'] } }, {})).toThrow('answer');
    const [left, right] = createLinkedTransportPair(); const received: unknown[] = []; right.onmessage = (message) => received.push(message); await left.send({ jsonrpc: '2.0', id: 1, method: 'ping' }); await new Promise((resolve) => queueMicrotask(resolve)); expect(received).toEqual([{ jsonrpc: '2.0', id: 1, method: 'ping' }]); await left.close(); await expect(right.send({ jsonrpc: '2.0', method: 'late' })).rejects.toThrow('closed');
  });

  test('contains API downloads, retries transient failures, and refuses authentication retries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-download-'));
    try {
      expect(buildDownloadPath(root, 'session-1', 'nested/file.bin')).toBe(join(root, 'session-1', 'uploads', 'nested', 'file.bin'));
      expect(buildDownloadPath(root, 'session-1', '../../outside.bin')).toBeNull();
      let attempts = 0;
      await expect(withRetry(async () => { attempts += 1; if (attempts < 3) throw new ApiError('temporary', 503); return 'ok'; }, { attempts: 3, baseDelayMs: 1 })).resolves.toBe('ok');
      expect(attempts).toBe(3);
      attempts = 0;
      await expect(withRetry(async () => { attempts += 1; throw new ApiAuthenticationError(); }, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('authentication');
      expect(attempts).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('builds PKCE OAuth requests and compares callback state safely', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
    expect(verifyState(state, state)).toBe(true);
    expect(verifyState(`${state}x`, state)).toBe(false);
    const url = new URL(buildAuthorizationUrl('https://login.example.test/authorize', { clientId: 'ccpt', redirectUri: 'http://127.0.0.1/callback', state, codeChallenge: challenge, scopes: ['profile', 'offline_access'] }));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('profile offline_access');
  });

  test('routes privacy-bounded analytics and applies local feature overrides', async () => {
    const received: Array<{ name: string; metadata: unknown }> = [];
    resetAnalytics();
    const detach = attachAnalyticsSink({ log: (name, metadata) => { received.push({ name, metadata }); } });
    await logEventAsync('tool.complete', { duration_ms: 12 });
    expect(received).toEqual([{ name: 'tool.complete', metadata: { duration_ms: 12 } }]);
    expect(stripProtoFields<Record<string, unknown>>({ keep: 1, $private: 2, nested: { $drop: true, value: 'ok' } })).toEqual({ keep: 1, nested: { value: 'ok' } });
    expect(extractMcpToolDetails('mcp__registry__search')).toEqual({ serverName: 'registry', toolName: 'search' });
    expect(getFileExtensionForAnalytics('src/app.TS')).toBe('.ts');
    setGrowthBookConfigOverride('safe-mode', true);
    expect(getFeatureValue_CACHED_MAY_BE_STALE('safe-mode', false)).toBe(true);
    clearGrowthBookConfigOverrides(); detach(); resetAnalytics();
  });

  test('detects and safely updates registered Magic Docs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-magic-doc-'));
    const path = join(root, 'ARCHITECTURE.md');
    try {
      await writeFile(path, '# MAGIC DOC: Architecture\n\n_Keep deployment decisions current_\n\nOld content.\n');
      expect(detectMagicDocHeader(await Bun.file(path).text())).toEqual({ title: 'Architecture', instructions: 'Keep deployment decisions current' });
      clearTrackedMagicDocs(); registerMagicDoc(path); expect(getTrackedMagicDocs()).toEqual([path]);
      const updates: string[] = []; const result = await updateTrackedMagicDocs(async ({ prompt }) => { updates.push(prompt); });
      expect(result.updated).toEqual([path]); expect(updates[0]).toContain('Preserve the MAGIC DOC header');
    } finally { clearTrackedMagicDocs(); await rm(root, { recursive: true, force: true }); }
  });

  test('builds consolidation prompts, deduplicates LSP diagnostics, and summarizes tools', async () => {
    const prompt = buildConsolidationPrompt([{ id: 'session_0000000000000000', title: 'Delivery', cwd: '/w', createdAt: '2025-01-01', updatedAt: '2025-01-01', messages: [{ role: 'user', content: 'Use blue-green deploys' }] }]);
    expect(prompt).toContain('blue-green deploys');
    resetAllLSPDiagnosticState();
    const [file] = formatDiagnosticsForAttachment({ uri: 'file:///tmp/app.ts', diagnostics: [{ message: 'broken', severity: 1, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } } }] });
    registerPendingLSPDiagnostic(file!, 'typescript'); expect(getPendingLSPDiagnosticCount()).toBe(1); expect(checkForLSPDiagnostics()).toHaveLength(1);
    registerPendingLSPDiagnostic(file!, 'typescript'); expect(checkForLSPDiagnostics()).toHaveLength(0);
    expect(await generateToolUseSummary({ toolName: 'FileRead', input: { path: 'src/app.ts' } })).toBe('Completed FileRead: src/app.ts');
  });

  test('installs scoped plugins and persists enable state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-plugin-op-')); const source = join(root, 'source', 'downloaded-bundle'); const workspace = join(root, 'workspace');
    try {
      await mkdir(source, { recursive: true }); await mkdir(workspace, { recursive: true });
      await writeFile(join(source, 'plugin.json'), JSON.stringify({ schemaVersion: 1, name: 'quality-pack', version: '1.0.0' }));
      expect((await installPluginOp(source, 'project', workspace)).success).toBe(true);
      await disablePluginOp('quality-pack', 'project', workspace); expect((await getPluginInstallationFromV2('quality-pack', 'project', workspace))?.enabled).toBe(false);
      await enablePluginOp('quality-pack', 'project', workspace); expect((await getPluginInstallationFromV2('quality-pack', 'project', workspace))?.enabled).toBe(true);
      await uninstallPluginOp('quality-pack', 'project', workspace); expect(await getPluginInstallationFromV2('quality-pack', 'project', workspace)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('records MCP config approvals and exposes explicit voice availability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-mcp-approval-'));
    try {
      let prompts = 0; const servers = { local: { transport: 'stdio' as const, command: 'node', args: ['server.js'] } };
      expect((await handleMcpjsonServerApprovals(root, servers, async () => { prompts += 1; return true; })).approved).toEqual(['local']);
      await handleMcpjsonServerApprovals(root, servers, async () => { prompts += 1; return false; }); expect(prompts).toBe(1);
      expect(typeof (await checkVoiceDependencies()).available).toBe('boolean');
      expect(isVoiceStreamAvailable({ CCPT_VOICE_STREAM_URL: 'ws://localhost', CCPT_VOICE_STREAM_TOKEN: 'token' })).toBe(true);
      expect(isVoiceStreamAvailable({})).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('executes Bash and PowerShell-shaped tools through the enterprise command boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-shell-tools-')); const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
    const context = { cwd: root, agentId: 'shell-agent', sessionId: 'shell-session', depth: 0, config };
    try {
      const bash = await executeBashTool({ command: 'node -e "console.log(\'bash-safe\')"' }, context); expect(bash.stdout.trim()).toBe('bash-safe');
      const powershell = await executePowerShellTool({ command: 'node -e "console.log(\'ps-safe\')"' }, context); expect(powershell.stdout.trim()).toBe('ps-safe');
      expect(bashCommandIsSafe_DEPRECATED('git status --short')).toBe(true); expect(bashCommandIsSafe_DEPRECATED('rm -rf .')).toBe(false);
      expect(powershellCommandIsSafe('Get-Content README.md')).toBe(true); expect(powershellCommandIsSafe('Invoke-Expression payload')).toBe(false);
      expect(detectBlockedBashSleep('sleep 120')).toContain('60 seconds');
      expect(parseSedEditCommand("sed -i 's/old/new/g' file.txt")?.files).toEqual(['file.txt']);
      expect(applySedSubstitution('old old', 's/old/new/g')).toBe('new new');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('persists supported config and enforces session-scoped plan transitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-control-tools-')); const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
    const context = { cwd: root, agentId: 'control-agent', sessionId: 'control-session', depth: 0, config };
    try {
      expect((await executeConfigTool({ action: 'set', key: 'vimMode', value: true }, context)).updated).toBe(true);
      expect(JSON.parse(await Bun.file(join(root, '.ccpt', 'settings.json')).text()).vimMode).toBe(true);
      expect(executeEnterPlanMode(context)).toEqual({ planMode: true }); expect(isPlanMode(context.sessionId)).toBe(true);
      expect(() => executeExitPlanMode('short', context)).toThrow('concrete plan');
      expect(executeExitPlanMode('Inspect the code, implement the change, and run all relevant tests.', context).planMode).toBe(true);
      expect(isPlanMode(context.sessionId)).toBe(true); // Submitting a Plan is not human approval.
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('loads Agent and Skill tools, validates briefs, schedules jobs, and uses policy-bound web tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccpt-large-tool-batch-')); const priorHome = process.env.CCPT_HOME; const priorSearch = process.env.CCPT_WEB_SEARCH_URL; process.env.CCPT_HOME = join(root, 'state');
    const server = Bun.serve({ port: 0, fetch(request) { const url = new URL(request.url); if (url.pathname === '/page') return new Response('<html><body><h1>Enterprise guide</h1><p>Policy-bound fetch works.</p></body></html>', { headers: { 'content-type': 'text/html' } }); if (url.pathname === '/search') return Response.json({ results: [{ title: 'Guide', url: `${url.origin}/page`, snippet: 'Policy-bound fetch works.' }] }); if (url.pathname === '/trigger') return Response.json({ accepted: true }); return new Response('missing', { status: 404 }); } });
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root]; config.network.allowedHosts = ['127.0.0.1']; const context = { cwd: root, agentId: 'large-tools-agent', sessionId: 'large-tools-session', depth: 0, config };
    try {
      process.env.CCPT_WEB_SEARCH_URL = `http://127.0.0.1:${server.port}/search`;
      expect(getBuiltInAgents().map((agent) => agent.agentType)).toContain('verification');
      expect(parseAgentFromMarkdown('---\nname: reviewer\ndescription: Review changes\n---\nInspect and report.').agentType).toBe('reviewer');
      expect((await executeSkillTool({ skill: 'verify' }, context)).instructions.length).toBeGreaterThan(20);
      await writeFile(join(root, 'result.txt'), 'verified'); expect((await executeBrief({ message: 'Done', attachments: ['result.txt'] }, context)).attachments[0]?.name).toBe('result.txt');
      const job = await executeCronCreate({ expression: '0 9 * * 1-5', prompt: 'Review open changes' }, root); expect((await executeCronList(root)).jobs[0]?.id).toBe(job.id); expect((await executeCronDelete(job.id)).deleted).toBe(true);
      expect((await executeWebFetch({ url: `http://127.0.0.1:${server.port}/page`, prompt: 'policy fetch' }, context)).content).toContain('Policy-bound fetch works');
      expect((await executeWebSearch({ query: 'guide' }, context)).results[0]?.title).toBe('Guide');
      expect((await executeRemoteTrigger({ url: `http://127.0.0.1:${server.port}/trigger`, payload: { action: 'review' } }, context)).response).toEqual({ accepted: true });
      let delegated = ''; await executeTool('agent', { prompt: 'Inspect the parser', agent_type: 'explore' }, context, async (goal, role) => { delegated = `${role}:${goal}`; return 'started'; }); expect(delegated).toBe('explore:Inspect the parser');
      expect(detectGitOperation('git commit -m test', '[main abcdef1] test')).toMatchObject({ type: 'commit', id: 'abcdef1' });
    } finally { server.stop(true); if (priorHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = priorHome; if (priorSearch === undefined) delete process.env.CCPT_WEB_SEARCH_URL; else process.env.CCPT_WEB_SEARCH_URL = priorSearch; await rm(root, { recursive: true, force: true }); }
  });
});
