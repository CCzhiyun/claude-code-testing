import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseMarkdownDocument, stringList } from './frontmatter.js';
import { skillToolNames } from './skills.js';
import type { PermissionMode, PlatformConfig } from './types.js';
import { projectStateDir } from './paths.js';

export interface AgentDefinition {
  name: string;
  description: string;
  prompt: string;
  path: string;
  source: 'project' | 'user' | 'configured' | 'plugin';
  plugin?: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  mcpServers?: string[];
  model?: string;
  permissionMode?: PermissionMode | 'plan';
  isolation?: 'none' | 'worktree';
  background?: boolean;
  maxTurns?: number;
  memory?: 'user' | 'project' | 'local';
}

export function validateAgentDefinition(definition: Partial<AgentDefinition>): void {
  if (!definition.name || !validName(definition.name) || typeof definition.description !== 'string' || !definition.description.trim() || typeof definition.prompt !== 'string' || !definition.prompt.trim()) throw new Error('Agent requires a valid name, description, and prompt');
  for (const key of ['tools', 'disallowedTools', 'skills', 'mcpServers'] as const) if (definition[key] !== undefined && (!Array.isArray(definition[key]) || definition[key]!.some((value) => typeof value !== 'string' || !value.trim()))) throw new Error(`Agent ${key} must be a string array`);
  if (definition.permissionMode !== undefined && !['normal', 'restricted', 'sandbox', 'bypass', 'acceptEdits', 'plan'].includes(definition.permissionMode)) throw new Error('Invalid Agent permissionMode');
  if (definition.isolation !== undefined && !['none', 'worktree'].includes(definition.isolation)) throw new Error('Invalid Agent isolation');
  if (definition.memory !== undefined && !['user', 'project', 'local'].includes(definition.memory)) throw new Error('Invalid Agent memory scope');
  if (definition.model !== undefined && (typeof definition.model !== 'string' || !definition.model.trim())) throw new Error('Invalid Agent model');
  if (definition.maxTurns !== undefined && (!Number.isSafeInteger(definition.maxTurns) || definition.maxTurns <= 0)) throw new Error('Invalid Agent maxTurns');
  if (definition.background !== undefined && typeof definition.background !== 'boolean') throw new Error('Invalid Agent background');
}

/** Specialist metadata cannot promote the caller's execution mode. */
export function agentPermissionMode(parent: PermissionMode, requested?: AgentDefinition['permissionMode']): PermissionMode {
  const rank = { bypass: 0, acceptEdits: 1, normal: 2, sandbox: 3, restricted: 4 };
  const effective = requested === 'plan' ? 'restricted' : requested;
  return effective && rank[effective] > rank[parent] ? effective : parent;
}

export interface LoadAgentsOptions {
  source?: AgentDefinition['source'];
  plugin?: string;
}

export function inlineAgentDefinitions(config: PlatformConfig): AgentDefinition[] {
  const definitions = config.agentDefinitions;
  if (definitions === undefined) return [];
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) throw new Error('agentDefinitions must be an object');
  return Object.entries(definitions).map(([name, definition]) => {
    if (!validName(name) || !definition || typeof definition.prompt !== 'string' || !definition.prompt.trim() || typeof definition.description !== 'string' || !definition.description.trim()) throw new Error('Temporary Agent requires a valid name, description, and prompt');
    for (const key of ['tools', 'disallowedTools', 'skills', 'mcpServers'] as const) if (definition[key] !== undefined && (!Array.isArray(definition[key]) || definition[key]!.some((value) => typeof value !== 'string' || !value.trim()))) throw new Error(`Temporary Agent ${key} must be a string array`);
    if (definition.permissionMode !== undefined && !['normal', 'restricted', 'sandbox', 'bypass', 'acceptEdits', 'plan'].includes(definition.permissionMode)) throw new Error('Invalid temporary Agent permissionMode');
    if (definition.isolation !== undefined && !['none', 'worktree'].includes(definition.isolation)) throw new Error('Invalid temporary Agent isolation');
    if (definition.model !== undefined && (typeof definition.model !== 'string' || !definition.model.trim())) throw new Error('Invalid temporary Agent model');
    if (definition.maxTurns !== undefined && (!Number.isSafeInteger(definition.maxTurns) || definition.maxTurns <= 0)) throw new Error('Invalid temporary Agent maxTurns');
    if (definition.background !== undefined && typeof definition.background !== 'boolean') throw new Error('Invalid temporary Agent background');
    validateAgentDefinition({ ...definition, name });
    return { ...definition, name, path: `runtime:${name}`, source: 'configured' };
  });
}

