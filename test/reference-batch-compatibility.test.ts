import { describe, expect, test } from 'bun:test';
import { extractHeredocs, parseShellScript, shellJoin, tokenizeShell } from '../src/utils/bash.js';
import { contextWindowForModel, filterAllowedModels, modelAllowed, normalizeModelId, normalizeModelStringForApi } from '../src/utils/model.js';
import { classifyShellCommand, yoloClassifier } from '../src/utils/permissions/classifier.js';
import { afterFirstRender, eventHook, REFERENCE_HOOK_ADAPTERS, referenceHookFamily, RuntimeHook } from '../src/hooks/runtimeAdapters.js';
import { BrandingFeed, logoVariant, renderBrandLogo } from '../src/components/branding.js';
import { renderSystemPanel, SurveyController, SYSTEM_PANEL_ADAPTERS, systemPanelKind } from '../src/components/systemPanels.js';
import { stripAnsi } from '../src/tui/presentation.js';
import { LOCAL_WORKFLOW_COMMANDS, localWorkflow } from '../src/commands/localWorkflows.js';
import { expandCommand } from '../src/platform.js';
import { resolveNativeCommand } from '../src/commands/catalog.js';
import { normalizeElicitationResponse, parseMcpDateTime } from '../src/utils/mcp.js';
import { buildQueryConfig } from '../src/query/config.js';
import { handleStopHooks } from '../src/query/stopHooks.js';
import { defaultConfig } from '../src/config.js';

describe('reference-driven shell, model and permission utilities', () => {
  test('parses quotes, wrappers, operators, heredocs and portable shell quoting', () => {
    const script = parseShellScript(`FOO=bar timeout 5s git status && echo "hello world"`);
    expect(script.commands).toHaveLength(2);
    expect(script.commands[0]).toMatchObject({ command: 'git', args: ['status'], assignments: { FOO: 'bar' }, wrappers: ['timeout'] });
    expect(script.operators).toEqual(['&&']);
    expect(tokenizeShell(`echo 'a b'`).map((token) => token.value)).toEqual(['echo', 'a b']);
    expect(shellJoin('printf', [`it's safe`, 'plain'])).toBe(`printf 'it'"'"'s safe' plain`);
    expect(extractHeredocs('cat <<EOF\nhello\nEOF')).toEqual([{ delimiter: 'EOF', body: 'hello', stripTabs: false }]);
  });

  test('normalizes model IDs, enforces allowlists and derives extended context', () => {
    expect(normalizeModelId('\u001b[1mopus[1m]\u001b[0m')).toBe('opus[1m]');
    expect(normalizeModelStringForApi('glm-5.2[1m]')).toBe('glm-5.2');
    expect(normalizeModelStringForApi('team-model[2M]')).toBe('team-model');
    expect(contextWindowForModel('opus[1m]', { allowExtendedContext: true })).toBe(1_000_000);
    expect(modelAllowed('opus[1m]', { availableModels: ['opus'] })).toBeTrue();
    expect(filterAllowedModels(['opus', 'haiku', 'opus'], { availableModels: ['opus'] })).toEqual(['opus']);
  });

  test('classifies destructive, compound, protected and auto-mode commands', () => {
    expect(classifyShellCommand('rm -rf build').behavior).toBe('deny');
    expect(classifyShellCommand('git status && npm test').behavior).toBe('ask');
    expect(classifyShellCommand('cat .ssh/id_rsa').behavior).toBe('deny');
    expect(classifyShellCommand('rg TODO src').behavior).toBe('allow');
    expect(yoloClassifier('git status && npm test').behavior).toBe('allow');
  });
  test('parses MCP absolute and relative dates and validates elicitation schemas', () => {
    const now = new Date('2026-08-30T00:00:00.000Z'); expect(parseMcpDateTime('in 5m', now).toISOString()).toBe('2026-08-30T00:05:00.000Z');
    expect(parseMcpDateTime('2026-09-01T12:00:00Z').toISOString()).toBe('2026-09-01T12:00:00.000Z');
    const request = { id: 'one', message: 'Choose', schema: { type: 'object' as const, properties: { answer: { type: 'string' } }, required: ['answer'] } };
    expect(normalizeElicitationResponse(request, { answer: 'yes' })).toEqual({ answer: 'yes' }); expect(() => normalizeElicitationResponse(request, {})).toThrow('required');
  });
});

