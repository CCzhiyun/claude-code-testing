import { isAbsolute, resolve } from 'node:path';
import { sep } from 'node:path';
import { approvedGlobalDirectories } from './globalExtensionTrust.js';
import type { PlatformConfig } from './types.js';
import { loadConfig, validateConfig } from './config.js';
import { loadSkillsFromDirectories, skillSourceForDirectory, type Skill } from './skills.js';
import { agentSourceForDirectory, loadAgentsFromDirectories, inlineAgentDefinitions, type AgentDefinition } from './agents.js';
import { discoverPlugins, resolvePluginPath, type LoadedPlugin, type PluginCommand } from './plugins.js';

export interface PlatformDiagnostic {
  severity: 'error' | 'warning';
  component: 'plugin' | 'skill' | 'agent' | 'command' | 'mcp';
  source: string;
  message: string;
}

export interface RegisteredCommand extends PluginCommand {
  name: string;
  plugin: string;
}

export interface PlatformRegistry {
  config: PlatformConfig;
  plugins: LoadedPlugin[];
  skills: Skill[];
  /** Includes disabled definitions for management UIs; never inject this list into a model prompt. */
  availableSkills?: Skill[];
  agents: AgentDefinition[];
  commands: RegisteredCommand[];
  diagnostics: PlatformDiagnostic[];
}

function addUnique<T extends { name: string; path: string }>(
  output: T[],
  incoming: T[],
  component: 'skill' | 'agent',
  diagnostics: PlatformDiagnostic[],
): void {
  const names = new Map(output.map((item) => [item.name.toLowerCase(), item.path]));
  for (const item of incoming) {
    const previous = names.get(item.name.toLowerCase());
    if (previous) {
      diagnostics.push({ severity: 'warning', component, source: item.path, message: `${component} ${item.name} is shadowed by ${previous}` });
      continue;
    }
    names.set(item.name.toLowerCase(), item.path);
    output.push(item);
  }
}

