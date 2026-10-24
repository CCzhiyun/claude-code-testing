import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defaultConfig, validateConfig } from '../src/config.js';
import { cycleEffort, navigateConfig, renderConfigDialog, renderModelDialog, type ConfigDialogFacts, type ConfigDialogState } from '../src/components/commandDialogs.js';
import { navigateResource, renderResourceDialog, resourceItems, sessionItems, type ResourceDialogState } from '../src/components/resourceDialog.js';
import { sessionTranscript } from '../src/components/sessionTranscript.js';
import { stripAnsi } from '../src/tui/presentation.js';
import { stringWidth } from '../src/ink/stringWidth.js';
import { resolveModelRoute } from '../src/enhancements/modelRouting.js';
import type { SessionRecord } from '../src/types.js';

const cwd = resolve('fixture-workspace');
const facts: ConfigDialogFacts = { cwd, version: 'test', plugins: 0, skills: 0, agents: 0, activeAgents: 0, tasks: 0, sessionMessages: 0, estimatedTokens: 0 };
const session = (id: string, directory = cwd): SessionRecord => ({ id, cwd: directory, title: `Conversation ${id}`, createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'world' }] });
const picker = (): ResourceDialogState => ({ type: 'resource', kind: 'resume', title: 'Resume session', query: '', selected: 0, tab: 0, tabs: ['Conversations'], groups: [sessionItems([session('a'), session('b', resolve('other-project'))])], expanded: false, cwd, allProjects: false });

describe('observed terminal interaction contracts', () => {
  test('resume picker scopes to project, explicitly switches all projects, searches and cancels in layers', () => {
    const state = picker();
    expect(resourceItems(state).map((item) => item.id)).toEqual(['a']);
    navigateResource(state, 'a', '', true);
    expect(resourceItems(state)).toHaveLength(2);
    navigateResource(state, '', 'Conversation b');
    expect(resourceItems(state)[0]?.id).toBe('b');
    expect(navigateResource(state, 'return')).toBe('select');
    expect(navigateResource(state, 'escape')).toBeUndefined();
    expect(state.query).toBe('');
    expect(navigateResource(state, 'escape')).toBe('close');
  });

  test('empty picker cannot select; navigation and filtering keep selected row visible', () => {
    const state = picker();
    state.groups = [sessionItems(Array.from({ length: 30 }, (_, index) => session(String(index))))];
    navigateResource(state, 'end');
    expect(state.selected).toBe(29);
    const screen = renderResourceDialog(state, 60, 16);
    expect(stripAnsi(screen.join('\n'))).toContain('Conversation 29');
    expect(screen.every((line) => stringWidth(line) <= 60)).toBe(true);
    navigateResource(state, '', 'not-found');
    expect(state.selected).toBe(0);
    expect(navigateResource(state, 'return')).toBeUndefined();
    expect(stripAnsi(renderResourceDialog(state, 60, 16).join('\n'))).toContain('No conversations');
  });

  test('agent tabs clear detail state and selection; escape first closes detail', () => {
    const state = picker(); state.kind = 'agents'; state.tabs = ['Running', 'Library'];
    state.groups = [[{ id: '1', label: 'Agent', description: 'working' }], []];
    state.expanded = true;
    expect(navigateResource(state, 'escape')).toBeUndefined();
    expect(state.expanded).toBe(false);
    navigateResource(state, 'right');
    expect(state.tab).toBe(1);
    expect(navigateResource(state, 'return')).toBeUndefined();
  });

  test('settings start in search; selection does not write; Space stages and Enter saves', () => {
    const config = structuredClone(defaultConfig);
    const state: ConfigDialogState = { type: 'config', tab: 'Config', query: '', selected: 0, scroll: 0, focus: 'search' };
    expect(navigateConfig(state, config, facts, 'return')).toBeUndefined();
    expect(state.focus).toBe('rows');
    expect(state.pending).toBeUndefined();
    navigateConfig(state, config, facts, 'space', ' ');
    expect(state.draft?.ui.autoCompact).toBe(!config.ui.autoCompact);
    expect(state.pending).toEqual({ ui: { autoCompact: !config.ui.autoCompact } });
    expect(config).toEqual(defaultConfig);
    expect(navigateConfig(state, config, facts, 'return')).toBe('save');
    const screen = renderConfigDialog(config, state, facts, 60, 24).lines;
    expect(stripAnsi(screen.join('\n'))).toContain('Space change');
    expect(screen.every((line) => stringWidth(line) <= 60)).toBe(true);
  });

  test('settings Escape clears search, selects rows, then cancels without mutating config', () => {
    const config = structuredClone(defaultConfig);
    const state: ConfigDialogState = { type: 'config', tab: 'Config', query: 'compact', selected: 0, scroll: 0, focus: 'search' };
    navigateConfig(state, config, facts, 'escape'); expect(state.query).toBe('');
    navigateConfig(state, config, facts, 'escape'); expect(state.focus).toBe('rows');
    navigateConfig(state, config, facts, 'space', ' ');
    expect(navigateConfig(state, config, facts, 'escape')).toBe('close');
    expect(config).toEqual(defaultConfig);
  });

  test('supports xhigh throughout configuration, effort slider and routing caps', () => {
    expect(cycleEffort('high', 1)).toBe('xhigh');
    expect(cycleEffort('xhigh', 1)).toBe('max');
    const config = structuredClone(defaultConfig); config.model.reasoningEffort = 'xhigh';
    expect(() => validateConfig(config)).not.toThrow();
    expect(resolveModelRoute({ reasoningEffort: 'max' }, { defaultModel: 'test', maximumEffort: 'xhigh' }).reasoningEffort).toBe('xhigh');
  });

  test('model picker scrolls to selected item beyond first viewport', () => {
    const choices = Array.from({ length: 30 }, (_, index) => ({ id: String(index), label: `model-${index}`, model: `model-${index}`, description: 'fixture', current: false, isDefault: false }));
    expect(stripAnsi(renderModelDialog({ type: 'model', selected: 29, effort: 'high', choices }, defaultConfig, 80, 24).join('\n'))).toContain('model-29');
  });

  test('restores text and tool transcript without executing or mutating saved context', () => {
    const saved = session('replay');
    saved.summary = 'Architecture summary';
    saved.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'app.ts' } }] });
    saved.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'contents' }] });
    const original = structuredClone(saved);
    const transcript = sessionTranscript(saved);
    expect(transcript.map((entry) => entry.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool_result']);
    expect(transcript[2]?.text).toBe('world');
    expect(saved).toEqual(original);
  });
});
