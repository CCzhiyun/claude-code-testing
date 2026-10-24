import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeybindingResolver } from '../src/keybindings/resolver.js';
import { loadUserBindings } from '../src/keybindings/loadUserBindings.js';
import { renderPromptBox, renderTranscriptEntry, renderTranscriptScrollbar, renderWelcome, stripAnsi, summarizeToolInput, tuiTheme } from '../src/tui/presentation.js';
import { buildModelChoices, configDialogRows, cycleEffort, permissionDialogItems, renderConfigDialog, renderEffortDialog, renderModelDialog, renderPermissionsDialog, renderSkillsDialog, sanitizeModelName, type ConfigDialogFacts, type ConfigDialogState } from '../src/components/commandDialogs.js';
import { defaultConfig } from '../src/config.js';
import { paletteViewport } from '../src/components/paletteViewport.js';
import { commandSubmissionForEnter } from '../src/components/paletteSelection.js';
import { renderWorkspaceTrustDialog } from '../src/components/trustDialog.js';
import { stringWidth } from '../src/ink/stringWidth.js';
import { renderLiveAgentActivity } from '../src/components/liveAgentActivity.js';

let root = '';
let workspace = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccpt-tui-product-'));
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('Claude-style native terminal presentation', () => {
  test('renders a compact welcome card, bordered multiline prompt, and tool timeline', () => {
    const welcome = stripAnsi(renderWelcome('0.20.0', 'test-model · normal', workspace, 80).join('\n'));
    expect(welcome).toContain('CCPT v0.20.0');
    expect(welcome).toContain('test-model · normal');
    expect(welcome).toContain('API Usage Billing');
    expect(welcome).not.toContain('●  ●');
    expect(welcome.split('\n')[0]?.length).toBe(80);

    const prompt = renderPromptBox('first line\nsecond line', 22, 60, 'shift+enter newline');
    const promptText = stripAnsi(prompt.lines.join('\n'));
    expect(promptText).toContain('╭');
    expect(promptText).toContain('> first line');
    expect(promptText).toContain('second line');
    expect(prompt.cursorRow).toBeGreaterThan(1);

    const slashPrompt = renderPromptBox('/model', 6, 60, '/ commands');
    expect(stripAnsi(slashPrompt.lines[1] ?? '')).toMatch(/^│ > \/model/);
    expect(renderPromptBox('', 0, 60, 'hint').cursorRow).toBe(1);
    expect(renderPromptBox('', 0, 60, 'hint').cursorColumn).toBe(5);
    expect(slashPrompt.cursorColumn).toBe(11);
    expect(renderPromptBox('/模', 2, 60, '/ commands').cursorColumn).toBe(8);
    const widePrompt = renderPromptBox('中'.repeat(30), 30, 30, 'hint');
    expect(widePrompt.lines.slice(0, -1).every((line) => stringWidth(line) === 30)).toBe(true);
    expect(widePrompt.cursorColumn).toBe(17);

    const tool = stripAnsi(renderTranscriptEntry({ role: 'tool', text: '', name: 'write_file', input: { path: 'src/app.ts' } }, 80).join('\n'));
    const result = stripAnsi(renderTranscriptEntry({ role: 'tool_result', text: 'Wrote src/app.ts' }, 80).join('\n'));
    expect(tool).toBe('● write_file(src/app.ts)');
    expect(result).toContain('⎿ Wrote src/app.ts');
    expect(summarizeToolInput('run_command', { command: 'npm', args: ['test'] })).toBe('npm');

    const collapsedError = stripAnsi(renderTranscriptEntry({ role: 'error', text: 'Request failed', detail: 'Request failed\n  at callModel (model.ts:1)' }, 80).join('\n'));
    expect(collapsedError).toContain('Ctrl+O to view full error details');
    const verboseError = stripAnsi(renderTranscriptEntry({ role: 'error', text: 'Request failed', detail: 'Request failed\n  at callModel (model.ts:1)' }, 80, { verbose: true }).join('\n'));
    expect(verboseError).toContain('at callModel');
    const collapsedDiagnostic = stripAnsi(renderTranscriptEntry({ role: 'system', text: 'Plugin diagnostics: 1 errors · 0 warnings', detail: 'ERROR · plugin · plugin.json\nInvalid manifest' }, 80).join('\n'));
    expect(collapsedDiagnostic).not.toContain('×');
    expect(collapsedDiagnostic).toContain('Ctrl+O to view full diagnostic details');
    const verboseDiagnostic = stripAnsi(renderTranscriptEntry({ role: 'system', text: 'Plugin diagnostics: 1 errors · 0 warnings', detail: 'ERROR · plugin · plugin.json\nInvalid manifest' }, 80, { verbose: true }).join('\n'));
    expect(verboseDiagnostic).toContain('Invalid manifest');
    const thought = stripAnsi(renderTranscriptEntry({ role: 'thinking', text: 'Thought for 3s', detail: 'Model: glm-5.2\nReasoning effort: high' }, 80).join('\n'));
    expect(thought).toContain('Thought for 3s (Ctrl+O to expand)');
    expect(stripAnsi(renderTranscriptEntry({ role: 'thinking', text: 'Thought for 3s', detail: 'Model: glm-5.2' }, 80, { verbose: true }).join('\n'))).toContain('Model: glm-5.2');

    const rail = renderTranscriptScrollbar(Array.from({ length: 5 }, () => ''), 20, 30, 0).map(stripAnsi);
    expect(rail.every((line) => stringWidth(line) === 20)).toBe(true);
    expect(rail.join('')).toContain('█');
  });

  test('keeps the selected slash command visible while the palette scrolls', () => {
    const commands = Array.from({ length: 12 }, (_, index) => `/command-${index + 1}`);
    expect(paletteViewport(commands, 6, 7)).toEqual({ items: commands.slice(0, 7), start: 0, selected: 6, above: 0, below: 5 });
    expect(paletteViewport(commands, 7, 7)).toEqual({ items: commands.slice(1, 8), start: 1, selected: 6, above: 1, below: 4 });
    expect(paletteViewport(commands, 11, 7)).toEqual({ items: commands.slice(5), start: 5, selected: 6, above: 5, below: 0 });
  });

  test('renders continuously changing thinking, response, tool, token and checklist activity', () => {
    const startedAt = '2026-09-02T00:00:00.000Z';
    const responding = stripAnsi(renderLiveAgentActivity({ turn: 0, text: 'Partial streamed answer', thinking: 'private reasoning', phase: 'responding', startedAt, updatedAt: '2026-09-02T00:00:02.000Z', outputTokens: 1_100 }, 100, '✻', Date.parse('2026-09-02T00:00:02.000Z'), ['  ⎿ ◼ Explore project context', '    ◻ Ask clarifying questions']).join('\n'));
    expect(responding).toContain('● Partial streamed answer');
    expect(responding).toContain('✻ Streaming response… (2s · ↑ 1.1k tokens · responding)');
    expect(responding).toContain('◼ Explore project context');
    const tool = stripAnsi(renderLiveAgentActivity({ turn: 0, text: '', phase: 'tool', startedAt, updatedAt: startedAt, activeTool: { name: 'read_file', input: { path: 'README.md' } } }, 100, '⠹', Date.parse('2026-09-02T00:00:03.000Z')).join('\n'));
    expect(tool).toContain('⠹ Running read file… (3s · ↑ ~0 tokens estimated · tool)');
  });

  test('executes the highlighted slash command on the first Enter press', () => {
    expect(commandSubmissionForEnter('/help', { name: '/help', kind: 'command' })).toBe('/help');
    expect(commandSubmissionForEnter('/hel', { name: '/help', kind: 'command' })).toBe('/help');
    expect(commandSubmissionForEnter('/model', { name: '/model', kind: 'command' })).toBe('/model');
    expect(commandSubmissionForEnter('/model glm-5.2', { name: '/model', kind: 'command' })).toBeUndefined();
  });

  test('renders the first-entry workspace trust gate with keyboard guidance', () => {
    const trust = stripAnsi(renderWorkspaceTrustDialog(workspace, { selected: 0 }, 100, 30).join('\n'));
    expect(trust).toContain('Accessing workspace:');
    expect(trust).toContain(workspace);
    expect(trust).toContain('Yes, I trust this folder');
    expect(trust).toContain('No, exit');
    expect(trust).toContain('Enter to confirm');
  });

  test('ships interruption, multiline, transcript, and permission-mode shortcuts', async () => {
    const resolver: KeybindingResolver = await loadUserBindings(workspace);
    expect(resolver.resolve('', { name: 'c', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:interrupt' });
    expect(resolver.resolve('', { name: 'return', shift: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:newline' });
    expect(resolver.resolve('', { name: 'o', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'transcript:toggle' });
    expect(resolver.resolve('', { name: 'tab', shift: true }, ['Chat'])).toEqual({ type: 'match', action: 'permission:cycleMode' });
    expect(resolver.resolve('', { name: 'r', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'history:search' });
    expect(resolver.resolve('', { name: 'f', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'transcript:search' });
    expect(resolver.resolve('', { name: 'p', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'file:search' });
    expect(resolver.resolve('', { name: 'd', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'app:exit' });
    expect(resolver.resolve('', { name: 'j', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:newline' });
    expect(resolver.resolve('', { name: 'b', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'task:background' });
    expect(resolver.resolve('', { name: 't', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'app:toggleTasks' });
    expect(resolver.resolve('', { name: 'p', meta: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:modelPicker' });
    expect(resolver.resolve('', { name: 't', meta: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:thinkingToggle' });
    expect(resolver.resolve('', { name: 'o', meta: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:fastMode' });
    expect(resolver.resolve('', { name: 'g', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:externalEditor' });
    expect(resolver.resolve('', { name: 'x', ctrl: true }, ['Chat']).type).toBe('chord_started');
    expect(resolver.resolve('', { name: 'e', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'chat:externalEditor' });
  });

  test('renders a searchable tabbed config dialog with editable settings and overflow hints', () => {
    const config = structuredClone(defaultConfig); config.model.name = 'glm-5.2[1m]'; config.model.thinkingEnabled = true;
    const facts: ConfigDialogFacts = { cwd: workspace, version: '0.34.0', plugins: 2, skills: 8, agents: 3, activeAgents: 1, tasks: 2, sessionMessages: 9, estimatedTokens: 1200 };
    const state: ConfigDialogState = { type: 'config', tab: 'Config', query: '', selected: 0, scroll: 0 };
    const rows = configDialogRows(config, 'Config', facts); expect(rows.length).toBeGreaterThanOrEqual(28); expect(rows.slice(0, 5).map((row) => row.label)).toEqual(['Auto-compact', 'Automatic summary mode (paid if semantic)', 'Show tips', 'Reduce motion', 'Thinking mode']);
    expect(rows.find(row => row.id === 'semanticCompact')).toMatchObject({ value: 'extractive', patch: { contextCompaction: { mode: 'semantic' } } });
    const rendered = stripAnsi(renderConfigDialog(config, state, facts, 100, 24).lines.join('\n'));
    expect(rendered).toContain('Settings'); expect(rendered).toContain('Status'); expect(rendered).toContain('Search settings…'); expect(rendered).toContain('Auto-compact'); expect(rendered).toContain('more below'); expect(rendered).toContain('Enter save');
    const previousSelected = tuiTheme.selected; tuiTheme.selected = '> '; const plain = renderConfigDialog(config, state, facts, 100, 24).lines.join('\n'); tuiTheme.selected = previousSelected; expect(plain).not.toContain('> ›');
    state.query = 'permission'; state.selected = 0; state.scroll = 0; expect(renderConfigDialog(config, state, facts, 100, 24).visibleRows.map((row) => row.id)).toEqual(['permission']);
  });

  test('renders a model picker with sanitized names, effort adjustment and session/default hints', () => {
    const config = structuredClone(defaultConfig); config.model.name = '\u001b[1mglm-5.2[1m]\u001b[0m'; config.model.availableModels = ['glm-5.2[1m]', 'team-sonnet'];
    expect(sanitizeModelName(config.model.name)).toBe('glm-5.2');
    const choices = buildModelChoices(config); expect(choices[0]).toMatchObject({ label: 'Default (recommended)', model: 'glm-5.2' }); expect(new Set(choices.map((choice) => choice.model)).size).toBe(2);
    const state = { type: 'model' as const, selected: 1, effort: cycleEffort('medium', 1), choices };
    const rendered = stripAnsi(renderModelDialog(state, config, 110, 28).join('\n')); expect(rendered).toContain('Select model'); expect(rendered).toContain('High effort (default)'); expect(rendered).toContain('Enter/d to set as default'); expect(rendered).toContain('s to use this session only'); expect(rendered).not.toContain('[1m]');
  });

  test('renders interactive effort and scoped permission management dialogs', () => {
    const config = structuredClone(defaultConfig);
    config.policy.permissionRules.allow = ['Bash(git status)'];
    const effort = stripAnsi(renderEffortDialog({ type: 'effort', effort: 'max' }, 100, 18).join('\n'));
    expect(effort).toContain('Set effort'); expect(effort).toContain('Max'); expect(effort).toContain('d to save as default');
    const permissions = stripAnsi(renderPermissionsDialog(config, { type: 'permissions', tab: 'Allow', selected: 0, adding: false, input: '' }, 100, 24).join('\n'));
    expect(permissions).toContain('Permissions'); expect(permissions).toContain('Allow'); expect(permissions).toContain('Bash(git status)'); expect(permissions).toContain('a add');
    expect(permissionDialogItems(config, 'Directories')).toEqual(config.policy.workspaceRoots);
    const previousSelected = tuiTheme.selected; tuiTheme.selected = '> ';
    const plainPermissions = renderPermissionsDialog(config, { type: 'permissions', tab: 'Mode', selected: 0, adding: false, input: '' }, 100, 24).join('\n');
    const plainModel = renderModelDialog({ type: 'model', selected: 0, effort: 'high', choices: buildModelChoices(config) }, config, 100, 24).join('\n');
    tuiTheme.selected = previousSelected;
    expect(plainPermissions).not.toContain('> >'); expect(plainModel).not.toContain('> >');
  });

  test('renders one Claude-style /skills panel with list and empty states', () => {
    const empty = stripAnsi(renderSkillsDialog({ type: 'skills', selected: 0, expanded: false, skills: [], workspaceDirectory: 'D:\\work\\demo\\.ccpt\\skills\\<name>\\SKILL.md' }, 100, 24).join('\n'));
    expect(empty).toContain('Skills');
    expect(empty).toContain('No skills found');
    expect(empty).toContain('Create a project Skill at:');
    expect(empty).toContain('D:\\work\\demo\\.ccpt\\skills');
    expect(empty).toContain('Only the current trusted workspace');
    expect(empty).not.toContain('User Skills');
    expect(empty).toContain('r to refresh');
    expect(empty).toContain('Esc to close');
    const listed = stripAnsi(renderSkillsDialog({ type: 'skills', selected: 0, expanded: false, skills: [{ name: 'verify', description: 'Verify the change', path: 'bundled:verify', source: 'configured', instructions: 'Run all relevant checks.' }] }, 100, 24).join('\n'));
    expect(listed).toContain('verify');
    expect(listed).toContain('[configured]');
    expect(listed).toContain('v view');
  });
});

describe('global CLI option parsing', () => {
  // Five cold source-CLI subprocesses are an integration scenario, not a 5 s
  // unit test. Windows measured 5.078 s in the full suite, then 4.5/4.4 s alone.
  // Keep every functional assertion; only give this process-startup fixture an
  // explicit deadline. Product HTTP/command/model timeouts are unchanged.
  test('does not treat --cwd as a default subcommand or entity id', async () => {
    const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
    // Fresh-install assertions must not inherit a developer's provider environment.
    const env: Record<string, string> = { CCPT_HOME: join(root, 'state') };
    for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
    const init = Bun.spawnSync([process.execPath, cli, 'init', '--cwd', workspace], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(init.exitCode).toBe(0);
    const agents = Bun.spawnSync([process.execPath, cli, 'agents', '--cwd', workspace], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(agents.exitCode).toBe(0);
    expect(agents.stderr.toString()).toBe('');
    expect(JSON.parse(agents.stdout.toString())).toEqual([]);
    const config = Bun.spawnSync([process.execPath, cli, 'config', '--cwd', workspace], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(config.exitCode).toBe(0);
    const initializedConfig = JSON.parse(config.stdout.toString());
    expect(initializedConfig.model.name).toBe(defaultConfig.model.name);
    expect(initializedConfig.model.provider).toBe('openai');
    expect(initializedConfig.model.baseUrl).toBe(defaultConfig.model.baseUrl);
    const help = Bun.spawnSync([process.execPath, cli, 'help'], { env, stdout: 'pipe', stderr: 'pipe' }).stdout.toString();
    expect(help).toContain('ccpt insights|usage');
    expect(help).toContain('ccpt artifacts');
    expect(Bun.spawnSync([process.execPath, cli, '--version'], { env, stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim()).toBe((await Bun.file(new URL('../package.json', import.meta.url)).json()).version);
  }, 20000);
});
