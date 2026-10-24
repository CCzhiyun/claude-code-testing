import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ActivityManager, ansiToSvg, assertPublicUrl, AsyncQueue, BufferedWriter, chunk, CircularBuffer, CleanupRegistry, combinedAbortSignal, compareSemver, contextBudget, Cursor, encodeAsciicast, escapeXml, execFileNoThrow, fingerprint, forkSession, formatBriefTimestamp, groupToolUses, highlightMatch, isPrivateHost, mergeEnvironment, normalizeSession, objectGroupBy, parseControlMessage, parseDuration, parseFrontmatter, parseGitConfig, parseJson, partition, proxyForUrl, QueryGuard, QueueProcessor, recoverConversation, redactEnvironment, redactSecrets, repositorySlug, resolveWithin, searchSessions, semanticBoolean, semanticNumber, sequential, sessionActivity, sessionTitle, sessionUrl, setDifference, setIntersection, sha256, shellQuote, splitShellWords, stableStringify, stripMarkdown, substituteArguments, taggedId, tokenEstimate, treeify, truncateText, userAgent, validateEnvironment, withResolvers, writeJsonFile } from '../src/utils/index.js';
import { BlinkController, DoublePressDetector, InputBuffer, InputHistory, MinimumDisplayTime, NotificationCenter, NotificationRules, PermissionController, ReactiveValue, VirtualScrollController, classifyHookReference, notificationKinds } from '../src/hooks/index.js';
import { ReplScreenController, renderDoctorReport, renderResumeConversationRow, toResumeConversationRow } from '../src/screens/index.js';
import { assertSandboxConfiguration } from '../src/entrypoints/sandboxTypes.js';
import { parseCliInvocation } from '../src/entrypoints/cli.js';
import { voiceModeEnabled } from '../src/voice/voiceModeEnabled.js';

