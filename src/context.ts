import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { PlatformConfig } from './types.js';
import { protectPath } from './policy.js';
import { homeStateDir } from './paths.js';
import { engineeringRuleContext } from './scopedRules.js';
import {instructionSource,type InstructionSourceObserver} from './instructionSources.js';

const ignored = new Set(['.git', '.ccpt', '.ccpt-worktrees', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target']);

async function walk(directory: string, root: string, files: string[], limit: number, config: PlatformConfig): Promise<void> {
  if (files.length >= limit) return;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (files.length >= limit) break;
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    try { protectPath(path, config); } catch { continue; }
    if (entry.isDirectory()) await walk(path, root, files, limit, config);
    else files.push(relative(root, path));
  }
}

async function readContextFile(root: string, path: string, remaining: number): Promise<string> {
  const absolute = resolve(root, path);
  try {
    const info = await stat(absolute);
    if (!info.isFile() || info.size > 1_000_000) return '';
    return (await readFile(absolute, 'utf8')).slice(0, remaining);
  } catch { return ''; }
}

export async function repositoryContext(cwd: string, config: PlatformConfig, limit = 80_000,onLoaded?:InstructionSourceObserver): Promise<string> {
  const files: string[] = [];
  protectPath(cwd, config);
  await walk(cwd, cwd, files, Math.min(10_000, Math.max(1_000, Math.floor(config.model.maxContextTokens / 200))), config);
  const preferred = files.filter((path) => {
    const normalized = path.replaceAll('\\', '/').toLowerCase();
    return normalized === 'claude.md' || normalized === 'claude.local.md' || normalized === 'ccpt.md' || normalized === 'readme.md' || normalized.startsWith('docs/') && /(?:architecture|design|adr|overview|contributing|standards).*\.md$/.test(normalized);
  }).sort((left, right) => {
    const rank = (path: string): number => path.replaceAll('\\', '/').toLowerCase() === 'claude.md' ? 0 : path.replaceAll('\\', '/').toLowerCase() === 'claude.local.md' ? 1 : 2;
    return rank(left) - rank(right) || left.localeCompare(right);
  }).slice(0, 30);
  const documents: string[] = [];
  let used = 0;
  const userInstructions = await readContextFile(homeStateDir(), 'CLAUDE.md', Math.max(0, limit - used));
  if (userInstructions) {
    const part = `## User CLAUDE.md\n${userInstructions}`;
    documents.push(part);
    used += part.length;
    await onLoaded?.(instructionSource('user-instructions',userInstructions,{path:join(homeStateDir(),'CLAUDE.md')}));
  }
  const rules = await engineeringRuleContext(cwd, config, { limit: Math.max(0, limit - used),...(onLoaded?{onLoaded}:{}) });
  if (rules) { documents.push(rules); used += rules.length; }
  for (const path of preferred) {
    const content = await readContextFile(cwd, path, Math.max(0, limit - used));
    if (!content) continue;
    const part = `## ${path}\n${content}`;
    documents.push(part);
    used += part.length;
    const name=path.replaceAll('\\','/').toLowerCase();
    await onLoaded?.(instructionSource(['ccpt.md','claude.md','claude.local.md'].includes(name)?'project-instructions':'architecture-document',content,{path:resolve(cwd,path)}));
    if (used >= limit) break;
  }
  const mapBudget = Math.max(5_000, Math.min(40_000, limit - used));
  return `Repository map (${files.length}${files.length >= 10_000 ? '+' : ''} files):\n${files.join('\n').slice(0, mapBudget)}\n\nProject documents:\n${documents.join('\n\n') || '(none discovered)'}`;
}
