export type DiffLineKind = 'header' | 'hunk' | 'add' | 'delete' | 'context' | 'meta';
export interface DiffLine { kind: DiffLineKind; text: string; oldLine?: number; newLine?: number }
export interface DiffFile { oldPath: string; newPath: string; additions: number; deletions: number; lines: DiffLine[] }

export function parseUnifiedDiff(value: string): DiffFile[] {
  const files: DiffFile[] = []; let current: DiffFile | undefined; let oldLine = 0; let newLine = 0;
  for (const text of value.split(/\r?\n/)) {
    if (text.startsWith('diff --git ')) { current = { oldPath: '', newPath: '', additions: 0, deletions: 0, lines: [{ kind: 'header', text }] }; files.push(current); continue; }
    if (!current) { current = { oldPath: '', newPath: '', additions: 0, deletions: 0, lines: [] }; files.push(current); }
    if (text.startsWith('--- ')) { current.oldPath = text.slice(4).replace(/^a\//, ''); current.lines.push({ kind: 'header', text }); continue; }
    if (text.startsWith('+++ ')) { current.newPath = text.slice(4).replace(/^b\//, ''); current.lines.push({ kind: 'header', text }); continue; }
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); current.lines.push({ kind: 'hunk', text }); continue; }
    if (text.startsWith('+')) { current.additions += 1; current.lines.push({ kind: 'add', text, newLine: newLine++ }); continue; }
    if (text.startsWith('-')) { current.deletions += 1; current.lines.push({ kind: 'delete', text, oldLine: oldLine++ }); continue; }
    if (text.startsWith(' ')) { current.lines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ }); continue; }
    current.lines.push({ kind: 'meta', text });
  }
  return files.filter((file) => file.lines.length > 0);
}

export function diffSummary(files: readonly DiffFile[]): { files: number; additions: number; deletions: number } {
  return { files: files.length, additions: files.reduce((sum, file) => sum + file.additions, 0), deletions: files.reduce((sum, file) => sum + file.deletions, 0) };
}

export function renderUnifiedDiff(value: string, color = true): string[] {
  const colors: Record<DiffLineKind, string> = { header: '\u001b[1m', hunk: '\u001b[36m', add: '\u001b[32m', delete: '\u001b[31m', context: '', meta: '\u001b[2m' };
  return parseUnifiedDiff(value).flatMap((file) => file.lines.map((line) => color && colors[line.kind] ? `${colors[line.kind]}${line.text}\u001b[0m` : line.text));
}