describe('native runtime hook adapters', () => {
  test('covers every remaining reference hook family and manages lifecycle state', async () => {
    expect(Object.keys(REFERENCE_HOOK_ADAPTERS)).toHaveLength(40);
    expect(referenceHookFamily('hooks/useDirectConnect.ts')).toBe('remote');
    let renderCalls = 0;
    const firstRender = new RuntimeHook('render', afterFirstRender(() => { renderCalls += 1; }));
    await firstRender.start(); await firstRender.start(); expect(renderCalls).toBe(1); expect(firstRender.state.value.value).toBeTrue(); await firstRender.stop();
    const events = eventHook('offline'); const hook = new RuntimeHook('connection', events.adapter); await hook.start(); events.publish('ready'); expect(hook.state.value.value).toBe('ready'); await hook.stop();
  });
});

describe('native operational panels and branding', () => {
  test('renders responsive branding and deterministic notices', () => {
    expect(logoVariant(100)).toBe('full'); expect(logoVariant(50)).toBe('condensed'); expect(logoVariant(20)).toBe('mark');
    expect(stripAnsi(renderBrandLogo(80).join('\n'))).toContain('CCPT');
    const feed = new BrandingFeed([{ id: 'tip', text: 'Tip', priority: 1 }, { id: 'urgent', text: 'Urgent', priority: 99 }], true);
    expect(feed.current()?.id).toBe('urgent'); expect(feed.advance()?.id).toBe('urgent');
  });

  test('models system dialogs, progress, actions and feedback state', () => {
    expect(Object.keys(SYSTEM_PANEL_ADAPTERS)).toHaveLength(31); expect(systemPanelKind('components/TeleportProgress.tsx')).toBe('teleport');
    const rendered = stripAnsi(renderSystemPanel({ id: 'update', kind: 'update', title: 'Update available', detail: 'Downloading', progress: 0.5, actions: [{ id: 'later', label: 'Later' }, { id: 'install', label: 'Install', primary: true }] }, 70, 1).join('\n'));
    expect(rendered).toContain('50%'); expect(rendered).toContain('Install');
    const survey = new SurveyController(['rating', 'comment'], true); expect(survey.answer(5)).toBeFalse(); expect(survey.answer('great')).toBeTrue(); expect(survey.result()).toEqual({ rating: 5, comment: 'great' });
  });
});

describe('native local command workflows', () => {
  test('registers review, planning, commit and summary workflows with bounded expansion', () => {
    expect(LOCAL_WORKFLOW_COMMANDS).toHaveLength(9);
    const review = localWorkflow('/review'); expect(review?.plugin).toBe('native-workflows');
    expect(expandCommand(review!, 'src/security', process.cwd())).toContain('src/security');
    expect(resolveNativeCommand('/keybindings')?.category).toBe('configuration');
    expect(resolveNativeCommand('/ultraplan')?.category).toBe('workspace');
  });
});

describe('query boundary configuration and stop lifecycle', () => {
  test('builds deterministic gates and returns non-blocking stop context', async () => {
    const previous = process.env.CCPT_DISABLE_STREAMING_TOOLS; process.env.CCPT_DISABLE_STREAMING_TOOLS = '1';
    try { expect(buildQueryConfig('session:test')).toMatchObject({ sessionId: 'session:test', gates: { streamingToolExecution: false } }); }
    finally { if (previous === undefined) delete process.env.CCPT_DISABLE_STREAMING_TOOLS; else process.env.CCPT_DISABLE_STREAMING_TOOLS = previous; }
    const result = await handleStopHooks(structuredClone(defaultConfig), process.cwd(), { reason: 'done' }); expect(result).toEqual({ blockingErrors: [], preventContinuation: false, additionalContext: [] });
  });
});
