import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homeStateDir } from '../paths.js';
import { readJson, withFileLock, writeJson } from '../storage.js';

export type PromptHistoryScope = 'session' | 'project' | 'all';

export interface PromptHistoryEntry {
  id: string;
  text: string;
  cwd: string;
  sessionKey: string;
  createdAt: string;
}

const historyPath = (): string => join(homeStateDir(), 'prompt-history.json');
const historyLock = (): string => join(homeStateDir(), 'locks', 'prompt-history.lock');
const identity = (cwd: string, sessionKey: string, text: string, createdAt: string): string =>
  createHash('sha256').update(`${resolve(cwd)}\n${sessionKey}\n${text}\n${createdAt}`).digest('hex').slice(0, 20);

function normalized(entries: PromptHistoryEntry[]): PromptHistoryEntry[] {
  return entries.filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim() && typeof entry.cwd === 'string')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function loadPromptHistory(options: { cwd: string; sessionKey: string; scope?: PromptHistoryScope; limit?: number }): Promise<string[]> {
  const scope = options.scope ?? 'project';
  const cwd = resolve(options.cwd);
  const entries = normalized(await readJson<PromptHistoryEntry[]>(historyPath(), []));
  const filtered = entries.filter((entry) => scope === 'all' || (scope === 'project' ? resolve(entry.cwd) === cwd : entry.sessionKey === options.sessionKey));
  const deduplicated: string[] = [];
  for (const entry of filtered) {
    const prior = deduplicated.indexOf(entry.text);
    if (prior >= 0) deduplicated.splice(prior, 1);
    deduplicated.push(entry.text);
  }
  return deduplicated.slice(-Math.max(1, Math.min(options.limit ?? 1_000, 5_000)));
}

export async function appendPromptHistory(options: { cwd: string; sessionKey: string; text: string; maximum?: number }): Promise<PromptHistoryEntry | undefined> {
  const text = options.text.trim();
  if (!text) return undefined;
  const createdAt = new Date().toISOString();
  const entry: PromptHistoryEntry = { id: identity(options.cwd, options.sessionKey, text, createdAt), text, cwd: resolve(options.cwd), sessionKey: options.sessionKey, createdAt };
  await withFileLock(historyLock(), async () => {
    const entries = normalized(await readJson<PromptHistoryEntry[]>(historyPath(), [])).filter((item) => !(item.cwd === entry.cwd && item.sessionKey === entry.sessionKey && item.text === entry.text));
    entries.push(entry);
    await writeJson(historyPath(), entries.slice(-Math.max(100, Math.min(options.maximum ?? 5_000, 20_000))));
  });
  return entry;
}

export async function clearPromptHistory(options: { cwd: string; sessionKey?: string; scope?: PromptHistoryScope }): Promise<number> {
  return withFileLock(historyLock(), async () => {
    const entries = normalized(await readJson<PromptHistoryEntry[]>(historyPath(), []));
    const cwd = resolve(options.cwd);
    const scope = options.scope ?? 'session';
    const keep = entries.filter((entry) => scope === 'all' ? false : scope === 'project' ? resolve(entry.cwd) !== cwd : entry.sessionKey !== options.sessionKey);
    await writeJson(historyPath(), keep);
    return entries.length - keep.length;
  });
}

export function nextPromptHistoryScope(scope: PromptHistoryScope): PromptHistoryScope {
  return ({ session: 'project', project: 'all', all: 'session' } as const)[scope];
}