export async function loadPlatform(cwd = process.cwd(), inputConfig?: PlatformConfig): Promise<PlatformRegistry> {
  const config = structuredClone(inputConfig ?? await loadConfig(cwd));
  validateConfig(config);
  if(config.usePluginSets){const selected=await(await import('./pluginSets.js')).pluginSetConfiguration(cwd,config);config.pluginDirectories=selected.directories;config.pluginOverlays=selected.overlays;}
  const workspace = resolve(cwd), comparable = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  for (const [kind, paths] of [['skill',config.skillsDirectories],['agent',config.agentsDirectories],['plugin',config.pluginDirectories]] as const) {
    const external = paths.filter(path => comparable(path) !== comparable(workspace) && !comparable(path).startsWith(comparable(workspace) + sep));
    if (external.length) await approvedGlobalDirectories(kind, external);
  }
  const diagnostics: PlatformDiagnostic[] = [];
  const skills: Skill[] = [];
  const agents: AgentDefinition[] = inlineAgentDefinitions(config);
  for (const directory of config.skillsDirectories) {
    const loaded = await loadSkillsFromDirectories([directory], { source: skillSourceForDirectory(directory, cwd) });
    addUnique(skills, loaded.skills, 'skill', diagnostics);
    diagnostics.push(...loaded.errors.map((message) => ({ severity: 'error' as const, component: 'skill' as const, source: message.split(': ')[0] ?? directory, message })));
  }
  for (const directory of config.agentsDirectories) {
    const loaded = await loadAgentsFromDirectories([directory], { source: agentSourceForDirectory(directory, cwd) });
    addUnique(agents, loaded.agents, 'agent', diagnostics);
    diagnostics.push(...loaded.errors.map((message) => ({ severity: 'error' as const, component: 'agent' as const, source: message.split(': ')[0] ?? directory, message })));
  }
  const discovered = await discoverPlugins(config);
  diagnostics.push(...discovered.diagnostics.map((item) => ({ ...item, component: 'plugin' as const })));
  const commands: RegisteredCommand[] = [];
  const commandNames = new Set<string>();
  for (const plugin of discovered.plugins) {
    const pluginSkillDirectories = (plugin.contributions.skills ?? []).map((path) => isAbsolute(path) ? path : resolvePluginPath(plugin.path, path));
    const pluginAgentDirectories = (plugin.contributions.agents ?? []).map((path) => isAbsolute(path) ? path : resolvePluginPath(plugin.path, path));
    const loadedSkills = await loadSkillsFromDirectories(pluginSkillDirectories, { source: 'plugin', plugin: plugin.name });
    const loadedAgents = await loadAgentsFromDirectories(pluginAgentDirectories, { source: 'plugin', plugin: plugin.name });
    const localSkillNames = new Set(loadedSkills.skills.map((skill) => skill.name));
    const localAgentNames = new Set(loadedAgents.agents.map((agent) => agent.name));
    const existingSkillNames = new Set(skills.map((skill) => skill.name.toLowerCase()));
    const mappedSkill = (skill: Skill): Skill => ({ ...skill, ...(skill.agent && !skill.agent.includes(':') && localAgentNames.has(skill.agent) ? { agent: `${plugin.name}:${skill.agent}` } : {}) });
    const friendlySkills = loadedSkills.skills.filter((skill) => !existingSkillNames.has(skill.name.toLowerCase())).map(mappedSkill);
    const namespacedSkills = loadedSkills.skills.map((skill) => ({ ...mappedSkill(skill), name: `${plugin.name}:${skill.name}` }));
    const namespacedAgents = loadedAgents.agents.map((agent) => {
      const mappedSkills = agent.skills?.map((name) => name.includes(':') || !localSkillNames.has(name) ? name : `${plugin.name}:${name}`);
      return { ...agent, name: `${plugin.name}:${agent.name}`, ...(mappedSkills ? { skills: mappedSkills } : {}) };
    });
    addUnique(skills, friendlySkills, 'skill', diagnostics);
    addUnique(skills, namespacedSkills, 'skill', diagnostics);
    addUnique(agents, namespacedAgents, 'agent', diagnostics);
    diagnostics.push(...loadedSkills.errors.map((message) => ({ severity: 'error' as const, component: 'skill' as const, source: plugin.name, message })));
    diagnostics.push(...loadedAgents.errors.map((message) => ({ severity: 'error' as const, component: 'agent' as const, source: plugin.name, message })));
    for (const command of plugin.contributions.commands ?? []) {
      const registeredName = plugin.format === 'claude-code' ? `/${plugin.name}:${command.name}` : `/${command.name}`;
      const key = registeredName.toLowerCase();
      if (commandNames.has(key)) {
        diagnostics.push({ severity: 'warning', component: 'command', source: plugin.manifestPath, message: `Command ${registeredName} is already registered` });
        continue;
      }
      commandNames.add(key);
      commands.push({
        ...command,
        name: registeredName,
        plugin: plugin.name,
        ...(command.agent && !command.agent.includes(':') && localAgentNames.has(command.agent) ? { agent: `${plugin.name}:${command.agent}` } : {}),
        ...(command.skills ? { skills: command.skills.map((name) => name.includes(':') || !localSkillNames.has(name) ? name : `${plugin.name}:${name}`) } : {}),
      });
    }
    config.hooks.push(...(plugin.contributions.hooks ?? []).map(hook => ({ ...hook, source: `plugin:${plugin.name}` })));
    for (const [name, server] of Object.entries(plugin.contributions.mcpServers ?? {})) {
      if (config.strictMcpConfig) continue;
      const namespaced = `${plugin.name}.${name}`;
      if (config.mcpServers[namespaced]) {
        diagnostics.push({ severity: 'warning', component: 'mcp', source: plugin.manifestPath, message: `MCP server ${namespaced} is already configured` });
        continue;
      }
      config.mcpServers[namespaced] = { ...server, ...(server.cwd ? { cwd: resolve(server.cwd) } : {}) };
    }
    for (const [name, server] of Object.entries(plugin.contributions.lspServers ?? {})) {
      const namespaced = `${plugin.name}.${name}`;
      if (config.lspServers[namespaced]) {
        diagnostics.push({ severity: 'warning', component: 'plugin', source: plugin.manifestPath, message: `LSP server ${namespaced} is already configured` });
        continue;
      }
      config.lspServers[namespaced] = { ...server, ...(server.cwd ? { cwd: resolve(server.cwd) } : {}) };
    }
  }
  // Preserve built-in capabilities in the same registry, at lowest precedence.
  // Previously they were executable but absent from the displayed catalog.
  const { BUNDLED_SKILLS } = await import('./skills/bundledSkills.js');
  const registeredNames = new Set(skills.map((skill) => skill.name.toLowerCase()));
  for (const skill of config.disableBundledSkills ? [] : BUNDLED_SKILLS) {
    if (!registeredNames.has(skill.name.toLowerCase())) {
      skills.push({ ...skill, path: `bundled:${skill.name}`, source: 'configured' });
      registeredNames.add(skill.name.toLowerCase());
    }
  }
  const { applySkillModes, applySkillVisibility } = await import('./skills.js');
  const availableSkills = applySkillVisibility(applySkillModes(skills, config.disabledSkills, config.skillModes), config.skillOverrides);
  return { config, plugins: discovered.plugins, skills: availableSkills.filter((skill) => skill.mode !== 'disabled'), availableSkills, agents, commands, diagnostics };
}

export function expandCommand(command: RegisteredCommand, args: string, cwd: string): string {
  const limit = 1_000_000;
  const argsSize = Buffer.byteLength(args, 'utf8'), cwdSize = Buffer.byteLength(cwd, 'utf8');
  let size = Buffer.byteLength(command.prompt, 'utf8');
  if (size > limit || argsSize > limit || cwdSize > limit) throw new Error('Command expansion exceeds the 1 MB safety limit');
  for (const match of command.prompt.matchAll(/\{args\}|\{cwd\}/g)) {
    size += (match[0] === '{args}' ? argsSize : cwdSize) - match[0].length;
    if (size > limit) throw new Error('Command expansion exceeds the 1 MB safety limit');
  }
  // Substitute only original placeholders: user input containing {cwd} is data.
  return command.prompt.replace(/\{args\}|\{cwd\}/g, placeholder => placeholder === '{args}' ? args : cwd).trim();
}