describe('native utility compatibility', () => {
  test('implements abort, sequential, deferred and async queue primitives', async () => {
    expect(combinedAbortSignal([]).aborted).toBe(false); const deferred = withResolvers<number>(); deferred.resolve(7); expect(await deferred.promise).toBe(7);
    expect(await sequential([1, 2, 3], async (value) => value * 2)).toEqual([2, 4, 6]);
    const queue = new AsyncQueue<number>(); queue.push(4); expect(await queue.next()).toEqual({ value: 4, done: false }); queue.close(); expect((await queue.next()).done).toBe(true);
  });
  test('implements bounded collections and semantic/text helpers', () => {
    const buffer = new CircularBuffer<number>(2); buffer.push(1); buffer.push(2); buffer.push(3); expect(buffer.toArray()).toEqual([2, 3]);
    expect(objectGroupBy(['a', 'ab', 'b'], (value) => value[0]!)).toEqual({ a: ['a', 'ab'], b: ['b'] });
    expect(semanticBoolean('enabled')).toBe(true); expect(semanticNumber('4', { min: 1, integer: true })).toBe(4); expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(truncateText('abcdef', 4)).toBe('abc…'); expect(highlightMatch('Agent tools', 'tools')).toContain('\u001b[1mtools');
  });
  test('implements portable collection cursors, partitions, sets and trees', () => {
    const cursor = new Cursor(['a', 'b'], true); expect(cursor.move(1)).toBe('a'); expect(cursor.move(-1)).toBe('b'); expect(cursor.select(0)).toBe('a');
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]); expect(partition([1, 2, 3], (value) => value % 2 === 1)).toEqual([[1, 3], [2]]);
    expect([...setIntersection([1, 2], [2, 3])]).toEqual([2]); expect([...setDifference([1, 2], [2, 3])]).toEqual([1]);
    expect(treeify([{ id: 'root' }, { id: 'child', parent: 'root' }], (item) => item.id, (item) => item.parent)).toMatchObject([{ value: { id: 'root' }, children: [{ value: { id: 'child' } }] }]);
  });
  test('implements lifecycle, activity, query, buffering and sequential queue controllers', async () => {
    const calls: number[] = []; const cleanups = new CleanupRegistry(); cleanups.add(() => { calls.push(1); }); cleanups.add(() => { calls.push(2); }); expect(await cleanups.run()).toEqual([]); expect(calls).toEqual([2, 1]);
    const activity = new ActivityManager(); const finish = activity.start(10); expect(activity.snapshot()).toMatchObject({ active: 1, idle: false, lastStartedAt: 10 }); finish(); expect(activity.snapshot().idle).toBe(true);
    const guard = new QueryGuard(); const signal = guard.enter('main'); expect(guard.has('main')).toBe(true); expect(() => guard.enter('main')).toThrow('already running'); guard.leave('main', signal); expect(guard.has('main')).toBe(false);
    const processor = new QueueProcessor<number, number>(async (value) => { calls.push(value); return value * 2; }); expect(await Promise.all([processor.enqueue(3), processor.enqueue(4)])).toEqual([6, 8]);
    let output = ''; const writer = new BufferedWriter((value) => { output += value; }, { maximum: 3 }); writer.append('ab'); writer.append('cd'); await writer.flush(); expect(output).toBe('abcd');
  });
  test('implements deterministic serialization, frontmatter, argument and shell parsing', () => {
    expect(stableStringify({ z: 1, a: 2 })).toBe('{"a":2,"z":1}'); expect(parseJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true }); expect(parseJson('bad', { ok: false })).toEqual({ ok: false });
    expect(parseFrontmatter('---\ntitle: Test\nenabled: true\ncount: 2\n---\nBody')).toEqual({ attributes: { title: 'Test', enabled: true, count: 2 }, body: 'Body' });
    expect(substituteArguments('$1 ${name} $ARGUMENTS', ['one', 'two'], { name: 'agent' })).toBe('one agent one two');
    expect(splitShellWords(`node -e "hello world"`)).toEqual(['node', '-e', 'hello world']); expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
  });
  test('implements portable identity, paths, durations, text and terminal exports', async () => {
    expect(sha256('a')).toHaveLength(64); expect(fingerprint({ a: 1 }, 8)).toHaveLength(8); expect(taggedId('task')).toMatch(/^task_[a-f0-9]{32}$/);
    expect(resolveWithin('/workspace', 'src/a.ts')).toEndWith(join('workspace', 'src', 'a.ts')); expect(() => resolveWithin('/workspace', '../escape')).toThrow('escapes');
    expect(parseDuration('2m')).toBe(120_000); expect(formatBriefTimestamp(0, 180_000)).toBe('3m'); expect(escapeXml('<a>')).toBe('&lt;a&gt;'); expect(stripMarkdown('# Hi **there**')).toBe('Hi there');
    expect(ansiToSvg('\u001b[31mhello\u001b[0m')).toContain('<text'); expect(encodeAsciicast([{ time: 0, type: 'o', data: 'ready' }], { timestamp: 1 })).toContain('[0,"o","ready"]');
    const directory = await mkdtemp(join(tmpdir(), 'ccpt-native-')); const path = join(directory, 'state.json'); await writeJsonFile(path, { z: 1, a: 2 }); expect(await readFile(path, 'utf8')).toBe('{\n  "a": 2,\n  "z": 1\n}\n');
  });
  test('implements no-throw processes and governed environment helpers', async () => {
    const result = await execFileNoThrow(process.execPath, ['-e', 'process.stdout.write("ok")']); expect(result).toMatchObject({ ok: true, stdout: 'ok', code: 0 });
    expect(mergeEnvironment({ A: '1' }, { A: undefined, B: '2' })).toEqual({ B: '2' }); expect(validateEnvironment({ 'bad-key': 'x', GOOD: '\u0000' })).toHaveLength(2);
    expect(redactEnvironment({ TOKEN: 'secret', PATH: 'safe' })).toEqual({ TOKEN: '[REDACTED]', PATH: 'safe' }); expect(redactSecrets('token=secret')).toBe('token=[REDACTED]');
  });
  test('implements Git, URL, proxy and user-agent normalization', () => {
    expect(parseGitConfig('[user]\n name = Test\n[remote "origin"]\n url = git@example.com:x/y.git')).toEqual({ 'user.name': 'Test', 'remote.origin.url': 'git@example.com:x/y.git' });
    expect(repositorySlug('git@github.com:openai/codex.git')).toBe('openai/codex'); expect(isPrivateHost('192.168.1.1')).toBe(true); expect(() => assertPublicUrl('https://localhost/x')).toThrow('Private');
    expect(proxyForUrl('https://example.com', { HTTPS_PROXY: 'http://proxy', NO_PROXY: '.internal' })).toBe('http://proxy'); expect(userAgent('ccpt', '1.0')).toContain('ccpt/1.0');
  });
  test('implements session search, recovery, forks, grouping and context budgets', () => {
    const base = normalizeSession({ id: 's1', cwd: '/w', createdAt: '2025-01-01', updatedAt: '2025-01-02', messages: [{ id: 'm1', role: 'user', content: 'Fix parser' }, { role: 'assistant', content: 'Done', toolUseId: 't1' }] });
    expect(sessionTitle(base)).toBe('Fix parser'); expect(sessionActivity(base)).toMatchObject({ turns: 1, lastActiveAt: '2025-01-02T00:00:00.000Z' }); expect(sessionUrl('s1')).toContain('session/s1');
    expect(searchSessions([base], 'parser')).toHaveLength(1); expect(recoverConversation([...base.messages, base.messages[0]!])).toHaveLength(2); expect(forkSession(base, 's2').parentId).toBe('s1');
    expect(groupToolUses(base.messages)).toHaveLength(2); expect(tokenEstimate('hello')).toBeGreaterThan(0); expect(contextBudget(base.messages, 100).remaining).toBeLessThan(100); expect(parseControlMessage({ type: 'interrupt' })).toEqual({ type: 'interrupt' });
  });
});