function comparablePath(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

export function agentSourceForDirectory(directory: string, cwd = process.cwd()): AgentDefinition['source'] {
  const candidate = comparablePath(directory);
  const projectDirectories = [join(projectStateDir(cwd), 'agents')].map(comparablePath);
  return projectDirectories.includes(candidate) ? 'project' : 'configured';
}

function validName(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
}

/** Runtime task records share the state folder when the trusted workspace is the user's home. */
function isRuntimeAgentRecord(name: string): boolean {
  return /^agent_[a-f0-9]{16}\.json$/i.test(name);
}

async function parseAgent(path: string, options: LoadAgentsOptions): Promise<AgentDefinition> {
  if (extname(path).toLowerCase() === '.json') {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<AgentDefinition> & { systemPrompt?: string };
    const name = value.name ?? basename(path, '.json').replace(/\.agent$/, '');
    if (!validName(name) || !value.description || !(value.prompt ?? value.systemPrompt)) throw new Error('Agent JSON requires a valid name, description, and prompt');
    const definition = { ...value, name, prompt: value.prompt ?? value.systemPrompt ?? '', description: value.description, path, source: options.source ?? 'configured', ...(options.plugin ? { plugin: options.plugin } : {}) };
    validateAgentDefinition(definition);
    return definition;
  }
  const document = parseMarkdownDocument(await readFile(path, 'utf8'));
  const name = String(document.attributes.name ?? basename(path, '.md'));
  const description = String(document.attributes.description ?? '');
  if (!validName(name) || !description || !document.body) throw new Error('Agent Markdown requires name and description frontmatter plus a prompt body');
  const permissionMode = document.attributes.permissionMode;
  const isolation = document.attributes.isolation;
  const maxTurns = Number(document.attributes.maxTurns);
  const tools = skillToolNames(document.attributes.tools);
  const disallowedTools = skillToolNames(document.attributes.disallowedTools);
  const skills = stringList(document.attributes.skills);
  const mcpServers = stringList(document.attributes.mcpServers);
  const definition: AgentDefinition = {
    name,
    description,
    prompt: document.body,
    path,
    source: options.source ?? 'configured',
    ...(options.plugin ? { plugin: options.plugin } : {}),
    ...(tools ? { tools } : {}),
    ...(disallowedTools ? { disallowedTools } : {}),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(typeof document.attributes.model === 'string' ? { model: document.attributes.model } : {}),
    ...(permissionMode !== undefined ? { permissionMode: permissionMode as NonNullable<AgentDefinition['permissionMode']> } : {}),
    ...(isolation !== undefined ? { isolation: isolation as 'none' | 'worktree' } : {}),
    ...(document.attributes.background !== undefined ? { background: document.attributes.background as boolean } : {}),
    ...(document.attributes.maxTurns !== undefined ? { maxTurns } : {}),
    ...(document.attributes.memory !== undefined ? { memory: document.attributes.memory as NonNullable<AgentDefinition['memory']> } : {}),
  };
  validateAgentDefinition(definition);
  return definition;
}

export async function loadAgentsFromDirectories(directories: string[], options: LoadAgentsOptions = {}): Promise<{ agents: AgentDefinition[]; errors: string[] }> {
  const agents: AgentDefinition[] = [];
  const errors: string[] = [];
  for (const directory of directories) {
    let paths: string[] = [];
    try {
      if ((await lstat(directory)).isSymbolicLink()) { errors.push(`${directory}: Agent roots must not be symbolic links`); continue; }
      if ((await stat(directory)).isFile()) paths = [directory];
      else {
        let visited = 0;
        const visit = async (folder: string, depth: number): Promise<void> => {
          if (depth > 16) { errors.push(`${folder}: Agent definition nesting exceeds 16 directories`); return; }
          for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            if (++visited > 4096 || paths.length >= 512) { errors.push(`${directory}: Agent discovery limit reached`); return; }
            if (entry.isSymbolicLink()) { errors.push(`${join(folder, entry.name)}: Agent symlinks are not scanned automatically`); continue; }
            if (entry.isDirectory()) await visit(join(folder, entry.name), depth + 1);
            else if (entry.name.endsWith('.md') || entry.name.endsWith('.json') && !isRuntimeAgentRecord(entry.name)) paths.push(join(folder, entry.name));
          }
        };
        await visit(directory, 0);
      }
    } catch { continue; }
    for (const path of paths) {
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Agent files must not be symbolic links'); agents.push(await parseAgent(path, options)); }
      catch (error) { errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { agents, errors };
}

export async function loadAgents(config: PlatformConfig): Promise<AgentDefinition[]> {
  return (await loadAgentsFromDirectories(config.agentsDirectories)).agents;
}
