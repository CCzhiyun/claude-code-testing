import { createHash } from 'node:crypto';
import { cp, readFile, readdir, opendir, stat, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HookDefinition, LspServerConfig, McpServerConfig, PlatformConfig } from './types.js';
import { parseMarkdownDocument, stringList } from './frontmatter.js';
import { verifyPluginSignature } from './pluginSignatures.js';
import {applySignedPluginOverlay} from './pluginOverlays.js';

export interface PluginCommand {
  name: string;
  description: string;
  prompt: string;
  agent?: string;
  skills?: string[];
  isolation?: 'none' | 'worktree';
  background?: boolean;
}

export interface PluginContributions {
  skills?: string[];
  agents?: string[];
  commands?: PluginCommand[];
  hooks?: HookDefinition[];
  mcpServers?: Record<string, McpServerConfig>;
  lspServers?: Record<string, LspServerConfig>;
}

export interface PluginManifest {
  $schema?: string;
  schemaVersion?: 1;
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  publisher?: string;
  author?: string | { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  integrity?: { algorithm: 'sha256'; digest: string; signature?: import('./pluginSignatures.js').PluginSignature };
  contributes?: PluginContributions;
  skills?: string | string[];
  agents?: string | string[];
  commands?: string | string[] | PluginCommand[];
  hooks?: HookDefinition[] | string | Record<string, unknown>;
  mcp?: string;
  mcpServers?: string | Record<string, unknown>;
  lspServers?: string | Record<string, unknown>;
}

async function pluginFiles(root: string): Promise<string[]> {
  for(let path=resolve(root);;path=dirname(path)){const s=await lstat(path);if(s.isSymbolicLink()||!s.isDirectory())throw new Error('Plugin root must not traverse symbolic links or junctions');if(dirname(path)===path)break;}
  const output:string[]=[],names=new Set<string>();let entries=0,bytes=0;
  async function visit(directory:string,depth:number):Promise<void>{
    if(depth>16)throw new Error('Plugin exceeds depth limit');
    for await(const entry of await opendir(directory)){
      if(entry.name==='.git')continue;if(++entries>5000)throw new Error('Plugin exceeds entry count limit');
      const absolute=join(directory,entry.name),name=relative(root,absolute).replaceAll('\\','/').toLowerCase();if(names.has(name))throw new Error('Plugin has case-colliding paths');names.add(name);
      const s=await lstat(absolute);if(s.isSymbolicLink())throw new Error(`Plugin may not contain symbolic links: ${relative(root,absolute)}`);
      if(s.isDirectory())await visit(absolute,depth+1);else if(!s.isFile()||s.size>16*1024*1024||(bytes+=s.size)>128*1024*1024)throw new Error('Plugin file type or bounded size limit');else output.push(absolute);
    }
  }await visit(root,0);return output;
}

export async function computePluginDigest(path: string): Promise<string> {
  const root = resolve(path);
  const hash = createHash('sha256');
  let readBytes=0;
  for (const file of (await pluginFiles(root)).sort((left, right) => left.localeCompare(right))) {
    const name = relative(root, file).replaceAll('\\', '/');
    let content = await readFile(file);
    if(content.length>16*1024*1024||(readBytes+=content.length)>128*1024*1024)throw new Error('Plugin file grew beyond bounded size limit');
    if (name === 'plugin.json' || name === '.claude-plugin/plugin.json') {
      const manifest = JSON.parse(content.toString('utf8')) as PluginManifest;
      delete manifest.integrity;
      content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    }
    hash.update(name).update('\0').update(content).update('\0');
  }
  return hash.digest('hex');
}

export interface LoadedPlugin extends PluginManifest {
  overlayKeyId?:string;
  version: string;
  path: string;
  manifestPath: string;
  format: 'ccpt' | 'claude-code';
  contributions: PluginContributions;
}

export interface PluginDiagnostic { severity: 'error' | 'warning'; source: string; message: string }

function validName(name: string): boolean { return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(name); }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const substituteRoot = (value: string, root: string): string => value.replaceAll('${CCPT_PLUGIN_ROOT}', root).replaceAll('${CLAUDE_PLUGIN_ROOT}', root);

export function resolvePluginPath(root: string, value: string): string {
  if (!value || isAbsolute(value)) throw new Error(`Plugin contribution path must be relative: ${value}`);
  const absolute = resolve(root, value);
  const base = resolve(root);
  if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) throw new Error(`Plugin contribution escapes its root: ${value}`);
  return absolute;
}

