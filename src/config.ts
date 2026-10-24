import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlatformConfig } from './types.js';
import { homeStateDir, projectStateDir } from './paths.js';
import { readJson, writeJson } from './storage.js';
import { CURRENT_SETTINGS_VERSION, migrateSettingsFile } from './migrations/index.js';
import { validateSpending } from './spending.js';
import { bundledCaFile } from './bundledCa.js';
import { validateModelRetry } from './modelRetry.js';
import { inlineAgentDefinitions } from './agents.js';
import { validatePluginTrust } from './pluginSignatures.js';
import { resolveModelEndpoint, resolveModelProtocol } from './modelConnection.js';
import { validateCompactionPolicy } from './semanticCompaction.js';
import {validateInputTokenCounting} from './inputTokenCounting.js';
import { approvedGlobalDirectories } from './globalExtensionTrust.js';
import { validateOperationRecovery } from './operationRecoveryConfig.js';
import {validateHookWatch} from './hookWatchConfig.js';
import { validateMcpSamplingBudget } from './mcpModelSampling.js';
import { HOOK_EVENTS } from './hookContracts.js';
import { validateTokenizerVocabulary } from './textTokenizer.js';
import { contextFramingTokens } from './contextBudget.js';
import {validateRuntimeReplay} from './runtimeReplay.js';
import {validatePluginRollout} from './pluginRollout.js';

export const defaultConfig: PlatformConfig = {
  network: {
    ...((process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY) ? { proxyUrl: (process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY)! } : {}),
    allowedHosts: [],
    rejectUnauthorized: true,
    timeoutMs: 120_000,
  },
  remote: {
    enabled: false,
    authTokenEnv: 'CCPT_REMOTE_TOKEN',
    reconnectAttempts: 5,
    reconnectDelayMs: 1_000,
    pingIntervalMs: 30_000,
    maxAttachmentBytes: 10 * 1024 * 1024,
  },
  model: {
    provider: 'openai',
    name: 'ccpt-model',
    baseUrl: 'http://127.0.0.1:11434/v1',
    maxContextTokens: 200_000,
    maxOutputTokens: 8_192,
    thinkingEnabled: false,
    reasoningEffort: 'high',
    fastMode: false,
  },
  policy: {
    mode: 'normal',
    workspaceRoots: [],
    allowNetwork: true,
    allowedCommands: ['git', 'gh', 'npm', 'npx', 'bun', 'node', 'rg', 'tsc'],
    deniedCommands: ['rm', 'rmdir', 'del', 'format', 'shutdown', 'reboot'],
    protectedPatterns: ['.env', '.ssh', '.aws', '.azure', '.config/gcloud', 'credentials', 'id_rsa'],
    allowGitPush: false,
    allowPullRequests: false,
    allowedEnvironmentVariables: ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'CI', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'],
    commandTimeoutMs: 300_000,
    permissionRules: { allow: [], ask: [], deny: [] },
  },
  agents: {
    maxConcurrent: 4,
    maxPerSession: 12,
    maxDepth: 2,
    defaultIsolation: 'worktree',
    maxTurns: 24,
    heartbeatTimeoutMs: 30_000,
    worktreeCleanup: 'manual',
  },
  hooks: [],
  mcpServers: {},
  lspServers: {},
  skillsDirectories: [],
  agentsDirectories: [],
  pluginDirectories: [],
  disabledPlugins: [],
  disabledSkills: [],
  marketplaceEnabled: true,
  vimMode: false,
  coordinatorMode: false,
  ui: {
    autoCompact: true,
    showTips: true,
    reduceMotion: false,
    sessionRecap: true,
    rewindCode: true,
    verboseOutput: false,
    terminalProgressBar: true,
    showTurnDuration: true,
    worktreeBaseRef: 'fresh',
    useAutoModeDuringPlan: true,
    respectGitignore: true,
  },
};

export function mergeConfig(base: PlatformConfig, override: Partial<PlatformConfig>): PlatformConfig {
  return {
    ...base,
    ...override,
    network: { ...base.network, ...override.network },
    remote: { ...base.remote, ...override.remote },
    model: { ...base.model, ...override.model },
    policy: { ...base.policy, ...override.policy, permissionRules: { ...base.policy.permissionRules, ...override.policy?.permissionRules } },
    agents: { ...base.agents, ...override.agents },
    ui: { ...base.ui, ...override.ui },
    hooks: override.hooks ?? base.hooks,
    mcpServers: { ...base.mcpServers, ...override.mcpServers },
    lspServers: { ...base.lspServers, ...override.lspServers },
    skillsDirectories: override.skillsDirectories ?? base.skillsDirectories,
    agentsDirectories: override.agentsDirectories ?? base.agentsDirectories,
    pluginDirectories: override.pluginDirectories ?? base.pluginDirectories,
    disabledPlugins: override.disabledPlugins ?? base.disabledPlugins,
    disabledSkills: override.disabledSkills ?? base.disabledSkills ?? [],
    skillModes: { ...base.skillModes, ...override.skillModes },
    skillOverrides: { ...base.skillOverrides, ...override.skillOverrides },
    pluginLocks: { ...base.pluginLocks, ...override.pluginLocks },
    agentDefinitions: { ...base.agentDefinitions, ...override.agentDefinitions },
    ...(base.modelRetry || override.modelRetry ? { modelRetry: { ...base.modelRetry, ...override.modelRetry } } : {}),
    ...(base.contextCompaction || override.contextCompaction ? { contextCompaction: { ...base.contextCompaction, ...override.contextCompaction } } : {}),
    ...(base.spending || override.spending ? { spending: { ...base.spending, ...override.spending, prices: { ...base.spending?.prices, ...override.spending?.prices } } } : {}),
    ...(override.outputStyle !== undefined ? { outputStyle: override.outputStyle } : base.outputStyle !== undefined ? { outputStyle: base.outputStyle } : {}),
  };
}

