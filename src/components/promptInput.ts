import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fuzzyMatch } from './selection.js';

const ignoredDirectories = new Set(['.git', '.ccpt', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache']);
const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export interface FileMention { start: number; end: number; query: string }
export interface FileSuggestion { path: string; score: number }
export interface StoredPaste { id: number; text: string; lines: number; characters: number; placeholder: string }

export function activeFileMention(text: string, cursor = text.length): FileMention | undefined {
  const before = text.slice(0, Math.max(0, cursor));
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) return undefined;
  const prefix = match[0].startsWith('@') ? 0 : 1;
  const start = match.index + prefix;
  return { start, end: cursor, query: match[1] ?? '' };
}

export function suggestFiles(files: readonly string[], query: string, limit = 12): FileSuggestion[] {
  return files.flatMap((path) => {
    const normalized = path.replaceAll('\\', '/');
    const match = fuzzyMatch(query, normalized);
    return match ? [{ path: normalized, score: match.score + (normalized.split('/').at(-1)?.toLowerCase().startsWith(query.toLowerCase()) ? 200 : 0) }] : [];
  }).sort((left, right) => right.score - left.score || left.path.length - right.path.length || left.path.localeCompare(right.path)).slice(0, Math.max(0, limit));
}

export function applyFileSuggestion(text: string, mention: FileMention, path: string): { text: string; cursor: number } {
  const replacement = `@${path.replaceAll('\\', '/')} `;
  const output = `${text.slice(0, mention.start)}${replacement}${text.slice(mention.end)}`;
  return { text: output, cursor: mention.start + replacement.length };
}

export async function listWorkspaceFiles(root: string, limit = 20_000): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (output.length >= limit) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (output.length >= limit) return;
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(relative(absoluteRoot, path).split(sep).join('/'));
    }
  }
  await visit(absoluteRoot);
  return output.sort();
}

export class PasteStore {
  #sequence = 0;
  readonly #items = new Map<number, StoredPaste>();
  capture(value: string, threshold = 800): { display: string; paste?: StoredPaste } {
    const text = value.replace(/\u001b\[200~|\u001b\[201~/g, '').replace(unsafeControls, '');
    if (text.length < threshold && text.split(/\r?\n/).length < 8) return { display: text };
    const id = ++this.#sequence;
    const lines = text.split(/\r?\n/).length;
    const placeholder = `[Pasted text #${id} +${lines} lines]`;
    const paste = { id, text, lines, characters: text.length, placeholder };
    this.#items.set(id, paste);
    return { display: placeholder, paste };
  }
  expand(value: string): string {
    return value.replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (placeholder, rawId: string) => this.#items.get(Number(rawId))?.text ?? placeholder);
  }
  get(id: number): StoredPaste | undefined { const item = this.#items.get(id); return item ? { ...item } : undefined; }
  clear(): void { this.#items.clear(); }
}

export function truncateInputMiddle(value: string, maximum = 20_000): string {
  if (value.length <= maximum) return value;
  const marker = `\n… ${value.length - maximum} characters omitted from display …\n`;
  const side = Math.max(0, Math.floor((maximum - marker.length) / 2));
  return `${value.slice(0, side)}${marker}${value.slice(-side)}`;
}
