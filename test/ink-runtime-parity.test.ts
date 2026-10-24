import { describe, expect, test } from 'bun:test';
import { Dispatcher } from '../src/ink/events/dispatcher.js';
import { ClickEvent } from '../src/ink/events/click-event.js';
import { EventEmitter } from '../src/ink/events/emitter.js';
import type { TerminalEvent } from '../src/ink/events/terminal-event.js';
import { contains, inset, intersect, unionRect } from '../src/ink/layout/geometry.js';
import { layoutTree } from '../src/ink/layout/engine.js';
import { createLayoutNode } from '../src/ink/layout/node.js';
import { parseKeypress, parseMultipleKeypresses } from '../src/ink/parse-keypress.js';
import { clearSelection, createSelectionState, extendSelection, getSelectedText, hasSelection, startSelection } from '../src/ink/selection.js';
import { scanPositions } from '../src/ink/searchHighlight.js';
import { expandTabs } from '../src/ink/tabstops.js';
import { detectTerminalCapabilities } from '../src/ink/terminal.js';
import { getTerminalFocused, setTerminalFocused, subscribeTerminalFocus } from '../src/ink/terminal-focus-state.js';
import { cursorMove, cursorPosition, PASTE_END, PASTE_START } from '../src/ink/termio/csi.js';
import { ENTER_ALT_SCREEN, EXIT_ALT_SCREEN } from '../src/ink/termio/dec.js';
import { link, setClipboard, setTitle } from '../src/ink/termio/osc.js';
import { TerminalParser } from '../src/ink/termio/parser.js';
import { applySgr } from '../src/ink/termio/sgr.js';
import { tokenizeTerminal } from '../src/ink/termio/tokenize.js';
import { defaultStyle } from '../src/ink/termio/types.js';
import wrapAnsi from '../src/ink/wrapAnsi.js';

describe('terminal protocols and parser parity', () => {
  test('builds safe cursor, screen, title, link and clipboard sequences', () => {
    expect(cursorPosition(1, 2)).toBe('\u001b[2;3H'); expect(cursorMove(-2, 1)).toBe('\u001b[1B\u001b[2D');
    expect(ENTER_ALT_SCREEN).toBe('\u001b[?1049h'); expect(EXIT_ALT_SCREEN).toBe('\u001b[?1049l');
    expect(setTitle('hello\u0000')).toBe('\u001b]0;hello\u0007'); expect(link('https://example.com', 'site')).toContain('https://example.com/'); expect(setClipboard('你好')).toContain(Buffer.from('你好').toString('base64'));
  });

  test('tokenizes and interprets SGR, cursor, erase and OSC without leaking control bytes', () => {
    const tokens = tokenizeTerminal('a\u001b[31mred\u001b[0m\u001b[2J'); expect(tokens.map((item) => item.type)).toEqual(['text', 'csi', 'text', 'csi', 'csi']);
    const actions = new TerminalParser().parse('a\u001b[31mred\u001b[2;3H\u001b[2J'); expect(actions.find((item) => item.type === 'cursor')).toMatchObject({ row: 1, column: 2 }); expect(actions.at(-1)).toMatchObject({ type: 'erase', mode: 2 });
    expect(applySgr(defaultStyle(), [1, 38, 5, 214])).toMatchObject({ bold: true, foreground: { mode: 'indexed', index: 214 } });
  });

  test('parses control, modified, mouse, focus and bracketed paste input', () => {
    expect(parseKeypress('\u0003')).toEqual({ type: 'key', key: { sequence: '\u0003', name: 'c', ctrl: true } });
    expect(parseKeypress('\u001b[1;6A')).toMatchObject({ type: 'key', key: { name: 'up', shift: true, ctrl: true } });
    expect(parseKeypress('\u001b[<0;12;7M')).toMatchObject({ type: 'mouse', mouse: { x: 11, y: 6, action: 'press' } });
    expect(parseMultipleKeypresses(`${PASTE_START}one\ntwo${PASTE_END}\u001b[I`)).toEqual([{ type: 'paste', text: 'one\ntwo' }, { type: 'focus', focused: true }]);
  });
});

describe('native event, geometry, selection and text layout', () => {
  test('bubbles cancelable events and emits typed notifications', () => {
    const called: string[] = []; const parent = { handlers: { onClick: () => { called.push('parent'); } } }; const child = { parent, handlers: { onClick: (event: TerminalEvent) => { called.push('child'); event.preventDefault(); } } };
    expect(new Dispatcher().dispatch(child, new ClickEvent(1, 2))).toBe(false); expect(called).toEqual(['child', 'parent']);
    const emitter = new EventEmitter<{ value: number }>(); const values: number[] = []; emitter.once('value', (value) => values.push(value)); emitter.emit('value', 1); emitter.emit('value', 2); expect(values).toEqual([1]);
  });

  test('lays out flex nodes and computes geometry', () => {
    const root = createLayoutNode('root', { direction: 'row', gap: 1 }, [createLayoutNode('fixed', { width: 4 }), createLayoutNode('flex', { flex: 1 })]); layoutTree(root, { x: 0, y: 0, width: 10, height: 3 });
    expect(root.children[1]?.frame).toEqual({ x: 5, y: 0, width: 5, height: 3 }); expect(contains(root.frame, { x: 9, y: 2 })).toBe(true); expect(intersect(root.frame, { x: 8, y: 2, width: 5, height: 5 })).toEqual({ x: 8, y: 2, width: 2, height: 1 }); expect(unionRect({ x: 1, y: 1, width: 1, height: 1 }, { x: 3, y: 3, width: 1, height: 1 })).toEqual({ x: 1, y: 1, width: 3, height: 3 }); expect(inset(root.frame, 1)).toEqual({ x: 1, y: 1, width: 8, height: 1 });
  });

  test('supports selection, search, tabs, focus state and ANSI-aware wrapping', () => {
    const state = createSelectionState(); startSelection(state, { row: 0, column: 1 }); extendSelection(state, { row: 1, column: 2 }); expect(hasSelection(state)).toBe(true); expect(getSelectedText(['abc', 'def'], state)).toBe('bc\nde'); clearSelection(state); expect(hasSelection(state)).toBe(false);
    expect(scanPositions(['alpha beta alpha'], 'alpha')).toHaveLength(2); expect(expandTabs('a\tb', 4)).toBe('a   b'); expect(wrapAnsi('\u001b[31m你好ab\u001b[0m', 4)).toContain('\n');
    let changes = 0; const dispose = subscribeTerminalFocus(() => { changes += 1; }); setTerminalFocused(false); expect(getTerminalFocused()).toBe(false); dispose(); setTerminalFocused(true); expect(changes).toBe(1);
    expect(detectTerminalCapabilities({ TERM: 'xterm-256color', COLORTERM: 'truecolor' }, true)).toMatchObject({ color: true, mouse: true, bracketedPaste: true });
  });
});
