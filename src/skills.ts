import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { PlatformConfig } from './types.js';
import { parseMarkdownDocument, stringList } from './frontmatter.js';
import { projectStateDir } from './paths.js';

export type SkillVisibility = 'on' | 'name-only' | 'user-invocable-only' | 'off';
export interface Skill {
  name: string;
  description: string;
  path: string;
  instructions: string;
  source: 'project' | 'user' | 'configured' | 'plugin';
  plugin?: string;
  tools?: string[];
  mode?: 'auto' | 'manual' | 'disabled';
  visibility?: SkillVisibility;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  argumentHint?: string;
  argumentNames?: string[];
  context?: 'inline' | 'fork';
  agent?: string;
  model?: string;
}

/** Prompt expansion only; no shell substitution or evaluation is performed. */
export function expandSkillInstructions(skill: Skill, args = ''): string {
  if (args.length > 1_000_000 || skill.instructions.length > 1_000_000) throw new Error('Skill input exceeds the 1 MB character limit');
  const tokens = args.match(/"[^"]*"|'[^']*'|\S+/g)?.map((value) => value.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
  const names = new Map((skill.argumentNames ?? []).slice(0, 64).flatMap((name, index) => /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) ? [[name, index] as const] : []));
  let consumed = false, expandedSize = skill.instructions.length;
  const expanded = skill.instructions.replace(/\$ARGUMENTS\[(\d+)\]|\$(\d+)|\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (placeholder, indexed: string | undefined, positional: string | undefined, name: string | undefined) => {
    let replacement: string;
    if (indexed !== undefined || positional !== undefined) { const token = tokens[Number(indexed ?? positional)]; if (token === undefined) return placeholder; replacement = token; }
    else if (name === 'ARGUMENTS') replacement = args;
    else if (name && names.has(name)) replacement = tokens[names.get(name)!] ?? '';
    else return placeholder;
    consumed = true; expandedSize += replacement.length - placeholder.length;
    if (expandedSize > 1_000_000) throw new Error('Expanded Skill instructions exceed the 1 MB character limit');
    return replacement;
  });
  const suffix = !consumed && args ? `\n\nARGUMENTS: ${args}` : '';
  if (expanded.length + suffix.length > 1_000_000) throw new Error('Expanded Skill instructions exceed the 1 MB character limit');
  return expanded + suffix;
}

export const modelInvocableSkill = (skill: Skill): boolean => skill.mode !== 'disabled' && skill.mode !== 'manual' && !skill.disableModelInvocation && skill.visibility !== 'off' && skill.visibility !== 'user-invocable-only';
export const userInvocableSkill = (skill: Skill): boolean => skill.mode !== 'disabled' && skill.visibility !== 'off' && skill.userInvocable !== false;
export function skillCatalog(skills: Skill[]): string {
  return skills.filter(modelInvocableSkill).map((skill) => skill.visibility === 'name-only' ? `- ${skill.name}` : `- ${skill.name}: ${skill.description}`).join('\n');
}

/** Tool names are a ceiling, never a permission grant from repository content. */
export function skillToolNames(value: unknown): string[] | undefined {
  const values = stringList(value)?.flatMap((item) => item.split(/\s+/).filter(Boolean));
  const aliases: Record<string, string> = { Read: 'read_file', Grep: 'search_text', Glob: 'list_files', Bash: 'bash', Write: 'write_file', Edit: 'edit_file', Agent: 'delegate', Skill: 'skill' };
  return values?.map((name) => {
    if (!/^[a-zA-Z0-9_.:-]+$/.test(name)) throw new Error('Skill tools accept exact tool names only; use permissionRules for subject patterns');
    return aliases[name] ?? name;
  });
}

export interface LoadSkillsOptions { source?: Skill['source']; plugin?: string }