const claudeEnvironmentNames = new Set([
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'API_TIMEOUT_MS',
]);
const injectedEnvironment = new Map<string, string>();
const supportedSettingsEnvironmentNames = new Set([...claudeEnvironmentNames, 'CCPT_CA_FILE', 'NODE_EXTRA_CA_CERTS', 'AZURE_OPENAI_API_KEY', 'CCPT_MESSAGES_API_KEY', 'CCPT_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']);

function settingsEnvironment(settings: Record<string, unknown>): Record<string, string> {
  if (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env)) return {};
  return Object.fromEntries(Object.entries(settings.env as Record<string, unknown>)
    .filter(([name, value]) => supportedSettingsEnvironmentNames.has(name) && typeof value === 'string' && value.length > 0)) as Record<string, string>;
}

function processClaudeEnvironment(): Record<string, string> {
  return Object.fromEntries([...claudeEnvironmentNames]
    .filter((name) => Boolean(process.env[name]))
    .map((name) => [name, process.env[name]!])) as Record<string, string>;
}

function applySettingsEnvironment(environment: Record<string, string>): void {
  for (const [name, previous] of [...injectedEnvironment]) {
    if (name in environment) continue;
    if (process.env[name] === previous) delete process.env[name];
    injectedEnvironment.delete(name);
  }
  for (const [name, value] of Object.entries(environment)) {
    const previous = injectedEnvironment.get(name);
    if (!process.env[name]?.trim() || process.env[name] === previous) {
      process.env[name] = value;
      injectedEnvironment.set(name, value);
    }
  }
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Convert Claude Code settings.json keys into the native runtime schema. */
export function normalizeClaudeCompatibleSettings(settings: Record<string, unknown>): Partial<PlatformConfig> {
  const { env: _env, permissions, model, autoUpdates: _autoUpdates, DISABLE_UPDATES: _disableUpdates, shell: _shell, ...native } = settings;
  const environment = settingsEnvironment(settings);
  const modelObject = model && typeof model === 'object' && !Array.isArray(model) ? model as Record<string, unknown> : {};
  const alias = typeof model === 'string' && model.trim() ? model.trim() : undefined;
  const aliasEnvironmentName = alias && ['haiku', 'sonnet', 'opus'].includes(alias.toLowerCase()) ? `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL` : undefined;
  const resolvedModel = aliasEnvironmentName ? environment[aliasEnvironmentName] ?? alias : alias;
  const availableModels = ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']
    .map((name) => environment[name]).filter((value): value is string => Boolean(value));
  const contextWindow = positiveInteger(environment.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const timeoutMs = positiveInteger(environment.API_TIMEOUT_MS);
  const anthropic = Boolean(environment.ANTHROPIC_BASE_URL);
  const rawPolicy = native.policy && typeof native.policy === 'object' && !Array.isArray(native.policy) ? native.policy as Record<string, unknown> : {};
  const rawRules = rawPolicy.permissionRules && typeof rawPolicy.permissionRules === 'object' && !Array.isArray(rawPolicy.permissionRules) ? rawPolicy.permissionRules as Record<string, unknown> : {};
  const compatibilityPermissions = permissions && typeof permissions === 'object' && !Array.isArray(permissions) ? permissions as Record<string, unknown> : {};
  const stringRules = (value: unknown): string[] | undefined => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : undefined;
  const allow = stringRules(compatibilityPermissions.allow);
  const deny = stringRules(compatibilityPermissions.deny);
  const rawNetwork = native.network && typeof native.network === 'object' && !Array.isArray(native.network) ? native.network as Record<string, unknown> : {};
  return {
    ...native,
    ...(timeoutMs || Object.keys(rawNetwork).length ? { network: { ...(timeoutMs ? { timeoutMs } : {}), ...rawNetwork } as PlatformConfig['network'] } : {}),
    model: {
      ...(environment.OPENAI_BASE_URL ? { provider: 'openai' as const, apiProtocol: 'responses' as const, baseUrl: environment.OPENAI_BASE_URL, apiKeyEnv: 'OPENAI_API_KEY' } : {}),
      ...(environment.OPENAI_MODEL ? { name: environment.OPENAI_MODEL } : {}),
      ...(anthropic ? { provider: 'anthropic' as const } : {}),
      ...(environment.ANTHROPIC_BASE_URL ? { baseUrl: environment.ANTHROPIC_BASE_URL } : {}),
      ...(resolvedModel ? { name: resolvedModel } : {}),
      ...(contextWindow ? { maxContextTokens: contextWindow } : {}),
      ...(availableModels.length ? { availableModels: [...new Set(availableModels)] } : {}),
      ...modelObject,
    } as PlatformConfig['model'],
    ...(allow || deny || Object.keys(rawPolicy).length ? {
      policy: {
        ...rawPolicy,
        permissionRules: { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}), ...rawRules },
      } as PlatformConfig['policy'],
    } : {}),
  };
}

