import { opendir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PlatformConfig } from './types.js';
import { protectPath } from './policy.js';
import { assertExecutionActive } from './executionControl.js';
/** Enumeration is budgeted even if nothing matches. Never traverse symlinks. */
export async function boundedWorkspaceFiles(root: string, config: PlatformConfig, options: { limit: number; deadlineAt?: number; accepts?: (path: string) => boolean }): Promise<string[]> {
  const result: string[] = [], deadline = options.deadlineAt ?? Date.now() + 10000; let visited = 0;
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 10000 || !Number.isFinite(deadline)) throw new Error('Invalid directory search bounds');
  const check = () => { assertExecutionActive(); if (Date.now() > deadline) throw new Error('Directory search exceeded its execution time limit'); if (visited > 20000) throw new Error('Directory search visited-entry limit exceeded; narrow the search path'); };
  const visit = async (directory: string, depth: number): Promise<void> => {
    check(); if (depth > 64) throw new Error('Directory search depth limit exceeded');
    for await (const entry of await opendir(directory)) {
      visited++; check();
      if (['.git', '.ccpt', 'node_modules'].includes(entry.name) || entry.isSymbolicLink()) continue;
      let path: string; try { path = protectPath(resolve(directory, entry.name), config); } catch { continue; }
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && (!options.accepts || options.accepts(path))) result.push(path);
      if (result.length >= options.limit) return;
    }
  };
  await visit(protectPath(resolve(root), config), 0); return result;
}
/** Glob matching uses dynamic programming, not a backtracking RegExp. */
export function globMatcher(pattern: string): (path: string) => boolean {
  if (pattern.length > 2000) throw new Error('Glob pattern is too long');
  const tokens: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') { if (pattern[i + 2] === '/') { tokens.push('**/'); i += 2; } else { tokens.push('**'); i++; } }
    else tokens.push(pattern[i]!.toLowerCase());
  }
  return value => {
    const path = value.toLowerCase(); let previous = new Uint8Array(path.length + 1); previous[0] = 1;
    for (const token of tokens) {
      const next = new Uint8Array(path.length + 1); if (token === '*' || token === '**' || token === '**/') next[0] = previous[0]!;
      let prefix = previous[0] === 1;
      for (let i = 1; i <= path.length; i++) {
        const char = path[i - 1];
        next[i] = Number(token === '*' ? Boolean(previous[i] || next[i - 1] && char !== '/') : token === '**' ? Boolean(previous[i] || next[i - 1]) : token === '**/' ? Boolean(previous[i] || prefix && char === '/') : Boolean(previous[i - 1] && (token === '?' ? char !== '/' : token === char)));
        prefix ||= previous[i] === 1;
      }
      previous = next;
    }
    return previous[path.length] === 1;
  };
}
