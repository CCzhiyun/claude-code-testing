import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getOutputStyleDirStyles } from '../src/outputStyles/loadOutputStylesDir.js';
import { loadUserBindings } from '../src/keybindings/loadUserBindings.js';
import { migrateSettings } from '../src/migrations/index.js';
import { VimController } from '../src/vim/transitions.js';
import { createSession, saveSession } from '../src/sessions.js';
import { fetchLatestEvents, fetchOlderEvents } from '../src/assistant/sessionHistory.js';
import { coordinatorToolCatalog, getCoordinatorSystemPrompt } from '../src/coordinator/coordinatorMode.js';
import { tools } from '../src/tooling.js';
import { getRuntimeState, recordQuery, recordToolExecution, resetRuntimeState } from '../src/bootstrap/state.js';
import { defaultConfig } from '../src/config.js';
import { evaluatePermission } from '../src/utils/permissions/permissions.js';
import { permissionRuleValueFromString, permissionRuleValueToString } from '../src/utils/permissions/permissionRuleParser.js';
import { matchWildcardPattern } from '../src/utils/permissions/shellRuleMatching.js';

let root = '';
let previousHome: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccpt-editor-'));
  previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'home');
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

describe('output style, keybinding, migration, and Vim source modules', () => {
  test('loads output styles with project precedence over user styles', async () => {
    const userDirectory = join(root, 'home', 'output-styles');
    const projectDirectory = join(root, '.ccpt', 'output-styles');
    await mkdir(userDirectory, { recursive: true });
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(join(userDirectory, 'concise.md'), '---\nname: concise\ndescription: user\n---\nUser prompt');
    await writeFile(join(projectDirectory, 'concise.md'), '---\nname: concise\ndescription: project\nkeep-coding-instructions: true\n---\nProject prompt');
    const style = (await getOutputStyleDirStyles(root))[0];
    expect(style?.source).toBe('project');
    expect(style?.prompt).toBe('Project prompt');
    expect(style?.keepCodingInstructions).toBe(true);
  });

  test('loads user chords and supports explicit default unbinding', async () => {
    await writeFile(join(root, '.ccpt', 'keybindings.json'), JSON.stringify({ bindings: [{ context: 'Chat', bindings: { enter: null, 'ctrl+k ctrl+s': 'command:status' } }] }));
    const resolver = await loadUserBindings(root);
    expect(resolver.resolve('', { name: 'enter' }, ['Chat']).type).toBe('unbound');
    expect(resolver.resolve('k', { name: 'k', ctrl: true }, ['Chat']).type).toBe('chord_started');
    expect(resolver.resolve('s', { name: 's', ctrl: true }, ['Chat'])).toEqual({ type: 'match', action: 'command:status' });
  });

  test('migrates legacy settings deterministically and preserves policy intent', () => {
    const result = migrateSettings({ permissions: { mode: 'restricted' }, model: { url: 'http://127.0.0.1:1/v1' }, mcp: { local: { transport: 'stdio' } }, pluginDirectories: ['a', 'a'] });
    expect(result.to).toBe(3);
    expect((result.settings.policy as Record<string, unknown>).mode).toBe('restricted');
    expect((result.settings.model as Record<string, unknown>).baseUrl).toBe('http://127.0.0.1:1/v1');
    expect(result.settings.mcpServers).toBeDefined();
    expect(result.settings.pluginDirectories).toEqual(['a']);
  });

  test('executes Vim normal-mode motions and operators', () => {
    const vim = new VimController();
    let result = vim.handle('escape', 'hello world', 0);
    result = vim.handle('d', result.text, result.cursor);
    result = vim.handle('w', result.text, result.cursor);
    expect(result.text).toBe('world');
    expect(result.state.register).toBe('hello ');
    result = vim.handle('A', result.text, result.cursor);
    expect(result.state.mode).toBe('INSERT');
    expect(result.cursor).toBe(5);
  });

  test('paginates complete local session history across archived and live messages', async () => {
    const session = await createSession('history', root);
    session.archivedMessages = [{ role: 'user', content: 'old' }];
    session.messages = [{ role: 'assistant', content: 'middle' }, { role: 'user', content: 'new' }];
    await saveSession(session);
    const latest = await fetchLatestEvents(session.id, 2);
    expect(latest.events.map((event) => typeof event.message.content === 'string' ? event.message.content : '')).toEqual(['middle', 'new']);
    expect(latest.hasMore).toBe(true);
    const older = await fetchOlderEvents(session.id, latest.firstId!, 2);
    expect(older.events[0]?.message.content).toBe('old');
  });

  test('limits coordinator tools and records shared runtime metrics', () => {
    const coordinator = coordinatorToolCatalog(tools);
    expect(coordinator.some((tool) => tool.name === 'delegate')).toBe(true);
    expect(coordinator.some((tool) => tool.name === 'write_file')).toBe(false);
    expect(getCoordinatorSystemPrompt()).toContain('lead coordinator');
    resetRuntimeState(root);
    recordQuery(20);
    recordToolExecution(5);
    expect(getRuntimeState()).toMatchObject({ queryCount: 1, toolCount: 1, totalQueryDurationMs: 20, totalToolDurationMs: 5 });
  });

  test('parses escaped permission rules and applies deny-over-ask-over-allow precedence', () => {
    const parsed = permissionRuleValueFromString('run_command(node -e "print\\(1\\)")');
    expect(parsed.ruleContent).toBe('node -e "print(1)"');
    expect(permissionRuleValueToString(parsed)).toBe('run_command(node -e "print\\(1\\)")');
    expect(matchWildcardPattern('git *', 'git')).toBe(true);
    expect(matchWildcardPattern('git *', 'git status')).toBe(true);
    const config = structuredClone(defaultConfig);
    config.policy.permissionRules.allow = ['run_command(git *)'];
    config.policy.permissionRules.ask = ['run_command(git push *)'];
    config.policy.permissionRules.deny = ['run_command(git push origin main)'];
    expect(evaluatePermission('run_command', { command: 'git', args: ['status'] }, config)?.behavior).toBe('allow');
    expect(evaluatePermission('run_command', { command: 'git', args: ['push', 'origin', 'feature'] }, config)?.behavior).toBe('ask');
    expect(evaluatePermission('run_command', { command: 'git', args: ['push', 'origin', 'main'] }, config)?.behavior).toBe('deny');
  });
});
