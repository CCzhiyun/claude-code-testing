import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseMarkdownDocument } from './frontmatter.js';
import { homeStateDir, projectStateDir } from './paths.js';
import type { PlatformConfig } from './types.js';
import { protectPath } from './policy.js';
import {instructionSource,type InstructionSourceObserver} from './instructionSources.js';

export interface EngineeringRule { id: string; path: string; source: 'user' | 'project'; body: string; paths?: string[] }
export interface RuleDiscovery { rules: EngineeringRule[]; errors: string[] }

// Bounded brace expansion. Unsupported/invalid patterns never broaden a scope.
export function expandRulePatterns(patterns: string[]): string[] {
  const output: string[] = []; let bytes = 0;
  const expand = (pattern: string, depth = 0): void => {
    if (output.length >= 1000 || bytes + pattern.length > 4 * 1024 * 1024 || depth > 16) return;
    const group = /\{([^{}]+)\}/.exec(pattern);
    if (group) { for (const alternative of group[1]!.split(',')) expand(pattern.slice(0, group.index) + alternative + pattern.slice(group.index + group[0].length), depth + 1); }
    else { output.push(pattern); bytes += pattern.length; }
  };
  for (const pattern of patterns) expand(pattern);
  return output;
}

export function matchesRulePath(pattern: string, file: string): boolean {
  if (!pattern || pattern.length > 4096 || pattern.includes('\u0000') || pattern.includes('{') || pattern.includes('}')) return false;
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('../') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return false;
  // A small glob NFA avoids catastrophic RegExp backtracking on untrusted rules.
  const tokens: Array<{ type: 'literal' | 'one' | 'star' | 'globstar' | 'directories' | 'class'; value?: string }> = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') { i++; if (pattern[i + 1] === '/') { i++; tokens.push({ type: 'directories' }); } else tokens.push({ type: 'globstar' }); }
      else tokens.push({ type: 'star' });
    } else if (char === '?') tokens.push({ type: 'one' });
    else if (char === '[') {
      const end = pattern.indexOf(']', i + 1); if (end < 0) return false;
      const content = pattern.slice(i + 1, end); if (!content || /[\\/[]/.test(content)) return false;
      tokens.push({ type: 'class', value: '[' + (content.startsWith('!') ? '^' + content.slice(1) : content) + ']' }); i = end;
    } else if (char === '\\') { const next = pattern[++i]; if (!next) return false; tokens.push({ type: 'literal', value: next }); }
    else tokens.push({ type: 'literal', value: char });
  }
  const characters = [...normalized]; if (characters.length > 4096 || tokens.length * (characters.length + 1) > 2_000_000) return false;
  let current = new Uint8Array(characters.length + 1); current[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(current.length);
    if (token.type === 'directories') {
      next.set(current); let reachable = false;
      for (let i = 0; i < characters.length; i++) { reachable ||= current[i] === 1; if (reachable && characters[i] === '/') next[i + 1] = 1; }
    } else if (token.type === 'star' || token.type === 'globstar') {
      next[0] = current[0]!;
      for (let i = 1; i < current.length; i++) next[i] = current[i] || (next[i - 1] && (token.type === 'globstar' || characters[i - 1] !== '/') ? 1 : 0);
    } else {
      let characterClass: RegExp | undefined;
      if (token.type === 'class') { try { characterClass = new RegExp(`^${token.value}$`, 'u'); } catch { return false; } }
      for (let i = 0; i < characters.length; i++) if (current[i] && (token.type === 'literal' ? characters[i] === token.value : characters[i] !== '/' && (token.type === 'one' || characterClass!.test(characters[i]!)))) next[i + 1] = 1;
    }
    current = next;
  }
  return current[characters.length] === 1;
}

async function noSymlinkPath(path: string): Promise<void> {
  if (/^(?:\\\\|\/\/)/.test(path)) throw new Error('Network rule roots are not loaded automatically');
  for (let current = resolve(path); ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Rule path traverses a symlink; configure an approved local copy'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (dirname(current) === current) return;
  }
}

export async function discoverEngineeringRules(cwd: string, config: PlatformConfig): Promise<RuleDiscovery> {
  const rules: EngineeringRule[] = [], errors: string[] = []; let seen = 0;
  for (const [source, root] of [['user', join(homeStateDir(), 'rules')], ['project', join(projectStateDir(cwd), 'rules')]] as const) {
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 16 || rules.length >= 100 || seen >= 4096) return;
      try {
        await noSymlinkPath(directory);
        for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (++seen > 4096 || rules.length >= 100) return;
          const path = join(directory, entry.name);
          if (entry.isSymbolicLink()) { errors.push(`${path}: Rule symlinks require explicit approval and are not loaded automatically`); continue; }
          if (entry.isDirectory()) { await visit(path, depth + 1); continue; }
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
          try {
            if (source === 'project') protectPath(path, config);
            if ((await lstat(path)).size > 1_000_000) throw new Error('Rule exceeds 1 MB limit');
            const text = await readFile(path, 'utf8'); const document = parseMarkdownDocument(text);
            const scoped = document.attributes.paths;
            if (scoped !== undefined && (!Array.isArray(scoped) || scoped.some(p => typeof p !== 'string' || !p.trim()))) throw new Error('Rule paths must be a string array');
            const paths = scoped === undefined ? undefined : expandRulePatterns(scoped as string[]);
            if (!document.body) continue;
            rules.push({ path, source, body: document.body, id: createHash('sha256').update(`${resolve(path)}\n${text}`).digest('hex'), ...(paths ? { paths } : {}) });
          } catch (e) { errors.push(`${path}: ${String(e)}`); }
        }
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`${directory}: ${String(e)}`); }
    };
    await visit(root, 0);
  }
  return { rules, errors };
}

export async function engineeringRuleContext(cwd: string, config: PlatformConfig, options: { files?: string[]; loaded?: Set<string>; limit?: number;onLoaded?:InstructionSourceObserver } = {}): Promise<string> {
  const { rules, errors } = await discoverEngineeringRules(cwd, config);
  const files = (options.files ?? []).flatMap(file => {
    try { const absolute = protectPath(resolve(cwd, file), config); const local = relative(resolve(cwd), absolute); return local.startsWith('..') ? [] : [local]; } catch { return []; }
  });
  const parts: string[] = []; let remaining = options.limit ?? 50_000;
  for (const rule of rules) {
    if (options.loaded?.has(rule.id)) continue;
    if (options.files ? !rule.paths?.some(pattern => files.some(file => matchesRulePath(pattern, file))) : rule.paths !== undefined) continue;
    const ruleRoot = rule.source === 'project' ? join(projectStateDir(cwd), 'rules') : join(homeStateDir(), 'rules');
    const label = `${rule.source === 'project' ? 'Project rule: .ccpt/rules/' : 'User rule: rules/'}${relative(ruleRoot, rule.path).replaceAll('\\', '/')}`;
    const part = `## ${label}\n[Engineering rule ${rule.id}: ${rule.source} ${rule.path}]\n${rule.body}`;
    if (part.length > remaining) continue;
    parts.push(part); remaining -= part.length; options.loaded?.add(rule.id);
    await options.onLoaded?.(instructionSource(`engineering-rule:${rule.source}`,part,{path:rule.path,instruction_id:rule.id}));
  }
  if (!options.files && errors.length) parts.push('Rule diagnostics (not active instructions):\n' + errors.slice(0, 20).join('\n').slice(0, 5000));
  return parts.join('\n\n');
}
