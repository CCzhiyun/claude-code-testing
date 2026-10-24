import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

type NotebookCell = {
  id?: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  metadata: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: unknown[];
};

type Notebook = {
  cells: NotebookCell[];
  metadata: { language_info?: { name?: string }; [key: string]: unknown };
  nbformat: number;
  nbformat_minor: number;
};

function parseNotebook(content: string): Notebook {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error('Notebook is not valid JSON'); }
  if (!value || typeof value !== 'object' || !Array.isArray((value as Notebook).cells)) throw new Error('Notebook does not contain a valid cells array');
  return value as Notebook;
}

function cellIndex(notebook: Notebook, id: string): number {
  const direct = notebook.cells.findIndex((cell) => cell.id === id);
  if (direct >= 0) return direct;
  const match = id.match(/^cell-(\d+)$/);
  if (!match?.[1]) return -1;
  const index = Number(match[1]);
  return Number.isInteger(index) && notebook.cells[index] ? index : -1;
}

export async function readNotebook(path: string, requestedCellId?: string): Promise<{ language: string; cells: Array<Record<string, unknown>> }> {
  if (extname(path).toLowerCase() !== '.ipynb') throw new Error('Notebook path must end with .ipynb');
  const info = await stat(path);
  if (!info.isFile()) throw new Error('Notebook path is not a file');
  if (info.size > 20_000_000) throw new Error('Notebook exceeds the 20 MB limit');
  const notebook = parseNotebook(await readFile(path, 'utf8'));
  const selected = requestedCellId ? [notebook.cells[cellIndex(notebook, requestedCellId)]].filter((cell): cell is NotebookCell => Boolean(cell)) : notebook.cells;
  if (requestedCellId && selected.length === 0) throw new Error(`Notebook cell not found: ${requestedCellId}`);
  return {
    language: notebook.metadata.language_info?.name ?? 'python',
    cells: selected.map((cell, index) => ({
      cell_id: cell.id ?? `cell-${requestedCellId ? cellIndex(notebook, requestedCellId) : index}`,
      cell_type: cell.cell_type,
      source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
      ...(cell.cell_type === 'code' ? { execution_count: cell.execution_count ?? null, output_count: cell.outputs?.length ?? 0 } : {}),
    })),
  };
}

export async function editNotebook(options: {
  path: string;
  cellId?: string;
  source?: string;
  cellType?: 'code' | 'markdown';
  mode?: 'replace' | 'insert' | 'delete';
}): Promise<{ cellId?: string; mode: 'replace' | 'insert' | 'delete'; language: string }> {
  if (extname(options.path).toLowerCase() !== '.ipynb') throw new Error('Notebook path must end with .ipynb');
  const content = await readFile(options.path, 'utf8');
  const notebook = parseNotebook(content);
  const mode = options.mode ?? 'replace';
  if (mode !== 'delete' && typeof options.source !== 'string') throw new Error('source is required unless deleting a cell');
  if (mode === 'insert' && !options.cellType) throw new Error('cell_type is required when inserting a cell');
  if (mode !== 'insert' && !options.cellId) throw new Error('cell_id is required when replacing or deleting a cell');

  let index = options.cellId ? cellIndex(notebook, options.cellId) : 0;
  if (options.cellId && index < 0) throw new Error(`Notebook cell not found: ${options.cellId}`);
  if (mode === 'insert' && options.cellId) index += 1;
  let resultCellId = options.cellId;

  if (mode === 'delete') {
    notebook.cells.splice(index, 1);
  } else if (mode === 'insert') {
    const supportsCellIds = notebook.nbformat > 4 || notebook.nbformat === 4 && notebook.nbformat_minor >= 5;
    resultCellId = supportsCellIds ? randomBytes(8).toString('hex').slice(0, 13) : undefined;
    const cell: NotebookCell = options.cellType === 'markdown'
      ? { cell_type: 'markdown', ...(resultCellId ? { id: resultCellId } : {}), source: options.source ?? '', metadata: {} }
      : { cell_type: 'code', ...(resultCellId ? { id: resultCellId } : {}), source: options.source ?? '', metadata: {}, execution_count: null, outputs: [] };
    notebook.cells.splice(index, 0, cell);
  } else {
    const cell = notebook.cells[index];
    if (!cell) throw new Error(`Notebook cell not found: ${options.cellId}`);
    cell.source = options.source ?? '';
    if (options.cellType) cell.cell_type = options.cellType;
    if (cell.cell_type === 'code') {
      cell.execution_count = null;
      cell.outputs = [];
    } else {
      delete cell.execution_count;
      delete cell.outputs;
    }
  }
  await writeFile(options.path, `${JSON.stringify(notebook, null, 1)}\n`, 'utf8');
  return { ...(resultCellId ? { cellId: resultCellId } : {}), mode, language: notebook.metadata.language_info?.name ?? 'python' };
}