describe('native hook controllers', () => {
  test('provides observable values, text editing, history and virtual scrolling', () => {
    const value = new ReactiveValue(1); const changes: number[] = []; value.subscribe((next) => changes.push(next)); value.set(2); value.update((next) => next + 1); expect(changes).toEqual([2, 3]);
    const input = new InputBuffer('ac'); input.move(-1); input.insert('b'); input.backspace(); input.insert('b'); expect(input.snapshot).toEqual({ text: 'abc', cursor: 2 });
    const history = new InputHistory(); history.push('one'); history.push('two'); expect(history.previous('draft')).toBe('two'); expect(history.previous('')).toBe('one'); expect(history.next()).toBe('two');
    const scroll = new VirtualScrollController(3); expect(scroll.select(7, 10)).toEqual({ start: 5, end: 8, selected: 7, offset: 5 });
  });
  test('provides timing, notification and permission lifecycles', () => {
    const double = new DoublePressDetector(300); expect(double.press(100)).toBe(false); expect(double.press(200)).toBe(true);
    expect(new MinimumDisplayTime(500, 100).remaining(350)).toBe(250); expect(new BlinkController(100).at(150)).toBe(false);
    const notifications = new NotificationCenter(); notifications.publish({ id: 'a', message: 'ready', level: 'success', createdAt: 1 }); expect(notifications.list()).toHaveLength(1); expect(notifications.dismiss('a')).toBe(true);
    const permissions = new PermissionController('normal'); permissions.request({ id: 'p', tool: 'Bash', input: {} }); expect(permissions.resolve('p', { behavior: 'allow', remember: false }).request.tool).toBe('Bash');
    expect(classifyHookReference('notifs/useStartupNotification.ts')).toBe('notifications');
  });
  test('normalizes all reference notification sources with dedupe, expiry and dismissal', () => {
    const center = new NotificationCenter(); const rules = new NotificationRules(center, () => 100);
    expect(notificationKinds()).toHaveLength(16); expect(rules.update({ kind: 'startup', active: true })?.expiresAt).toBe(8_100);
    rules.update({ kind: 'settings-error', active: true, detail: 'model.name is required' }); expect(center.list(10_000)).toMatchObject([{ id: 'notice:settings-error:default', level: 'error' }]);
    rules.update({ kind: 'settings-error', active: false }); expect(center.list()).toHaveLength(0);
  });
});

describe('native screens and entrypoints', () => {
  test('models REPL, doctor and resume screens without React coupling', () => {
    const repl = new ReplScreenController(); repl.input.insert('/model fast'); expect(repl.submit()).toMatchObject({ type: 'command', command: { name: '/model', argv: ['fast'] } });
    expect(renderDoctorReport({ ok: true, cwd: '/w', checks: [{ id: 'workspace', ok: true, detail: 'ok', severity: 'required' }] })[1]).toContain('workspace');
    const now = new Date().toISOString(); const row = toResumeConversationRow({ id: 'session_1234567890abcdef', title: 'Work', cwd: '/w', createdAt: now, updatedAt: now, messages: [{ role: 'user', content: 'hello' }] }); expect(renderResumeConversationRow(row, true)).toContain('› Work');
  });
  test('parses CLI, validates sandbox contracts and gates voice mode', () => {
    expect(parseCliInvocation(['run', 'goal', '--cwd', '/w', '--background'])).toEqual({ command: 'run', args: ['goal'], options: { cwd: '/w', background: true } });
    expect(() => assertSandboxConfiguration({ mode: 'sandbox', workspaceRoots: ['/w'], allowedCommands: [], allowedEnvironmentVariables: [] })).toThrow('process wrapper');
    expect(voiceModeEnabled({ configured: true, remote: false, interactive: true })).toBe(true); expect(voiceModeEnabled({ configured: true, remote: true, interactive: true })).toBe(false);
  });
});