async function markdownCommands(root: string, values: string[]): Promise<PluginCommand[]> {
  const output: PluginCommand[] = [];
  const visit = async (path: string): Promise<void> => {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Plugin may not contain symbolic links: ${relative(root, join(path, entry.name))}`);
        if (entry.isDirectory() || entry.isFile() && extname(entry.name).toLowerCase() === '.md') await visit(join(path, entry.name));
      }
      return;
    }
    if (extname(path).toLowerCase() !== '.md') return;
    const document = parseMarkdownDocument(await readFile(path, 'utf8'));
    const name = String(document.attributes.name ?? basename(path, '.md')).replace(/^\//, '');
    if (!validName(name) || !document.body) throw new Error(`Invalid Claude command: ${relative(root, path)}`);
    const skills = stringList(document.attributes.skills);
    output.push({
      name,
      description: String(document.attributes.description ?? document.body.split(/\r?\n/).find(Boolean) ?? name).replace(/^#+\s*/, '').slice(0, 240),
      prompt: document.body.replaceAll('$ARGUMENTS', '{args}'),
      ...(typeof document.attributes.agent === 'string' ? { agent: document.attributes.agent } : {}),
      ...(skills ? { skills } : {}),
      ...(document.attributes.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}),
      ...(document.attributes.background === true ? { background: true } : {}),
    });
  };
  for (const value of values) {
    const path = resolvePluginPath(root, value);
    if (await exists(path)) await visit(path);
  }
  return output;
}

async function json(path: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; }

function normalizeMcp(root: string, source: Record<string, unknown>): Record<string, McpServerConfig> {
  const entries = source.mcpServers && typeof source.mcpServers === 'object' ? source.mcpServers as Record<string, unknown> : source;
  const output: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(entries)) {
    if (!raw || typeof raw !== 'object' || !validName(name)) continue;
    const value = raw as Record<string, unknown>;
    const command = typeof value.command === 'string' ? substituteRoot(value.command, root) : undefined;
    const url = typeof value.url === 'string' ? value.url : undefined;
    const args = Array.isArray(value.args) ? value.args.map(String).map((item) => substituteRoot(item, root)) : undefined;
    if (command) output[name] = { transport: 'stdio', command, cwd: root, ...(args ? { args } : {}) };
    else if (url) output[name] = { transport: 'http', url };
  }
  return output;
}

async function normalizeMcpManifest(root: string, value: PluginManifest['mcpServers']): Promise<Record<string, McpServerConfig>> {
  if (typeof value === 'string') return normalizeMcp(root, await json(resolvePluginPath(root, value)));
  if (value && typeof value === 'object') return normalizeMcp(root, value);
  const path = join(root, '.mcp.json');
  return await exists(path) ? normalizeMcp(root, await json(path)) : {};
}

async function normalizeLspManifest(root: string, value: PluginManifest['lspServers']): Promise<Record<string, LspServerConfig>> {
  const source = typeof value === 'string' ? await json(resolvePluginPath(root, value)) : value && typeof value === 'object' ? value : await exists(join(root, '.lsp.json')) ? await json(join(root, '.lsp.json')) : {};
  return Object.fromEntries(Object.entries(source).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== 'object' || !validName(name)) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.command !== 'string' || !item.extensionToLanguage || typeof item.extensionToLanguage !== 'object') return [];
    const mappings = item.extensionToLanguage as Record<string, string>;
    const extensions = Object.keys(mappings);
    const languageId = Object.values(mappings)[0] ?? name;
    return [[name, { command: substituteRoot(item.command, root), cwd: root, extensions, languageId, ...(Array.isArray(item.args) ? { args: item.args.map(String).map((arg) => substituteRoot(arg, root)) } : {}) }]];
  }));
}

async function normalizeHooks(root: string, value: PluginManifest['hooks']): Promise<HookDefinition[]> {
  if (Array.isArray(value)) return value;
  const path = typeof value === 'string' ? resolvePluginPath(root, value) : join(root, 'hooks', 'hooks.json');
  if (typeof value !== 'object' && !await exists(path)) return [];
  const document = value && typeof value === 'object' ? value : await json(path);
  const events = document.hooks && typeof document.hooks === 'object' ? document.hooks as Record<string, unknown> : document;
  const output: HookDefinition[] = [];
  for (const [event, groups] of Object.entries(events)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!group || typeof group !== 'object') continue;
      const groupObject = group as Record<string, unknown>;
      for (const raw of Array.isArray(groupObject.hooks) ? groupObject.hooks : []) {
        if (!raw || typeof raw !== 'object') continue;
        const hook = raw as Record<string, unknown>;
        // Preserve once/watch/type fields. Runtime validation, not dropping an
        // unknown declaration, decides whether a contribution is supported.
        output.push({ ...structuredClone(hook), event,
          ...(typeof groupObject.matcher === 'string' ? { matcher: groupObject.matcher } : {}),
          ...(typeof hook.command === 'string' ? { command: substituteRoot(hook.command, root) } : {}),
        } as unknown as HookDefinition);
      }
    }
  }
  return output;
}

async function normalizeManifest(root: string, manifest: PluginManifest, format: LoadedPlugin['format']): Promise<PluginContributions> {
  const commandEntries: Array<string | PluginCommand> = manifest.commands === undefined ? [] : Array.isArray(manifest.commands) ? manifest.commands : [manifest.commands];
  if (format === 'ccpt') return {
    skills: manifest.contributes?.skills ?? array(manifest.skills).map(String),
    agents: manifest.contributes?.agents ?? array(manifest.agents).map(String),
    commands: manifest.contributes?.commands ?? commandEntries.filter((value): value is PluginCommand => typeof value === 'object'),
    hooks: manifest.contributes?.hooks ?? (Array.isArray(manifest.hooks) ? manifest.hooks : []),
    mcpServers: manifest.contributes?.mcpServers ?? {},
    lspServers: manifest.contributes?.lspServers ?? {},
  };
  const skillValues = array(manifest.skills).map(String);
  const agentValues = array(manifest.agents).map(String);
  const commandValues = commandEntries.filter((value): value is string => typeof value === 'string');
  const defaultSkills = await exists(join(root, 'skills')) ? ['./skills'] : await exists(join(root, 'SKILL.md')) ? ['./SKILL.md'] : [];
  const defaultAgents = await exists(join(root, 'agents')) ? ['./agents'] : [];
  const defaultCommands = await exists(join(root, 'commands')) ? ['./commands'] : [];
  return {
    skills: [...defaultSkills, ...skillValues].map((value) => resolvePluginPath(root, value)),
    agents: (agentValues.length ? agentValues : defaultAgents).map((value) => resolvePluginPath(root, value)),
    commands: await markdownCommands(root, commandValues.length ? commandValues : defaultCommands),
    hooks: await normalizeHooks(root, manifest.hooks),
    mcpServers: await normalizeMcpManifest(root, manifest.mcpServers),
    lspServers: await normalizeLspManifest(root, manifest.lspServers),
  };
}

export async function loadPluginAt(path: string): Promise<LoadedPlugin> {
  const root = resolve(path);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Plugin root may not be a symbolic link or junction');
  await pluginFiles(root); // Validate before parsing a manifest or following any contribution path.
  const claudeManifestPath = join(root, '.claude-plugin', 'plugin.json');
  const ccptManifestPath = join(root, 'plugin.json');
  const format: LoadedPlugin['format'] = await exists(claudeManifestPath) || !await exists(ccptManifestPath) ? 'claude-code' : 'ccpt';
  const manifestPath = format === 'claude-code' ? claudeManifestPath : ccptManifestPath;
  const manifest: PluginManifest = await exists(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) as PluginManifest : { name: basename(root) };
  if (!validName(manifest.name ?? '') || manifest.version !== undefined && !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error('Plugin requires a valid name and semantic version');
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) throw new Error(`Unsupported plugin schemaVersion: ${manifest.schemaVersion}`);
  if (manifest.integrity) {
    if (manifest.integrity.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(manifest.integrity.digest)) throw new Error('Plugin integrity must be a SHA-256 digest');
    const actual = await computePluginDigest(root);
    if (actual.toLowerCase() !== manifest.integrity.digest.toLowerCase()) throw new Error(`Plugin integrity check failed (expected ${manifest.integrity.digest}, received ${actual})`);
  }
  const contributions = await normalizeManifest(root, manifest, format);
  validatePluginContributions(root,contributions);
  return { ...manifest, version: manifest.version ?? '0.0.0', path: root, manifestPath, format, contributions };
}
export function validatePluginContributions(root:string,contributions:PluginContributions):void{
  for (const value of [...(contributions.skills ?? []), ...(contributions.agents ?? [])]) {
    const absolute = isAbsolute(value) ? value : resolvePluginPath(root, value);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error(`Plugin contribution escapes its root: ${value}`);
  }
  const commandNames = new Set<string>();
  for (const command of contributions.commands ?? []) {
    command.name = command.name.replace(/^\//, '');
    if (!validName(command.name) || !command.description || !command.prompt) throw new Error('Every plugin command requires a valid name, description, and prompt');
    if (commandNames.has(command.name)) throw new Error(`Duplicate plugin command: ${command.name}`);
    commandNames.add(command.name);
  }
  for (const [name, server] of Object.entries(contributions.mcpServers ?? {})) {
    if (!validName(name)) throw new Error(`Invalid MCP server name: ${name}`);
    if (server.transport === 'stdio') { if (!server.command) throw new Error(`MCP server ${name} requires command`); server.cwd = root; }
    else if (!server.url) throw new Error(`MCP server ${name} requires url`);
  }
}

export async function discoverPlugins(config: PlatformConfig): Promise<{ plugins: LoadedPlugin[]; diagnostics: PluginDiagnostic[] }> {
  const plugins: LoadedPlugin[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  const names = new Map<string, string>();
  for (const directory of config.pluginDirectories) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
      const path = join(directory, entry.name);
      try {
        let plugin = await loadPluginAt(path);
        if (config.disabledPlugins.includes(plugin.name)) continue;
        await verifyPluginLock(plugin, config);
        await verifyPluginSignature(plugin, config);
        plugin=applySignedPluginOverlay(plugin,config);validatePluginContributions(plugin.path,plugin.contributions);
        const previous = names.get(plugin.name);
        if (previous) { diagnostics.push({ severity: 'warning', source: plugin.manifestPath, message: `Plugin ${plugin.name} is shadowed by ${previous}` }); continue; }
        names.set(plugin.name, plugin.manifestPath);
        plugins.push(plugin);
      } catch (error) { diagnostics.push({ severity: 'error', source: join(path, 'plugin.json'), message: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return { plugins, diagnostics };
}

export async function loadPlugins(config: PlatformConfig): Promise<LoadedPlugin[]> { return (await discoverPlugins(config)).plugins; }

export async function validatePlugin(path: string): Promise<{ ok: boolean; plugin?: LoadedPlugin; diagnostics: PluginDiagnostic[] }> {
  try {
    const root = (await stat(path)).isDirectory() ? path : resolve(path, '..');
    const plugin = await loadPluginAt(root);
    const diagnostics: PluginDiagnostic[] = [];
    for (const contribution of [...(plugin.contributions.skills ?? []), ...(plugin.contributions.agents ?? [])]) {
      const target = isAbsolute(contribution) ? contribution : resolvePluginPath(plugin.path, contribution);
      try { await stat(target); } catch { diagnostics.push({ severity: 'error', source: target, message: 'Contribution path does not exist' }); }
    }
    return { ok: !diagnostics.some((item) => item.severity === 'error'), plugin, diagnostics };
  } catch (error) { return { ok: false, diagnostics: [{ severity: 'error', source: path, message: error instanceof Error ? error.message : String(error) }] }; }
}

export async function installPlugin(source: string, destinationDirectory: string, targetName?: string): Promise<string> {
  const validated = await validatePlugin(source);
  if (!validated.ok || !validated.plugin) throw new Error(validated.diagnostics.map((item) => item.message).join('; '));
  const name = targetName ?? validated.plugin.name;
  if (!validName(name)) throw new Error('Invalid plugin destination name');
  const target = resolvePluginPath(destinationDirectory, name);
  const digest = await computePluginDigest(validated.plugin.path);
  try { await stat(target); throw new Error(`Plugin destination already exists: ${target}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(destinationDirectory, { recursive: true });
  const staging = await mkdtemp(join(destinationDirectory, '.pending-install-'));
  try {
    await cp(validated.plugin.path, staging, { recursive: true, errorOnExist: true, force: false, filter: (source) => basename(source) !== '.git' });
    if (await computePluginDigest(staging) !== digest) throw new Error('Plugin changed during installation; copied content has not been verified');
    await rename(staging, target);
  } finally {
    // Exact freshly created staging directory, never the source or installed plugin.
    await rm(staging, { recursive: true, force: true });
  }
  return target;
}

export async function verifyPluginLock(plugin: LoadedPlugin, config: PlatformConfig): Promise<void> {
  const lock = config.pluginLocks?.[plugin.name];
  if (!lock) { if (config.requirePluginLocks) throw new Error(`Plugin ${plugin.name} has no approved lock; pin its reviewed version and digest first`); return; }
  if (plugin.version !== lock.version) throw new Error(`Plugin ${plugin.name} version mismatch: locked ${lock.version}, found ${plugin.version}`);
  if ((await computePluginDigest(plugin.path)).toLowerCase() !== lock.digest.toLowerCase()) throw new Error(`Plugin ${plugin.name} differs from its approved SHA-256 lock; contributions are disabled`);
}

export function pluginRelativePath(plugin: LoadedPlugin, target: string): string { return relative(plugin.path, target); }
