import type { TranscriptEntry } from '../tui/presentation.js';

export interface TranscriptMatch { messageIndex: number; start: number; end: number; excerpt: string }
export interface TranscriptGroup { kind: 'message' | 'tools'; entries: TranscriptEntry[]; start: number; end: number }

export function searchTranscript(entries: readonly TranscriptEntry[], query: string, limit = 100): TranscriptMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: TranscriptMatch[] = [];
  entries.forEach((entry, messageIndex) => {
    const haystack = `${entry.name ?? ''} ${entry.text}`;
    let offset = 0;
    while (matches.length < limit) {
      const start = haystack.toLocaleLowerCase().indexOf(needle, offset);
      if (start < 0) break;
      const from = Math.max(0, start - 36); const to = Math.min(haystack.length, start + needle.length + 60);
      matches.push({ messageIndex, start, end: start + needle.length, excerpt: `${from ? '…' : ''}${haystack.slice(from, to)}${to < haystack.length ? '…' : ''}` });
      offset = start + Math.max(1, needle.length);
    }
  });
  return matches;
}

export function groupTranscript(entries: readonly TranscriptEntry[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  entries.forEach((entry, index) => {
    const isTool = entry.role === 'tool' || entry.role === 'tool_result';
    const previous = groups.at(-1);
    if (isTool && previous?.kind === 'tools') { previous.entries.push(entry); previous.end = index; }
    else groups.push({ kind: isTool ? 'tools' : 'message', entries: [entry], start: index, end: index });
  });
  return groups;
}

export function collapseToolResults(entries: readonly TranscriptEntry[], maximumLines = 8): TranscriptEntry[] {
  return entries.map((entry) => {
    if (entry.role !== 'tool_result') return { ...entry };
    const lines = entry.text.split(/\r?\n/);
    if (lines.length <= maximumLines) return { ...entry };
    return { ...entry, text: `${lines.slice(0, maximumLines).join('\n')}\n… ${lines.length - maximumLines} more lines (Ctrl+O to expand)` };
  });
}

export function latestAssistantText(entries: readonly TranscriptEntry[]): string | undefined {
  return [...entries].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim())?.text;
}
