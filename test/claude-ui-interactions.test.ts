import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  activeFileMention, applyFileSuggestion, collapseToolResults, createPermissionDialog, diffSummary, fuzzyMatch,
  appendPromptHistory, editPromptExternally, groupTranscript, latestAssistantText, listWorkspaceFiles, loadPromptHistory, nextPromptHistoryScope, parsePermissionChoice, parseUnifiedDiff, PasteStore,
  rankSelectItems, renderMarkdown, renderMarkdownTable, resolveTheme, searchTranscript, SelectController, suggestFiles,
} from '../src/components/index.js';
import { permissionRequestPayload } from '../src/permissionApprovals.js';

let root = '';
let previousHome: string | undefined;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'ccpt-ui-interactions-')); previousHome = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state'); await mkdir(join(root, 'src'), { recursive: true }); await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true }); await writeFile(join(root, 'src', 'main.ts'), 'main'); await writeFile(join(root, 'README.md'), 'readme'); await writeFile(join(root, 'node_modules', 'ignored', 'x.js'), 'x'); });
afterAll(async () => { if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome; await rm(root, { recursive: true, force: true }); });

describe('Claude-style prompt and picker interactions', () => {
  test('ranks fuzzy options and supports disabled and multi-select navigation', () => {
    expect(fuzzyMatch('rdm', 'README.md')?.positions).toEqual([0, 3, 4]);
    const items = [{ id: 'a', label: 'Alpha', disabled: true }, { id: 'b', label: 'Beta' }, { id: 'g', label: 'Gamma' }];
    expect(rankSelectItems(items, 'gm')[0]?.id).toBe('g');
    const select = new SelectController(items, true); select.move(1); expect(select.current()?.id).toBe('b'); select.toggle(); select.move(1); select.toggle();
    expect(select.submit().map((item) => item.id)).toEqual(['b', 'g']);
  });

  test('discovers and completes @file mentions without indexing dependency trees', async () => {
    const files = await listWorkspaceFiles(root);
    expect(files).toEqual(['README.md', 'src/main.ts']);
    expect(suggestFiles(files, 'main')[0]?.path).toBe('src/main.ts');
    const mention = activeFileMention('review @src/ma')!;
    expect(applyFileSuggestion('review @src/ma', mention, 'src/main.ts')).toEqual({ text: 'review @src/main.ts ', cursor: 20 });
  });

  test('collapses large bracketed paste for display and restores exact model input', () => {
    const store = new PasteStore(); const source = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
    const captured = store.capture(`\u001b[200~${source}\u001b[201~`, 20);
    expect(captured.display).toBe('[Pasted text #1 +12 lines]');
    expect(store.expand(`inspect ${captured.display}`)).toBe(`inspect ${source}`);
  });

  test('persists prompt history per project and changes reverse-search scope', async () => {
    const other = join(root, 'other'); await mkdir(other, { recursive: true });
    await appendPromptHistory({ cwd: root, sessionKey: 'one', text: 'first prompt' });
    await appendPromptHistory({ cwd: root, sessionKey: 'two', text: 'project prompt' });
    await appendPromptHistory({ cwd: other, sessionKey: 'three', text: 'global prompt' });
    expect(await loadPromptHistory({ cwd: root, sessionKey: 'one', scope: 'session' })).toEqual(['first prompt']);
    expect(await loadPromptHistory({ cwd: root, sessionKey: 'one', scope: 'project' })).toEqual(['first prompt', 'project prompt']);
    expect(await loadPromptHistory({ cwd: root, sessionKey: 'one', scope: 'all' })).toHaveLength(3);
    expect(nextPromptHistoryScope('session')).toBe('project'); expect(nextPromptHistoryScope('project')).toBe('all');
  });

  test('round-trips prompts through the configured external editor without stripping Markdown headings', async () => {
    const editor = join(root, 'editor-fixture.js');
    await writeFile(editor, "const fs=require('fs'); const p=process.argv.at(-1); fs.writeFileSync(p, '# User heading\\n\\nedited prompt');");
    const edited = await editPromptExternally('original', { cwd: root, editor: `${process.execPath} ${editor}`, previousResponse: 'prior answer' });
    expect(edited).toBe('# User heading\n\nedited prompt');
  });
});

describe('native transcript, permission, Markdown and diff views', () => {
  test('searches, groups and safely collapses tool timelines', () => {
    const entries = [{ role: 'assistant' as const, text: 'Starting refactor' }, { role: 'tool' as const, text: '', name: 'Read' }, { role: 'tool_result' as const, text: 'a\nb\nc' }, { role: 'assistant' as const, text: 'Refactor complete' }];
    expect(groupTranscript(entries).map((group) => group.kind)).toEqual(['message', 'tools', 'message']);
    expect(searchTranscript(entries, 'refactor')).toHaveLength(2);
    expect(collapseToolResults(entries, 2)[2]?.text).toContain('1 more lines');
    expect(latestAssistantText(entries)).toBe('Refactor complete');
  });

  test('offers once/session/deny permission choices with deterministic input parsing', () => {
    const request = permissionRequestPayload('s', 'write_file', { path: 'a.ts' }, 'Changes a file'); const dialog = createPermissionDialog(request);
    expect(dialog.choices).toEqual(['allow_once', 'allow_session', 'deny']);
    expect(parsePermissionChoice('2', dialog)).toBe('allow_session'); expect(parsePermissionChoice('3', dialog)).toBe('deny');
  });

  test('renders tables and parses line-accurate unified diffs', () => {
    expect(renderMarkdownTable(['| Name | State |', '|---|---|', '| API | ready |'], 60, false).join('\n')).toContain('| Name');
    expect(renderMarkdown('# Title\n\n- one\n\n`code`', { color: false })).toEqual(['Title', '', '  • one', '', 'code']);
    const files = parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n same');
    expect(diffSummary(files)).toEqual({ files: 1, additions: 1, deletions: 1 }); expect(files[0]?.lines.at(-1)).toMatchObject({ oldLine: 2, newLine: 2 });
  });

  test('honors accessibility and NO_COLOR theme detection', () => { expect(resolveTheme('dark-daltonized', {})).toBe('dark-daltonized'); expect(resolveTheme(undefined, { NO_COLOR: '1' })).toBe('none'); });
});