function comparablePath(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** Classify canonical workspace and user Skill roots; custom roots remain configured. */
export function skillSourceForDirectory(directory: string, cwd = process.cwd()): Skill['source'] {
  const candidate = comparablePath(directory);
  const project = [join(projectStateDir(cwd), 'skills')].map(comparablePath);
  if (project.includes(candidate)) return 'project';
  return 'configured';
}

export async function loadSkillsFromDirectories(directories: string[], options: LoadSkillsOptions = {}): Promise<{ skills: Skill[]; errors: string[] }> {
  const skills: Skill[] = [];
  const errors: string[] = [];
  for (const directory of directories) {
    let candidates: Array<{ path: string; name: string; nested: boolean }> = [];
    try {
      if ((await lstat(directory)).isSymbolicLink()) { errors.push(`${directory}: Skill roots must not be symbolic links`); continue; }
      if ((await stat(directory)).isFile()) candidates = [{ path: directory, name: basename(directory, '.md'), nested: false }];
      else candidates = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.name.endsWith('.md')).map((entry) => ({ path: entry.isDirectory() ? join(directory, entry.name, 'SKILL.md') : join(directory, entry.name), name: entry.isDirectory() ? entry.name : basename(entry.name, '.md'), nested: entry.isDirectory() }));
    } catch { continue; }
    for (const candidate of candidates) {
      const { path } = candidate;
      try {
        if ((await lstat(path)).isSymbolicLink()) throw new Error('Skill files must not be symbolic links');
        if ((await stat(path)).size > 1_000_000) throw new Error('Skill file exceeds the 1 MB limit');
        const document = parseMarkdownDocument(await readFile(path, 'utf8'));
        const name = String(document.attributes.name ?? candidate.name);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name)) throw new Error('Invalid skill name');
        if (!document.body) throw new Error('Skill instructions are empty');
        for (const key of ['disallowed-tools', 'paths']) if (document.attributes[key] !== undefined) throw new Error(`Unsupported Skill field: ${key}; it is not enforced. Use allowed-tools for a tool ceiling and Rules paths for scoped instructions.`);
        const tools = skillToolNames(document.attributes['allowed-tools'] ?? document.attributes.tools);
        for (const key of ['disable-model-invocation', 'user-invocable']) if (document.attributes[key] !== undefined && typeof document.attributes[key] !== 'boolean') throw new Error(`${key} must be boolean`);
        const context = document.attributes.context;
        const namedArguments = document.attributes.arguments;
        if (namedArguments !== undefined && typeof namedArguments !== 'string' && (!Array.isArray(namedArguments) || namedArguments.some(item => typeof item !== 'string'))) throw new Error('Skill arguments must be a string or string array');
        if (context !== undefined && context !== 'fork' && context !== 'inline') throw new Error('Skill context must be inline or fork');
        skills.push({
          name,
          description: [String(document.attributes.description ?? document.body.split(/\r?\n/).find(Boolean) ?? name).replace(/^#+\s*/, ''), typeof document.attributes.when_to_use === 'string' ? document.attributes.when_to_use : ''].filter(Boolean).join(' ').slice(0, 1536),
          path,
          instructions: document.body,
          source: options.source ?? 'configured',
          ...(options.plugin ? { plugin: options.plugin } : {}),
          ...(tools ? { tools } : {}),
          ...(document.attributes['disable-model-invocation'] === true ? { mode: 'manual' as const } : {}),
          disableModelInvocation: document.attributes['disable-model-invocation'] === true,
          userInvocable: document.attributes['user-invocable'] !== false,
          ...(typeof document.attributes['argument-hint'] === 'string' ? { argumentHint: document.attributes['argument-hint'] } : {}),
          ...(namedArguments !== undefined ? { argumentNames: (typeof namedArguments === 'string' ? namedArguments.split(/\s+/) : namedArguments as string[]).slice(0, 64).map(name => name.slice(0, 64)) } : {}),
          ...(context ? { context: context as NonNullable<Skill['context']> } : {}),
          ...(typeof document.attributes.agent === 'string' ? { agent: document.attributes.agent } : {}),
          ...(typeof document.attributes.model === 'string' ? { model: document.attributes.model } : {}),
        });
      } catch (error) { errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { skills, errors };
}

export async function loadSkills(config: PlatformConfig): Promise<Skill[]> {
  const discovered = (await loadSkillsFromDirectories(config.skillsDirectories)).skills;
  const { BUNDLED_SKILLS } = await import('./skills/bundledSkills.js');
  const bundled: Skill[] = config.disableBundledSkills ? [] : BUNDLED_SKILLS.map((skill) => ({ ...skill, path: `bundled:${skill.name}`, source: 'configured' }));
  const byName = new Map<string, Skill>();
  for (const skill of [...discovered, ...bundled]) if (!byName.has(skill.name.toLowerCase())) byName.set(skill.name.toLowerCase(), skill);
  return applySkillVisibility(applySkillModes([...byName.values()], config.disabledSkills, config.skillModes), config.skillOverrides).filter((skill) => skill.mode !== 'disabled');
}

/** A disabled definition must not be re-enabled through a friendly/namespaced alias. */
export function enabledSkills(skills: Skill[], disabled: string[] = [], modes: PlatformConfig['skillModes'] = {}): Skill[] {
  return applySkillModes(skills, disabled, modes).filter((skill) => skill.mode !== 'disabled');
}

/** Alias policies are combined conservatively: disabled > manual > auto. */
export function applySkillModes(skills: Skill[], disabled: string[] = [], modes: PlatformConfig['skillModes'] = {}): Skill[] {
  const names = new Set(disabled.map((name) => name.toLowerCase()));
  const configured = new Map(Object.entries(modes).map(([name, mode]) => [name.toLowerCase(), mode]));
  const byPath = new Map<string, NonNullable<Skill['mode']>>();
  const rank = { auto: 0, manual: 1, disabled: 2 };
  for (const skill of skills) {
    const requested = configured.get(skill.name.toLowerCase()) ?? 'auto';
    const original = skill.mode ?? 'auto';
    const mode = names.has(skill.name.toLowerCase()) ? 'disabled' : rank[requested] > rank[original] ? requested : original;
    const path = comparablePath(skill.path);
    if (rank[mode] >= rank[byPath.get(path) ?? 'auto']) byPath.set(path, mode);
  }
  return skills.map((skill) => ({ ...skill, mode: byPath.get(comparablePath(skill.path)) ?? 'auto' }));
}

export function applySkillVisibility(skills: Skill[], overrides: PlatformConfig['skillOverrides'] = {}): Skill[] {
  const configured = new Map(Object.entries(overrides).map(([name, value]) => [name.toLowerCase(), value]));
  const rank = { on: 0, 'name-only': 1, 'user-invocable-only': 2, off: 3 };
  const byPath = new Map<string, SkillVisibility>();
  for (const skill of skills) {
    const visibility = configured.get(skill.name.toLowerCase()) ?? 'on';
    const path = comparablePath(skill.path);
    if (rank[visibility] >= rank[byPath.get(path) ?? 'on']) byPath.set(path, visibility);
  }
  return skills.map((skill) => {
    const visibility = byPath.get(comparablePath(skill.path)) ?? 'on';
    return { ...skill, visibility, ...(visibility === 'off' ? { mode: 'disabled' as const } : visibility === 'user-invocable-only' ? { mode: skill.mode === 'disabled' ? 'disabled' as const : 'manual' as const } : {}) };
  });
}

export function selectSkills(skills: Skill[], goal: string, requested: string[] = []): Skill[] {
  const wanted = new Set(requested.map((item) => item.toLowerCase()));
  const query = goal.toLowerCase();
  return skills.filter((skill) => skill.mode !== 'disabled' && (wanted.has(skill.name.toLowerCase()) || modelInvocableSkill(skill) && (query.includes(skill.name.toLowerCase()) || skill.name.split(/[-_.]/).some((part) => part.length > 3 && query.includes(part.toLowerCase())))));
}
