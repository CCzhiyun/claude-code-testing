import { describe, expect, test } from 'bun:test';
import { NATIVE_COMMANDS, parseCommandLine, resolveNativeCommand, searchNativeCommands, classifyCommandReference } from '../src/commands/index.js';
import { agentModel, createNativeComponentRegistry, permissionModel, renderComponent, selectModel, classifyComponentReference } from '../src/components/index.js';
import { FRAME_INTERVAL_MS, RenderScheduler, TerminalEventBus, classifyInkReference, measureText, renderFrame, sanitizeTerminalText, stringWidth, verticalLayout, visibleWindow, widestLine } from '../src/ink/index.js';

describe('native command compatibility', () => {
  test('provides a unique, categorized and alias-aware command catalog', () => {
    expect(NATIVE_COMMANDS.length).toBeGreaterThanOrEqual(46);
    expect(new Set(NATIVE_COMMANDS.map((item) => item.name)).size).toBe(NATIVE_COMMANDS.length);
    expect(resolveNativeCommand('/quit')?.name).toBe('/exit');
    expect(resolveNativeCommand('/settings')?.category).toBe('configuration');
    expect(resolveNativeCommand('/fast')?.name).toBe('/fast');
    expect(resolveNativeCommand('/effort')?.argument).toContain('high');
    expect(resolveNativeCommand('/stats')?.category).toBe('session');
    expect(resolveNativeCommand('/skills')?.argument).toContain('name');
    expect(resolveNativeCommand('/skill')).toBeUndefined();
    expect(resolveNativeCommand('/plan')?.description).toContain('plan');
    expect(searchNativeCommands('permission')[0]?.name).toBe('/permissions');
    expect(parseCommandLine('/agent reviewer "check all files"')).toMatchObject({ name: '/agent', argv: ['reviewer', 'check all files'] });
    expect(() => parseCommandLine('/agent "unfinished')).toThrow('Unclosed');
    expect(classifyCommandReference('plugin/install.ts')).toBe('integration');
  });
});

describe('native component compatibility', () => {
  test('registers every supported component kind and renders interactive models', () => {
    const registry = createNativeComponentRegistry();
    expect(registry.list()).toEqual(['agent', 'dialog', 'mcp', 'message', 'permission', 'prompt', 'select', 'spinner', 'status', 'task', 'text']);
    expect(renderComponent(permissionModel('p', 'Run command?', 'This changes files'), 40, registry).join('\n')).toContain('Allow once');
    expect(renderComponent(agentModel('a', 'reviewer', 'completed', 'done'), 40, registry).join('\n')).toContain('reviewer');
    const selection = renderComponent(selectModel('s', 'Choose', [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], 1), 40, registry).join('\n');
    expect(selection).toContain('›'); expect(selection).toContain('Two');
    expect(classifyComponentReference('permissions/PermissionDialog.tsx')).toBe('permissions');
  });
});

describe('native terminal compatibility', () => {
  test('lays out, dispatches and incrementally renders terminal state', async () => {
    expect(verticalLayout({ width: 80, height: 24 }, { header: 2, footer: 3, gap: 1 }).content).toEqual({ x: 0, y: 3, width: 80, height: 17 });
    expect(visibleWindow([1, 2, 3, 4], 2, 99)).toEqual([3, 4]);
    const events: string[] = []; const bus = new TerminalEventBus(); const dispose = bus.subscribe((event) => events.push(event.type)); bus.emit({ type: 'focus', focused: true }); dispose(); bus.emit({ type: 'paste', text: 'ignored' }); expect(events).toEqual(['focus']);
    expect(sanitizeTerminalText(`safe\u0000text`)).toBe('safetext');
    const first = renderFrame(['hello', 'world'], { width: 10, height: 2 }); const second = renderFrame(['hello', 'changed'], { width: 10, height: 2, previous: first.lines }); expect(second.changedRows).toEqual([1]);
    let renders = 0; const scheduler = new RenderScheduler(() => { renders += 1; }); scheduler.request(); scheduler.request(); await Promise.resolve(); expect(renders).toBe(1);
    expect(classifyInkReference('hooks/useInput.ts')).toBe('hooks');
  });
  test('measures ANSI, combining, emoji, and CJK terminal text like the reference renderer', () => {
    expect(FRAME_INTERVAL_MS).toBe(16);
    expect(stringWidth('\u001b[31mhello\u001b[0m')).toBe(5);
    expect(stringWidth('e\u0301')).toBe(1);
    expect(stringWidth('中文')).toBe(4);
    expect(stringWidth('👩‍💻')).toBe(2);
    expect(widestLine('short\n中文abc')).toBe(7);
    expect(measureText('中文abc', 4)).toEqual({ width: 7, height: 2 });
    expect(measureText('a\n', Infinity)).toEqual({ width: 1, height: 2 });
  });
});
