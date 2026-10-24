import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeJson } from '../src/storage.js';
import { renameSession } from '../src/sessions.js';
import { AmbiguousSessionNameError, resolveSessionReference, startupSession } from '../src/sessionStartup.js';
import { navigateResource, renderResourceDialog, resourceItems, sessionItems, sessionPreview, type ResourceDialogState } from '../src/components/resourceDialog.js';
import { resolveNativeCommand } from '../src/commands/catalog.js';
import type { SessionRecord } from '../src/types.js';

const cwd = resolve('picker-fixture');
const session = (id: string, title = id): SessionRecord => ({ id, title, cwd, createdAt: '2026-10-16', updatedAt: '2026-10-16', messages: [{ role: 'user', content: 'PREVIEW_MARKER' }] });
const picker = (): ResourceDialogState => ({ type: 'resource', kind: 'resume', title: 'Resume session', query: '', selected: 0, tab: 0, tabs: ['Conversations'], groups: [sessionItems([session('one'), session('two')])], expanded: false, cwd, allProjects: false });

test('resume navigation separates list shortcuts from search input and preview never selects', () => {
  const state = picker();
  navigateResource(state, 'j', 'j'); expect(state.selected).toBe(1);
  navigateResource(state, 'k', 'k'); expect(state.selected).toBe(0);
  expect(navigateResource(state, 'space', ' ')).toBeUndefined(); expect(state.expanded).toBe(true);
  expect(renderResourceDialog(state, 100, 24).join('\n')).toContain('PREVIEW_MARKER');
  navigateResource(state, 'escape'); expect(state.expanded).toBe(false);
  expect(navigateResource(state, 'v', '', true)).toBeUndefined(); expect(state.expanded).toBe(true);
  navigateResource(state, 'escape');
  expect(navigateResource(state, '2', '2')).toBe('select'); expect(state.selected).toBe(1);
  expect(navigateResource(state, '9', '9')).toBeUndefined(); expect(state.selected).toBe(1);
  navigateResource(state, '', '/'); navigateResource(state, '', 'j2 ');
  expect(state.query).toBe('j2 '); expect(resourceItems(state)).toHaveLength(0);
  navigateResource(state, 'escape'); expect(state.searchMode).toBe(false); expect(state.query).toBe('');
  expect(navigateResource(state, 'escape')).toBe('close');
});

test('rename keeps stable ID, supports cancel/clear/grapheme editing and cannot activate a session', () => {
  const state = picker(); navigateResource(state, 'r', '', true);
  expect(state.renaming).toEqual({ id: 'one', value: 'one' });
  expect(renderResourceDialog(state, 80, 20).join('\n')).toContain('Rename conversation');
  navigateResource(state, 'u', '', true); navigateResource(state, '', '你好👨‍👩‍👧‍👦');
  navigateResource(state, 'backspace'); expect(state.renaming?.value).toBe('你好');
  navigateResource(state, '', '\u001b[31m'); expect(state.renaming?.value).toBe('你好');
  expect(navigateResource(state, 'return')).toBe('rename'); expect(state.renaming?.id).toBe('one');
  navigateResource(state, 'escape'); expect(state.renaming).toBeUndefined(); expect(state.groups[0]?.[0]?.label).toBe('one');
  navigateResource(state, '', '/'); navigateResource(state, '', '👩‍💻'); navigateResource(state, 'backspace'); expect(state.query).toBe('');
});

test('preview is bounded, includes tools/results but never hidden reasoning or image bytes', () => {
  const record = session('preview'); record.messages = Array.from({ length: 100 }, () => ({ role: 'assistant' as const, content: 'x'.repeat(5000) }));
  record.messages.push({ role: 'assistant', content: [{ type: 'thinking', text: 'HIDDEN_REASONING' }, { type: 'tool_use', name: 'read_file', id: 'call', input: {} }, { type: 'image', media_type: 'image/png', data: 'SECRET_IMAGE' }] });
  record.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', content: 'TOOL_RESULT_MARKER' }] });
  const text = sessionPreview(record); expect(text.length).toBeLessThan(50000);
  expect(text).toContain('Earlier messages omitted'); expect(text).toContain('[tool: read_file]'); expect(text).toContain('TOOL_RESULT_MARKER');
  expect(text).not.toContain('HIDDEN_REASONING'); expect(text).not.toContain('SECRET_IMAGE');
});

test('session names resolve exactly in workspace, duplicate names fail closed, rename persists without altering messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-picker-names-')); const previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'home');
  const a = 'session_0000000000000011', b = 'session_0000000000000012', foreign = 'session_0000000000000013';
  try {
    for (const [id, directory, title] of [[a, root, '项目 支付'], [b, root, 'Other'], [foreign, join(root, 'foreign'), '项目 支付']]) {
      await writeJson(join(process.env.CCPT_HOME, 'sessions', `${id}.json`), { ...session(id!), cwd: directory, title });
    }
    expect(await startupSession(root, '项目 支付', false)).toBe(a);
    await expect(resolveSessionReference(root, foreign)).rejects.toThrow('another workspace');
    await expect(resolveSessionReference(root, '项目')).rejects.toThrow('No conversation');
    const renamed = await renameSession(b, '项目 支付'); expect(renamed.messages).toEqual(session(b).messages);
    await expect(resolveSessionReference(root, '项目 支付')).rejects.toBeInstanceOf(AmbiguousSessionNameError);
    expect(await resolveSessionReference(root, a)).toBe(a);
    const path = join(process.env.CCPT_HOME, 'sessions', `${a}.json`); const before = await readFile(path, 'utf8');
    for (const name of ['', '  ', 'bad\nname', 'x'.repeat(121)]) await expect(renameSession(a, name)).rejects.toThrow('Session name');
    expect(await readFile(path, 'utf8')).toBe(before);
    await writeJson(join(process.env.CCPT_HOME, 'agents', 'agent_0000000000000001.json'), { id: 'agent_0000000000000001', sessionId: a, status: 'waiting_for_input', updatedAt: '2026-10-16' });
    await expect(renameSession(a, 'Pending approval')).rejects.toThrow('Session is active');
    expect(await readFile(path, 'utf8')).toBe(before);
  } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});

test('resume/fork aliases are native commands and advertise names rather than prompts', () => {
  expect(resolveNativeCommand('/continue')?.name).toBe('/resume');
  expect(resolveNativeCommand('/fork')?.name).toBe('/branch');
  expect(resolveNativeCommand('/new')?.name).toBe('/clear');
  expect(resolveNativeCommand('/reset')?.name).toBe('/clear');
  expect(resolveNativeCommand('/branch')?.argument).toBe('[name]');
});
