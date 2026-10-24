export interface RowDiff { row: number; previous: string; next: string }
export function optimize(previous: readonly string[], next: readonly string[]): RowDiff[] { const length = Math.max(previous.length, next.length); return Array.from({ length }, (_, row) => ({ row, previous: previous[row] ?? '', next: next[row] ?? '' })).filter((diff) => diff.previous !== diff.next); }
export default optimize;