function windowsManagedConfig(): Partial<PlatformConfig> {
  if (process.platform !== 'win32') return {};
  try {
    const output = execFileSync('reg', [
      'query',
      'HKLM\\Software\\Policies\\CCPT',
      '/v',
      'ManagedConfig',
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = output.match(/ManagedConfig\s+REG_SZ\s+(.+)$/m);
    if (!match?.[1]) return {};
    return JSON.parse(match[1].trim()) as Partial<PlatformConfig>;
  } catch {
    return {};
  }
}

function macManagedConfig(): Partial<PlatformConfig> {
  if (process.platform !== 'darwin') return {};
  const path = '/Library/Managed Preferences/com.ccpt.plist';
  if (!existsSync(path)) return {};
  try {
    const output = execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const preferences = JSON.parse(output) as { ManagedConfig?: string | Partial<PlatformConfig> };
    return typeof preferences.ManagedConfig === 'string' ? JSON.parse(preferences.ManagedConfig) as Partial<PlatformConfig> : preferences.ManagedConfig ?? {};
  } catch { return {}; }
}

function linuxManagedConfig(): Partial<PlatformConfig> {
  if (process.platform === 'win32' || process.platform === 'darwin') return {};
  const path = '/etc/ccpt/managed-settings.json';
  return existsSync(path) ? fileConfig(path) : {};
}

function fileConfig(path: string): Partial<PlatformConfig> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Partial<PlatformConfig>;
}

/** Field names only: never expose managed credential values in a settings panel. */
export function managedPermissionFields(): string[] {
  const sources = [process.env.CCPT_MANAGED_CONFIG ? fileConfig(resolve(process.env.CCPT_MANAGED_CONFIG)) : {}, macManagedConfig(), linuxManagedConfig(), windowsManagedConfig()];
  const fields = new Set<string>();
  for (const source of sources) for (const [key, value] of Object.entries(source.policy ?? {})) {
    if (key === 'permissionRules' && value && typeof value === 'object') for (const rule of Object.keys(value)) fields.add(`permissionRules.${rule}`);
    else fields.add(key);
  }
  return [...fields].sort();
}

/** Preference restore cannot override administrator-selected model fields. */
export function managedModelFields(): string[] {
  const sources = [process.env.CCPT_MANAGED_CONFIG ? fileConfig(resolve(process.env.CCPT_MANAGED_CONFIG)) : {}, macManagedConfig(), linuxManagedConfig(), windowsManagedConfig()];
  return [...new Set(sources.flatMap(source => Object.keys(source.model ?? {})))];
}

/** Worker snapshots retain CLI overrides, but never freeze administrator policy. */
export function applyManagedConfiguration(config: PlatformConfig): PlatformConfig {
  let result = config;
  if (process.env.CCPT_MANAGED_CONFIG) result = mergeConfig(result, fileConfig(resolve(process.env.CCPT_MANAGED_CONFIG)));
  result = mergeConfig(result, macManagedConfig());
  result = mergeConfig(result, linuxManagedConfig());
  return mergeConfig(result, windowsManagedConfig());
}

export function assertManagedPolicyPatch(config: PlatformConfig, patch: Record<string, unknown>, fields = managedPermissionFields()): void {
  for (const field of fields) {
    const [key, child] = field.split('.');
    const updated = child ? (patch[key!] as Record<string, unknown> | undefined)?.[child] : patch[key!];
    const policy = config.policy as unknown as Record<string, unknown>;
    const current = child ? (policy[key!] as Record<string, unknown> | undefined)?.[child] : policy[key!];
    if (updated !== undefined && JSON.stringify(updated) !== JSON.stringify(current)) throw new Error(`Managed policy ${field} is controlled by your administrator.`);
  }
}

let sessionTokenLimits: Partial<Pick<PlatformConfig['model'], 'maxContextTokens' | 'maxOutputTokens'>> = {};
let sessionOverrides: Partial<PlatformConfig> = {};
let strictSessionMcp = false;
/** CLI-only settings, applied before administrator policy and never written to settings.json. */
export function setSessionOverrides(overrides: Partial<PlatformConfig> = {}, strictMcp = false): void {
  sessionOverrides = structuredClone(overrides);
  strictSessionMcp = strictMcp;
}

/** CLI-only, process-local overrides. Managed configuration is still applied last. */
export function setSessionTokenLimits(limits: typeof sessionTokenLimits): void {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Token limits require positive whole numbers');
  sessionTokenLimits = { ...limits };
}

export async function loadConfig(cwd = process.cwd()): Promise<PlatformConfig> {
  const globalPath = join(homeStateDir(), 'settings.json');
  const projectPath = join(projectStateDir(cwd), 'settings.json');
  const managedPath = process.env.CCPT_MANAGED_CONFIG;
  await Promise.all([migrateSettingsFile(globalPath), migrateSettingsFile(projectPath)]);
  const [globalSettings, projectSettings] = await Promise.all([
    readJson<Record<string, unknown>>(globalPath, {}),
    readJson<Record<string, unknown>>(projectPath, {}),
  ]);
  applySettingsEnvironment({ ...settingsEnvironment(globalSettings), ...settingsEnvironment(projectSettings) });
  // Resolve on every reload, not module import. Explicit global/project/managed caFile wins.
  const environmentCa = process.env.CCPT_CA_FILE || process.env.NODE_EXTRA_CA_CERTS;
  const environmentDefaults = environmentCa ? mergeConfig(defaultConfig, { network: { caFile: environmentCa } as PlatformConfig['network'] }) : defaultConfig;
  let config = mergeConfig(environmentDefaults, normalizeClaudeCompatibleSettings(globalSettings));
  const normalizedProject = normalizeClaudeCompatibleSettings(projectSettings);
  // Older CCPT releases wrote the built-in Ollama placeholder into every
  // project. Do not let that stale value shadow a real user-level Claude
  // settings.json configuration.
  if (isLegacyPlaceholderModel(projectSettings) && containsModelSettings(globalSettings)) delete normalizedProject.model;
  config = mergeConfig(config, normalizedProject);
  if (Object.keys(settingsEnvironment(globalSettings)).length === 0 && Object.keys(settingsEnvironment(projectSettings)).length === 0 && !containsModelSettings(globalSettings) && !containsModelSettings(projectSettings)) {
    const openaiEnvironment = Object.fromEntries(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'].filter(name => Boolean(process.env[name])).map(name => [name, process.env[name]!]));
    config = mergeConfig(config, normalizeClaudeCompatibleSettings({ env: Object.keys(openaiEnvironment).length ? openaiEnvironment : processClaudeEnvironment() }));
  }
  config.model = { ...config.model, ...sessionTokenLimits };
  if (strictSessionMcp) config.mcpServers = {};
  config = mergeConfig(config, sessionOverrides);
  if (strictSessionMcp) config.strictMcpConfig = true;
  config = applyManagedConfiguration(config);
  if (config.policy.workspaceRoots.length === 0) config.policy.workspaceRoots = [resolve(cwd)];
  const workspace = resolve(cwd);
  const scopedDirectories = (kind: string, defaults: string[], configured: string[] | undefined): string[] => [...new Set([
    ...defaults,
    ...(configured ?? []).map((path) => resolve(workspace, path)),
  ].map((path) => resolve(path)))].map((path) => {
    const separator = process.platform === 'win32' ? '\\' : '/';
    if (path !== workspace && !path.startsWith(`${workspace}${separator}`)) throw new Error(`${kind} directory must stay inside the trusted workspace: ${path}`);
    return path;
  });
  const globalExtensions = normalizeClaudeCompatibleSettings(globalSettings);
  config.skillsDirectories = [...new Set([...scopedDirectories('Skill', [join(projectStateDir(workspace), 'skills')], sessionOverrides.skillsDirectories ?? normalizedProject.skillsDirectories), ...await approvedGlobalDirectories('skill', globalExtensions.skillsDirectories, workspace)])];
  config.agentsDirectories = [...new Set([...scopedDirectories('Agent', [join(projectStateDir(workspace), 'agents')], sessionOverrides.agentsDirectories ?? normalizedProject.agentsDirectories), ...await approvedGlobalDirectories('agent', globalExtensions.agentsDirectories, workspace)])];
  config.pluginDirectories = [...new Set([...scopedDirectories('Plugin', [join(projectStateDir(workspace), 'plugins'), join(projectStateDir(workspace), 'plugins-local')], sessionOverrides.pluginDirectories ?? normalizedProject.pluginDirectories), ...await approvedGlobalDirectories('plugin', globalExtensions.pluginDirectories, workspace)])];
  if (config.network.caFile === undefined) {
    const embedded = bundledCaFile();
    if (embedded) config.network.caFile = embedded;
  }
  validateConfig(config);
  if (config.network.caFile) config.network.caFile = resolve(cwd, config.network.caFile);
  return config;
}

function containsModelSettings(settings: Record<string, unknown>): boolean {
  if (typeof settings.model === 'string' || settings.model && typeof settings.model === 'object') return true;
  const environment = settingsEnvironment(settings);
  return ['OPENAI_BASE_URL', 'OPENAI_MODEL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL']
    .some((name) => Boolean(environment[name]));
}

function isLegacyPlaceholderModel(settings: Record<string, unknown>): boolean {
  if (!settings.model || typeof settings.model !== 'object' || Array.isArray(settings.model)) return false;
  const model = settings.model as Record<string, unknown>;
  return model.name === 'ccpt-model'
    && (model.provider === undefined || model.provider === 'compatible')
    && (model.baseUrl === undefined || model.baseUrl === 'http://127.0.0.1:11434/v1');
}

export async function modelConfigSource(cwd = process.cwd()): Promise<string> {
  const globalPath = join(homeStateDir(), 'settings.json');
  const projectPath = join(projectStateDir(cwd), 'settings.json');
  const project = await readJson<Record<string, unknown>>(projectPath, {});
  const global = await readJson<Record<string, unknown>>(globalPath, {});
  if (containsModelSettings(project) && !(isLegacyPlaceholderModel(project) && containsModelSettings(global))) return projectPath;
  if (containsModelSettings(global)) return globalPath;
  return process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ? 'process environment' : 'built-in defaults';
}

export function validateConfig(config: PlatformConfig): void {
  if(config.runtimeReplay!==undefined)validateRuntimeReplay(config.runtimeReplay);
  if(config.pluginRollout!==undefined)validatePluginRollout(config.pluginRollout);
  if(config.model.audioInputFormats!==undefined&&(!Array.isArray(config.model.audioInputFormats)||config.model.audioInputFormats.length>2||new Set(config.model.audioInputFormats).size!==config.model.audioInputFormats.length||config.model.audioInputFormats.some(f=>!['wav','mp3'].includes(f))))throw new Error('audioInputFormats supports explicit wav/mp3 only');
  if(config.recoveryRemote?.launcherDependencies!==undefined){const roots=config.recoveryRemote.launcherDependencies;if(config.recoveryRemote.transport!=='ssh-wrapper'||!Array.isArray(roots)||roots.length>16||roots.some(p=>typeof p!=='string'||!(/^(?:\/|[A-Za-z]:[\\/])/.test(p))||/[\x00-\x1f]/.test(p)))throw new Error('launcherDependencies requires explicit SSH transport and up to 16 absolute paths');}
  if(config.model.tokenizerVocabulary!==undefined)validateTokenizerVocabulary(config.model.tokenizerVocabulary);
  if(config.model.contextFraming!==undefined)contextFramingTokens(config.model,0,0);
  if(config.messageDisplay!==undefined){const p=config.messageDisplay;if(!p||Object.keys(p).some(key=>!['mode','linesPerBatch','maxBatches'].includes(key))||!['message','lines'].includes(p.mode)||p.linesPerBatch!==undefined&&(!Number.isSafeInteger(p.linesPerBatch)||p.linesPerBatch<1||p.linesPerBatch>100)||p.maxBatches!==undefined&&(!Number.isSafeInteger(p.maxBatches)||p.maxBatches<1||p.maxBatches>256))throw new Error('Invalid messageDisplay batching');}
  if(config.schedulerManagers!==undefined){const managers=config.schedulerManagers;if(!managers||typeof managers!=='object'||Array.isArray(managers)||Object.keys(managers).some(name=>!['systemctl','launchctl'].includes(name))||Object.values(managers).some(path=>typeof path!=='string'||path.length>8000||!(/^(?:\/|[A-Za-z]:[\\/])/.test(path))||/[\x00-\x1f\x7f]/.test(path)))throw new Error('schedulerManagers requires absolute systemctl/launchctl paths');}
  if(config.usePluginSets!==undefined&&typeof config.usePluginSets!=='boolean')throw new Error('usePluginSets must be boolean');
  if(config.model.tokenizer!==undefined&&!['cl100k_base','o200k_base'].includes(config.model.tokenizer))throw new Error('Unsupported model.tokenizer');
  if(config.pluginOverlays!==undefined&&(!config.pluginOverlays||Array.isArray(config.pluginOverlays)||typeof config.pluginOverlays!=='object'||Buffer.byteLength(JSON.stringify(config.pluginOverlays))>512000))throw new Error('Invalid pluginOverlays');
  if(config.policy.osSandbox!==undefined&&config.policy.osSandbox!=='linux-bubblewrap')throw new Error('Unsupported OS sandbox backend');
  for(const hook of config.hooks){
    if(!hook||!HOOK_EVENTS.includes(hook.event)||hook.type!==undefined&&!['command','http','prompt','agent'].includes(hook.type))throw new Error('Unsupported Hook event/type');
    if(hook.type==='http' ? typeof hook.url!=='string'||!hook.url : hook.type==='prompt'||hook.type==='agent' ? typeof hook.prompt!=='string'||!hook.prompt : typeof hook.command!=='string'||!hook.command)throw new Error('Hook requires command/url/prompt for its declared type');
    for(const name of ['matcher','if','statusMessage','source'] as const)if(hook[name]!==undefined&&typeof hook[name]!=='string')throw new Error(`Hook ${name} must be a string`);
    if(hook.once!==undefined&&typeof hook.once!=='boolean')throw new Error('Hook once must be boolean');
    for(const name of ['timeout','timeoutMs'] as const)if(hook[name]!==undefined&&(!Number.isFinite(hook[name])||hook[name]!<=0))throw new Error('Hook timeout must be positive');
    validateHookWatch(hook);
  }
  if(config.recoveryMaintenance!==undefined){const p=config.recoveryMaintenance;if(typeof p.enabled!=='boolean'||p.automatic!==undefined&&typeof p.automatic!=='boolean'||!Number.isSafeInteger(p.retentionDays)||p.retentionDays<1||p.retentionDays>3650||!Number.isSafeInteger(p.minKeep)||p.minKeep<1||p.minKeep>128||!Number.isSafeInteger(p.maxPrunePerRun)||p.maxPrunePerRun<1||p.maxPrunePerRun>32)throw new Error('Invalid recoveryMaintenance policy');}
  if(config.recoveryRemote!==undefined){const p=config.recoveryRemote;if(!p||typeof p.remote!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(p.remote)||typeof p.expectedUrl!=='string'||!p.expectedUrl||p.expectedUrl.length>2048||/[\r\n\0]/.test(p.expectedUrl)||p.transport!==undefined&&p.transport!=='ssh-wrapper')throw new Error('Invalid pinned recoveryRemote');}
  if(config.runtimeHistory&&(!['metadata','redacted'].includes(config.runtimeHistory.mode)||config.runtimeHistory.maxTextChars!==undefined&&(!Number.isSafeInteger(config.runtimeHistory.maxTextChars)||config.runtimeHistory.maxTextChars<1||config.runtimeHistory.maxTextChars>64000)))throw new Error('runtimeHistory requires metadata/redacted mode and maxTextChars 1–64000');
  if (config.model.credentialRef !== undefined && (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(config.model.credentialRef) || ['constructor', 'prototype', '__proto__'].includes(config.model.credentialRef))) throw new Error('Invalid model.credentialRef');
  if (config.model.credentialRef && config.model.apiKeyEnv) throw new Error('Set model.apiKeyEnv to an empty string when using credentialRef');
  if (config.model.credentialBackend !== undefined && !['windows-dpapi','macos-keychain','linux-secret-service'].includes(config.model.credentialBackend)) throw new Error('Invalid model credentialBackend');
  if (config.mcpCredentialBackend !== undefined && !['file','windows-dpapi','macos-keychain','linux-secret-service'].includes(config.mcpCredentialBackend)) throw new Error('Invalid mcpCredentialBackend');
  validateCompactionPolicy(config.contextCompaction);
  validateInputTokenCounting(config.model);
  validateSpending(config.spending);
  validateModelRetry(config.modelRetry);
  inlineAgentDefinitions(config);
  if (config.toolFilter != null && (!Array.isArray(config.toolFilter) || config.toolFilter.some((tool) => typeof tool !== 'string' || !/^[\w.:-]+$/.test(tool)))) throw new Error('toolFilter must contain exact tool names');
  if (config.strictMcpConfig !== undefined && typeof config.strictMcpConfig !== 'boolean') throw new Error('strictMcpConfig must be boolean');
  if (typeof config.model.name !== 'string' || !config.model.name.trim()) throw new Error('Model name / deployment must not be empty');
  if (config.marketplaceEnabled !== undefined && typeof config.marketplaceEnabled !== 'boolean') throw new Error('marketplaceEnabled must be a boolean');
  if (config.model.apiProtocol !== undefined && !['chat-completions', 'messages', 'responses'].includes(config.model.apiProtocol)) throw new Error('model.apiProtocol must be chat-completions, messages or responses');
  if (config.model.responsesTransport !== undefined && !['native', 'chat-completions'].includes(config.model.responsesTransport)) throw new Error('Invalid model.responsesTransport');
  if (config.model.responsesTransport === 'chat-completions' && (resolveModelProtocol(config.model) !== 'responses' || config.model.responsesStore || config.model.responsesTextFormat)) throw new Error('Chat bridge requires apiProtocol=responses, responsesStore=false and no Responses text.format; server storage/structured output are not emulated');
  // Blank destinations are allowed while editing a new connection, but mismatched
  // complete routes are rejected before persisting/sending a configured request.
  if (config.model.endpointUrl || config.model.baseUrl) resolveModelEndpoint(config.model);
  if (config.model.chatToolReasoning !== undefined && !['preserve', 'none', 'omit', 'responses-only'].includes(config.model.chatToolReasoning)) throw new Error('model.chatToolReasoning must be preserve, none, omit or responses-only');
  if (config.model.responsesStore !== undefined && typeof config.model.responsesStore !== 'boolean') throw new Error('model.responsesStore must be a boolean');
  const format = config.model.responsesTextFormat;
  if (format != null && (format.type !== 'json_schema' || typeof format.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(format.name) || !format.schema || typeof format.schema !== 'object' || Array.isArray(format.schema) || (format.strict !== undefined && typeof format.strict !== 'boolean'))) throw new Error('model.responsesTextFormat requires type=json_schema, name and a schema object');
  if (config.model.apiKeyEnv !== undefined && config.model.apiKeyEnv !== '' && !/^[A-Z_][A-Z0-9_]*$/i.test(config.model.apiKeyEnv)) throw new Error('model.apiKeyEnv must be an environment variable name, not a token');
  if (config.model.completionTokenField !== undefined && !['max_tokens', 'max_completion_tokens'].includes(config.model.completionTokenField)) throw new Error('Invalid completion token field');
  if (config.network.caFile !== undefined && typeof config.network.caFile !== 'string') throw new Error('network.caFile must be a certificate file path');
  if (config.model.apiKeyHeader !== undefined && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(config.model.apiKeyHeader)) throw new Error('Invalid model API key header');
  if (config.model.apiKeyPrefix !== undefined && /[\r\n]/.test(config.model.apiKeyPrefix)) throw new Error('Invalid model API key prefix');
  if (!['openai', 'compatible', 'anthropic'].includes(config.model.provider)) throw new Error(`Invalid model provider: ${config.model.provider}`);
  if (!['normal', 'acceptEdits', 'sandbox', 'restricted', 'bypass'].includes(config.policy.mode)) throw new Error(`Invalid permission mode: ${config.policy.mode}`);
  if (typeof config.vimMode !== 'boolean') throw new Error('vimMode must be a boolean');
  if (typeof config.coordinatorMode !== 'boolean') throw new Error('coordinatorMode must be a boolean');
  if (typeof config.model.thinkingEnabled !== 'boolean') throw new Error('model.thinkingEnabled must be a boolean');
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(config.model.reasoningEffort)) throw new Error('model.reasoningEffort must be low, medium, high, xhigh, or max');
  if (typeof config.model.fastMode !== 'boolean') throw new Error('model.fastMode must be a boolean');
  if (config.disabledSkills !== undefined && (!Array.isArray(config.disabledSkills) || config.disabledSkills.some((name) => typeof name !== 'string' || !name.trim()))) throw new Error('disabledSkills must contain non-empty skill names');
  if (config.skillModes !== undefined && (!config.skillModes || typeof config.skillModes !== 'object' || Array.isArray(config.skillModes) || Object.entries(config.skillModes).some(([name, mode]) => !name.trim() || !['auto', 'manual', 'disabled'].includes(mode)))) throw new Error('skillModes must map skill names to auto, manual, or disabled');
  if (config.skillOverrides !== undefined && (!config.skillOverrides || typeof config.skillOverrides !== 'object' || Array.isArray(config.skillOverrides) || Object.entries(config.skillOverrides).some(([name, mode]) => !name.trim() || !['on', 'name-only', 'user-invocable-only', 'off'].includes(mode)))) throw new Error('skillOverrides must map skill names to on, name-only, user-invocable-only, or off');
  if (config.disableBundledSkills !== undefined && typeof config.disableBundledSkills !== 'boolean') throw new Error('disableBundledSkills must be boolean');
  if (config.requirePluginLocks !== undefined && typeof config.requirePluginLocks !== 'boolean') throw new Error('requirePluginLocks must be boolean');
  validatePluginTrust(config);
  if (config.pluginLocks !== undefined && (!config.pluginLocks || typeof config.pluginLocks !== 'object' || Array.isArray(config.pluginLocks) || Object.entries(config.pluginLocks).some(([name, lock]) => !name.trim() || !lock || typeof lock.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(lock.version) || typeof lock.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(lock.digest)))) throw new Error('pluginLocks must contain a version and SHA-256 digest for each plugin');
  if (config.model.availableModels !== undefined && (!Array.isArray(config.model.availableModels) || config.model.availableModels.some((model) => typeof model !== 'string' || !model.trim()))) throw new Error('model.availableModels must contain non-empty model names');
  if (typeof config.remote.enabled !== 'boolean') throw new Error('remote.enabled must be a boolean');
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(config.remote.authTokenEnv)) throw new Error('remote.authTokenEnv must be an environment variable name');
  if (config.outputStyle !== undefined && (typeof config.outputStyle !== 'string' || !config.outputStyle.trim())) throw new Error('outputStyle must be a non-empty string');
  for (const [name, value] of Object.entries({
    'network.timeoutMs': config.network.timeoutMs,
    'remote.reconnectAttempts': config.remote.reconnectAttempts,
    'remote.reconnectDelayMs': config.remote.reconnectDelayMs,
    'remote.pingIntervalMs': config.remote.pingIntervalMs,
    'remote.maxAttachmentBytes': config.remote.maxAttachmentBytes,
    'model.maxContextTokens': config.model.maxContextTokens,
    'model.maxOutputTokens': config.model.maxOutputTokens,
    'policy.commandTimeoutMs': config.policy.commandTimeoutMs,
    'agents.maxConcurrent': config.agents.maxConcurrent,
    'agents.maxPerSession': config.agents.maxPerSession,
    'agents.maxTurns': config.agents.maxTurns,
    'agents.heartbeatTimeoutMs': config.agents.heartbeatTimeoutMs,
  })) if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  for (const behavior of ['allow', 'ask', 'deny'] as const) if (!Array.isArray(config.policy.permissionRules[behavior]) || config.policy.permissionRules[behavior].some((rule) => typeof rule !== 'string' || !rule.trim())) throw new Error(`policy.permissionRules.${behavior} must contain non-empty strings`);
  if (!Number.isInteger(config.agents.maxDepth) || config.agents.maxDepth < 0) throw new Error('agents.maxDepth must be a non-negative integer');
  if (!['manual', 'on-success', 'always'].includes(config.agents.worktreeCleanup)) throw new Error(`Invalid worktree cleanup policy: ${config.agents.worktreeCleanup}`);
  for (const value of [config.network.proxyUrl, config.remote.serverUrl, config.model.baseUrl, config.model.endpointUrl]) if (value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Network URLs must use HTTP(S)');
  }
  for (const host of config.network.allowedHosts) if (!/^(?:\*\.)?[a-zA-Z0-9.-]+$/.test(host)) throw new Error(`Invalid allowed network host: ${host}`);
  for (const header of Object.keys(config.model.headersFromEnvironment ?? {})) if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header)) throw new Error(`Invalid model header name: ${header}`);
  for (const [name, server] of Object.entries(config.lspServers)) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error(`Invalid LSP server name: ${name}`);
    if (!server.command || !server.languageId || server.extensions.length === 0) throw new Error(`LSP server ${name} requires command, languageId, and extensions`);
    for (const extension of server.extensions) if (!/^\.[a-zA-Z0-9.+-]+$/.test(extension)) throw new Error(`Invalid LSP extension for ${name}: ${extension}`);
  }
  for (const server of Object.values(config.mcpServers)) {
    if(server.samplingBudget!==undefined)validateMcpSamplingBudget(server.samplingBudget);
    if(server.operationRecovery!==undefined)validateOperationRecovery(server.operationRecovery);
    if (server.httpMode !== undefined && !['direct', 'streamable'].includes(server.httpMode)) throw new Error('MCP httpMode must be direct or streamable');
    if(server.resumePostSse!==undefined&&typeof server.resumePostSse!=='boolean')throw new Error('MCP resumePostSse must be boolean');
    if(server.elicitationOrigins!==undefined&&(!Array.isArray(server.elicitationOrigins)||server.elicitationOrigins.length>32||server.elicitationOrigins.some(origin=>{try{const url=new URL(origin);return url.protocol!=='https:'||origin!==url.origin||Boolean(url.username||url.password);}catch{return true;}})))throw new Error('MCP elicitationOrigins must be exact HTTPS origins');
    if (server.oauth !== undefined) {
      const oauth = server.oauth;
      if (!oauth || typeof oauth !== 'object' || Array.isArray(oauth)) throw new Error('MCP oauth must be an object');
      for (const key of ['issuer', 'metadataUrl', 'authorizationUrl', 'tokenUrl', 'deviceAuthorizationUrl', 'redirectUri'] as const) if (oauth[key] !== undefined) {
        const value = oauth[key]; if (typeof value !== 'string' || value.length > 16384) throw new Error(`Invalid MCP OAuth ${key}`);
        const url = new URL(value);
        if (url.username || url.password || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || (key === 'issuer' || key === 'redirectUri') && url.search) throw new Error(`Invalid MCP OAuth ${key}: use HTTPS or loopback without credentials/fragments`);
      }
      if (oauth.clientId !== undefined && (typeof oauth.clientId !== 'string' || !oauth.clientId || oauth.clientId.length > 2048 || /[\u0000-\u001f\u007f]/.test(oauth.clientId))) throw new Error('Invalid MCP OAuth clientId');
      if (oauth.scopes !== undefined && (!Array.isArray(oauth.scopes) || oauth.scopes.length > 100 || oauth.scopes.some(scope => typeof scope !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]{1,256}$/.test(scope)))) throw new Error('Invalid MCP OAuth scopes');
    }
  }
}

export async function initializeConfig(cwd = process.cwd()): Promise<string> {
  const path = join(projectStateDir(cwd), 'settings.json');
  if (existsSync(path)) return path;
  await writeJson(path, {
    settingsVersion: CURRENT_SETTINGS_VERSION,
    policy: { workspaceRoots: [resolve(cwd)] },
  });
  return path;
}
