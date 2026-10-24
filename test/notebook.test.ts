import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editNotebook, readNotebook } from '../src/notebooks.js';

let workspace = '';
let notebookPath = '';

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ccpt-notebook-'));
  notebookPath = join(workspace, 'analysis.ipynb');
  await writeFile(notebookPath, JSON.stringify({
    cells: [
      { id: 'intro', cell_type: 'markdown', source: ['# Old'], metadata: {} },
      { id: 'run', cell_type: 'code', source: ['print(1)'], metadata: {}, execution_count: 4, outputs: [{ output_type: 'stream', text: '1' }] },
    ],
    metadata: { language_info: { name: 'python' } },
    nbformat: 4,
    nbformat_minor: 5,
  }), 'utf8');
});

afterAll(async () => { await rm(workspace, { recursive: true, force: true }); });

describe('Jupyter notebook operations', () => {
  test('reads normalized cells without embedding outputs', async () => {
    const notebook = await readNotebook(notebookPath);
    expect(notebook.language).toBe('python');
    expect(notebook.cells[1]?.source).toBe('print(1)');
    expect(notebook.cells[1]?.output_count).toBe(1);
  });

  test('replaces code and clears stale execution results', async () => {
    await editNotebook({ path: notebookPath, cellId: 'run', source: 'print(2)', mode: 'replace' });
    const notebook = JSON.parse(await readFile(notebookPath, 'utf8'));
    expect(notebook.cells[1].source).toBe('print(2)');
    expect(notebook.cells[1].execution_count).toBeNull();
    expect(notebook.cells[1].outputs).toEqual([]);
  });

  test('inserts after an ID and deletes by synthetic numeric ID', async () => {
    const inserted = await editNotebook({ path: notebookPath, cellId: 'intro', source: 'New section', cellType: 'markdown', mode: 'insert' });
    expect(inserted.cellId).toBeDefined();
    expect((await readNotebook(notebookPath)).cells[1]?.source).toBe('New section');
    await editNotebook({ path: notebookPath, cellId: 'cell-1', mode: 'delete' });
    expect((await readNotebook(notebookPath)).cells).toHaveLength(2);
  });
});
