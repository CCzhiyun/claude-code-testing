import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { projectStateDir } from './paths.js';
import { computePluginDigest, installPlugin, loadPluginAt, validatePlugin, verifyPluginLock, type PluginManifest } from './plugins.js';
import { loadConfig } from './config.js';
import { networkRequest } from './network.js';
import { OFFICIAL_MARKETPLACE_SNAPSHOT } from './marketplaceOfficialSnapshot.js';
import { OFFICIAL_PLUGIN_SEEDS } from './marketplaceOfficialPluginSeeds.js';
import { installedPluginPath, installTrustedPlugin, replaceInstalledPlugin, removeInstalledPlugin, safePluginStatePath, withPluginOperation } from './pluginHistory.js';
import { readJson, writeJson } from './storage.js';
import { verifyPluginSignature } from './pluginSignatures.js';
import type {SignedPluginOverlay} from './pluginOverlays.js';

interface MarketplaceReceipt { marketplace: string; source: unknown; scope: MarketplaceInstallScope; version: string; installedAt: string; artifactDigest?: string }
function receiptPath(cwd: string, name: string, scope: MarketplaceInstallScope): string {
  installedPluginPath(cwd, name, scope); // Validate identity before constructing a state path.
  return join(projectStateDir(cwd), 'plugin-installations', scope, `${name}.json`);
}
async function readMarketplaceReceipt(cwd: string, name: string, scope: MarketplaceInstallScope): Promise<MarketplaceReceipt | null> {
  const path = receiptPath(cwd, name, scope); await safePluginStatePath(cwd, path);
  const receipt = await readJson<MarketplaceReceipt | null>(path, null);
  const validate = (value: MarketplaceReceipt | null) => {
    if (value !== null && (typeof value !== 'object' || Array.isArray(value) || typeof value.marketplace !== 'string' || !validName(value.marketplace) || value.scope !== undefined && value.scope !== scope)) throw new Error('Invalid Marketplace installation receipt');
    return value;
  };
  if (receipt !== null) return validate(receipt);
  const legacy = join(installedPluginPath(cwd, name, scope), '.ccpt-marketplace.json'); await safePluginStatePath(cwd, legacy);
  return validate(await readJson<MarketplaceReceipt | null>(legacy, null));
}
async function recordSignedInstallation(cwd: string, view: MarketplacePluginView, scope: MarketplaceInstallScope, installed: string): Promise<void> {
  const plugin = await loadPluginAt(installed);
  const path = receiptPath(cwd, view.name, scope); await safePluginStatePath(cwd, path);
  if (!plugin.integrity) { await rm(path, { force: true }); return; }
  await writeJson(path, { marketplace: view.marketplace, source: view.source, scope, version: plugin.version, artifactDigest: await computePluginDigest(installed), installedAt: new Date().toISOString() });
}

export interface MarketplaceInstallationStatus {
  name: string; scope: MarketplaceInstallScope;
  state: 'verified-receipt' | 'untracked' | 'legacy-receipt' | 'stale-receipt' | 'invalid-receipt' | 'invalid-plugin' | 'untrusted';
  version?: string; marketplace?: string; signatureVerified?: boolean;
}
/** Read-only local attribution diagnostics; a receipt is never an execution grant. */
export async function inspectMarketplaceInstallations(cwd: string): Promise<MarketplaceInstallationStatus[]> {
  const config = await loadConfig(cwd), results: MarketplaceInstallationStatus[] = [];
  for (const scope of ['project', 'local'] as const) {
    const root = join(projectStateDir(cwd), scope === 'local' ? 'plugins-local' : 'plugins'); await safePluginStatePath(cwd, root);
    let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (entries.length > 512) throw new Error('Plugin attribution inspection exceeds 512 directory entries per scope');
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.'))) {
      const item: MarketplaceInstallationStatus = { name: entry.name, scope, state: 'invalid-plugin' }; results.push(item);
      let plugin;
      try { const path = installedPluginPath(cwd, entry.name, scope); await safePluginStatePath(cwd, path); plugin = await loadPluginAt(path); item.version = plugin.version; } catch { continue; }
      try { await verifyPluginLock(plugin, config); await verifyPluginSignature(plugin, config); item.signatureVerified = Boolean(plugin.integrity?.signature); } catch { item.state = 'untrusted'; continue; }
      let receipt; try { receipt = await readMarketplaceReceipt(cwd, entry.name, scope); } catch { item.state = 'invalid-receipt'; continue; }
      if (!receipt) { item.state = 'untracked'; continue; }
      item.marketplace = receipt.marketplace;
      if (!receipt.artifactDigest) item.state = 'legacy-receipt';
      else item.state = receipt.version === plugin.version && receipt.artifactDigest === await computePluginDigest(plugin.path) ? 'verified-receipt' : 'stale-receipt';
    }
  }
  return results;
}

/** Explicit repair using an already-present artifact. Never fetch, execute or guess provenance. */
export async function repairMarketplaceReceipt(cwd: string, identifier: string, confirm: boolean, scope: MarketplaceInstallScope = 'project'): Promise<MarketplaceInstallationStatus> {
  if (!confirm) throw new Error('Receipt repair requires explicit --confirm');
  await assertMarketplaceEnabled(cwd);
  const parts = identifier.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !validName(parts[1])) throw new Error('Choose an explicit plugin@marketplace for receipt repair');
  const [name, marketplace] = parts as [string, string];
  return withPluginOperation(cwd, name, scope, async () => {
    const config = await loadConfig(cwd), installed = installedPluginPath(cwd, name, scope), plugin = await loadPluginAt(installed);
    await verifyPluginLock(plugin, config); await verifyPluginSignature(plugin, config);
    if (!plugin.integrity) throw new Error('Receipt repair requires an integrity-protected artifact; inspect legacy metadata manually');
    const record = (await loadState(cwd)).marketplaces.find(item => item.name === marketplace);
    if (!record) throw new Error('Selected Marketplace is not configured');
    await validateManagedCatalogPaths(cwd, record);
    const catalog = await readManifest(record.catalogPath), view = catalog.plugins.find(item => item.name === name);
    if (!view || typeof view.source !== 'string' || isAbsolute(view.source) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(view.source)) throw new Error('Repair requires a local or cached relative artifact source; no download or command execution');
    if (['commands', 'skills', 'agents', 'hooks', 'mcpServers'].some(key => (view as unknown as Record<string, unknown>)[key] !== undefined)) throw new Error('Receipt repair cannot authorize Marketplace contribution overlays');
    const base = assertContained(record.root, resolve(record.root, catalog.metadata?.pluginRoot ?? '.'));
    const source = assertContained(base, resolve(base, view.source));
    let current = resolve(record.root);
    for (const part of [undefined, ...relative(current, source).split(sep).filter(Boolean)]) {
      if (part) current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Receipt repair must not traverse symlinks or junctions');
    }
    const candidate = await loadPluginAt(source);
    await verifyPluginLock(candidate, config); await verifyPluginSignature(candidate, config);
    if (candidate.name !== name || candidate.version !== plugin.version || view.version && view.version !== plugin.version || JSON.stringify(candidate.integrity) !== JSON.stringify(plugin.integrity) || await computePluginDigest(source) !== await computePluginDigest(installed)) throw new Error('Cached artifact does not exactly match installed identity/version/digest/signature envelope; no receipt changed');
    await recordSignedInstallation(cwd, { ...view, marketplace, marketplaceRoot: record.root, installed: true, enabled: true, installedScope: scope }, scope, installed);
    return { name, scope, state: 'verified-receipt', marketplace, version: plugin.version, signatureVerified: Boolean(plugin.integrity.signature) };
  });
}

const execFile = promisify(execFileCallback);
export async function assertMarketplaceEnabled(cwd: string): Promise<void> {
  if ((await loadConfig(cwd)).marketplaceEnabled === false) throw new Error('Marketplace is disabled in Settings. Existing local plugins remain available.');
}
export const OFFICIAL_MARKETPLACE_SOURCE = 'anthropics/claude-plugins-official';

export type ClaudePluginSource = string | {
  source: 'url' | 'git' | 'git-subdir' | 'github' | 'npm' | 'archive' | 'command';
  url?: string;
  repo?: string;
  path?: string;
  ref?: string;
  sha?: string;
  package?: string;
  version?: string;
  registry?: string;
  command?: string;
  timeout?: number;
  mode?: 'copy' | 'link';
};

export interface ClaudeMarketplacePlugin extends Omit<PluginManifest, 'commands' | 'skills' | 'agents' | 'hooks' | 'mcpServers'> {
  name: string;
  source: ClaudePluginSource;
  displayName?: string;
  category?: string;
  tags?: string[];
  /** Optional popularity metadata accepted from Marketplace catalog services. */
  installCount?: number;
  installs?: number | string;
  strict?: boolean;
  commands?: string | string[];
  skills?: string | string[];
  agents?: string | string[];
  hooks?: string | Record<string, unknown>;
  mcpServers?: string | Record<string, unknown>;
  /** Detached, independently verified overlay. Never patches publisher bytes. */
  signedOverlay?:SignedPluginOverlay;
}

export interface ClaudeMarketplaceManifest {
  $schema?: string;
  name: string;
  owner: { name: string; email?: string; url?: string };
  description?: string;
  version?: string;
  metadata?: { pluginRoot?: string; description?: string; version?: string };
  plugins: ClaudeMarketplacePlugin[];
  renames?: Record<string, string | null>;
}

export interface MarketplaceRecord {
  name: string;
  source: string;
  kind: 'local' | 'git' | 'url';
  root: string;
  catalogPath: string;
  catalogUrl?: string;
  addedAt: string;
  updatedAt: string;
  autoUpdate: boolean;
  lastAutoUpdateAt?: string;
  catalogOrigin?: 'network' | 'local' | 'bundled';
  error?: string;
}

interface MarketplaceState { version: 1; marketplaces: MarketplaceRecord[]; errors: Array<{ source: string; message: string; at: string }> }
export type MarketplaceInstallScope = 'project' | 'local';
export interface MarketplacePluginView extends ClaudeMarketplacePlugin { marketplace: string; marketplaceRoot: string; installed: boolean; enabled: boolean; installedScope?: MarketplaceInstallScope }

const OFFICIAL_SNAPSHOT_INSTALL_COUNTS: Readonly<Record<string, number>> = {
  'frontend-design': 1_200_000,
  'code-review': 464_900,
  context7: 437_600,
  'skill-creator': 413_300,
  'code-simplifier': 364_100,
  playwright: 342_200,
};

/** Normalize Marketplace popularity metadata such as 464900, 464.9K, or "1.2M installs". */
export function marketplacePopularity(plugin: Pick<ClaudeMarketplacePlugin, 'installCount' | 'installs'>): number {
  if (typeof plugin.installCount === 'number' && Number.isFinite(plugin.installCount)) return Math.max(0, plugin.installCount);
  if (typeof plugin.installs === 'number' && Number.isFinite(plugin.installs)) return Math.max(0, plugin.installs);
  if (typeof plugin.installs !== 'string') return 0;
  const match = plugin.installs.replaceAll(',', '').trim().match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/i);
  if (!match?.[1]) return 0;
  const multiplier = ({ k: 1_000, m: 1_000_000, b: 1_000_000_000 } as const)[match[2]?.toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return Math.max(0, Number(match[1]) * multiplier);
}

const statePath = (cwd: string): string => join(projectStateDir(cwd), 'marketplaces.json');
const cacheRoot = (cwd: string): string => join(projectStateDir(cwd), 'marketplaces');
const downloadsRoot = (cwd: string): string => join(projectStateDir(cwd), 'marketplace-downloads');
const pluginDirectory = installedPluginPath;
const safeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
const validName = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value);
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }

async function loadState(cwd: string): Promise<MarketplaceState> {
  await safePluginStatePath(cwd, statePath(cwd));
  try {
    const value = JSON.parse(await readFile(statePath(cwd), 'utf8')) as MarketplaceState;
    const marketplaces = Array.isArray(value.marketplaces) ? value.marketplaces.map((record) => ({
      ...record,
      autoUpdate: typeof record.autoUpdate === 'boolean' ? record.autoUpdate : record.source.replace(/[@#].*$/, '') === OFFICIAL_MARKETPLACE_SOURCE,
    })) : [];
    return { version: 1, marketplaces, errors: Array.isArray(value.errors) ? value.errors : [] };
  } catch { return { version: 1, marketplaces: [], errors: [] }; }
}

async function saveState(cwd: string, state: MarketplaceState): Promise<void> {
  await safePluginStatePath(cwd, statePath(cwd));
  await writeJson(statePath(cwd), state);
}

/** A saved remote catalog record is not authority to write/delete arbitrary paths. */
async function validateManagedCatalogPaths(cwd: string, record: MarketplaceRecord): Promise<void> {
  if (!['local', 'git', 'url'].includes(record.kind)) throw new Error('Invalid Marketplace source kind');
  if (record.kind === 'local') return;
  const base = resolve(cacheRoot(cwd)), root = resolve(record.root);
  assertContained(base, root);
  if (root === base) throw new Error('Marketplace operation must target one managed catalog, not the cache root');
  assertContained(root, record.catalogPath);
  await safePluginStatePath(cwd, root); await safePluginStatePath(cwd, record.catalogPath);
}

function assertContained(root: string, target: string): string {
  const base = resolve(root);
  const path = resolve(target);
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error(`Marketplace path escapes its root: ${relative(base, path)}`);
  return path;
}

function validateManifest(value: unknown, source: string): ClaudeMarketplaceManifest {
  if (!value || typeof value !== 'object') throw new Error(`Marketplace is not an object: ${source}`);
  const manifest = value as ClaudeMarketplaceManifest;
  if (!validName(manifest.name ?? '') || !manifest.owner || typeof manifest.owner.name !== 'string' || !Array.isArray(manifest.plugins)) throw new Error(`Invalid Claude marketplace manifest: ${source}`);
  const names = new Set<string>();
  for (const plugin of manifest.plugins) {
    if (!validName(plugin.name ?? '') || plugin.source === undefined) throw new Error(`Invalid marketplace plugin entry: ${plugin?.name ?? 'unknown'}`);
    if (names.has(plugin.name)) throw new Error(`Duplicate marketplace plugin: ${plugin.name}`);
    names.add(plugin.name);
  }
  return manifest;
}

async function readManifest(path: string): Promise<ClaudeMarketplaceManifest> { return validateManifest(JSON.parse(await readFile(path, 'utf8')), path); }

function githubUrl(source: string): string {
  const clean = source.replace(/@([^/]+)$/, '').replace(/#(.+)$/, '');
  return `https://github.com/${clean}.git`;
}

function githubRef(source: string): string | undefined {
  const hash = source.match(/#(.+)$/)?.[1];
  const at = source.match(/@([^/]+)$/)?.[1];
  return hash ?? at;
}

function isGithubShorthand(source: string): boolean { return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[@#][^/]+)?$/.test(source); }
function isGitSource(source: string): boolean {
  return isGithubShorthand(source)
    || /^https?:\/\/(?:github\.com|gitlab\.com)\/[^/]+\/.+?(?:\.git)?(?:[#@].*)?$/i.test(source)
    || /^(?:https?:\/\/|ssh:\/\/|git@).+(?:\.git(?:[#@].*)?|\/_git\/[^#@]+(?:[#@].*)?)$/i.test(source);
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const result = await execFile('git', args, { cwd, windowsHide: true, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
  return String(result.stdout ?? '').trim();
}

async function cloneRepository(source: string, target: string, ref?: string): Promise<void> {
  const url = isGithubShorthand(source) ? githubUrl(source) : source.replace(/#.*$/, '');
  const requestedRef = ref ?? (isGithubShorthand(source) ? githubRef(source) : source.match(/#(.+)$/)?.[1]);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.incoming-${process.pid}-${Date.now()}`;
  let failure: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await rm(temporary, { recursive: true, force: true });
    try {
      const args = ['-c', 'http.version=HTTP/1.1', 'clone', '--depth', '1', '--filter=blob:none', ...(requestedRef ? ['--branch', requestedRef] : []), '--', url, temporary];
      await runGit(args);
      if (await exists(target)) await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
      return;
    } catch (error) { failure = error; }
  }
  await rm(temporary, { recursive: true, force: true });
  throw failure;
}

async function fetchJson(cwd: string, url: string): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('Remote marketplace URLs must use HTTPS');
  const loaded = await loadConfig(cwd);
  const network = { ...loaded.network, timeoutMs: Math.min(15_000, loaded.network.timeoutMs) };
  let failure: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let current = target.href;
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        const response = await networkRequest(current, { headers: { accept: 'application/json', 'user-agent': 'ccpt-marketplace' } }, network);
        if (response.status >= 200 && response.status < 300) return response.text;
        const location = response.headers.location;
        if (response.status >= 300 && response.status < 400 && location && redirects < 5) { current = new URL(location, current).href; continue; }
        const error = new Error(`Marketplace request failed (${response.status}): ${current}`);
        if (response.status < 500) throw error;
        failure = error;
        break;
      }
    } catch (error) { failure = error; }
  }
  const detail = failure instanceof Error ? failure.message : String(failure ?? 'unknown network error');
  throw new Error(`Marketplace sync failed: ${detail}`);
}

async function sourceRecord(cwd: string, source: string): Promise<MarketplaceRecord> {
  const now = new Date().toISOString();
  const autoUpdate = source.replace(/[@#].*$/, '') === OFFICIAL_MARKETPLACE_SOURCE;
  if (source.startsWith('https://') && !isGitSource(source) && /(?:marketplace\.json)(?:\?.*)?$/i.test(source)) {
    const root = join(cacheRoot(cwd), `url-${safeName(new URL(source).hostname)}-${Date.now()}`);
    const catalogPath = join(root, '.claude-plugin', 'marketplace.json');
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, await fetchJson(cwd, source), 'utf8');
    const manifest = await readManifest(catalogPath);
    return { name: manifest.name, source, kind: 'url', root, catalogPath, catalogUrl: source, addedAt: now, updatedAt: now, autoUpdate, catalogOrigin: 'network' };
  }
  const local = source.startsWith('.') || isAbsolute(source);
  if (local) {
    const input = resolve(cwd, source);
    const info = await stat(input);
    const catalogPath = info.isDirectory() ? join(input, '.claude-plugin', 'marketplace.json') : input;
    const manifest = await readManifest(catalogPath);
    return { name: manifest.name, source: input, kind: 'local', root: info.isDirectory() ? input : dirname(dirname(input)), catalogPath, addedAt: now, updatedAt: now, autoUpdate: false, catalogOrigin: 'local' };
  }
  if (source.replace(/[@#].*$/, '') === OFFICIAL_MARKETPLACE_SOURCE) {
    const root = join(cacheRoot(cwd), 'claude-plugins-official');
    const catalogPath = join(root, '.claude-plugin', 'marketplace.json');
    const catalogUrl = 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, `${JSON.stringify(OFFICIAL_MARKETPLACE_SNAPSHOT, null, 2)}\n`, 'utf8');
    const manifest = await readManifest(catalogPath);
    return { name: manifest.name, source, kind: 'url', root, catalogPath, catalogUrl, addedAt: now, updatedAt: now, autoUpdate: true, catalogOrigin: 'bundled' };
  }
  if (!isGitSource(source)) throw new Error('Marketplace source must be owner/repo, a git URL, an HTTPS marketplace.json URL, or a local path');
  const root = join(cacheRoot(cwd), safeName(source.replace(/[@#].*$/, '')));
  try {
    await cloneRepository(source, root);
    const catalogPath = join(root, '.claude-plugin', 'marketplace.json');
    const manifest = await readManifest(catalogPath);
    return { name: manifest.name, source, kind: 'git', root, catalogPath, addedAt: now, updatedAt: now, autoUpdate };
  } catch (cloneError) {
    if (!isGithubShorthand(source)) throw cloneError;
    const repository = source.replace(/[@#].*$/, '');
    const requestedRef = githubRef(source);
    let body: string | undefined;
    let catalogUrl = '';
    for (const ref of requestedRef ? [requestedRef] : ['main', 'master']) {
      try {
        catalogUrl = `https://raw.githubusercontent.com/${repository}/${ref}/.claude-plugin/marketplace.json`;
        body = await fetchJson(cwd, catalogUrl);
        break;
      } catch { /* try the next conventional branch */ }
    }
    if (!body) throw cloneError;
    const catalogPath = join(root, '.claude-plugin', 'marketplace.json');
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, body, 'utf8');
    const manifest = await readManifest(catalogPath);
    return { name: manifest.name, source, kind: 'url', root, catalogPath, catalogUrl, addedAt: now, updatedAt: now, autoUpdate, catalogOrigin: 'network', error: 'Git checkout unavailable; using the read-only catalog fallback.' };
  }
}

export async function addMarketplace(cwd: string, source: string): Promise<MarketplaceRecord> {
  await assertMarketplaceEnabled(cwd);
  const state = await loadState(cwd);
  try {
    const record = await sourceRecord(cwd, source.trim());
    const previous = state.marketplaces.find((item) => item.name === record.name);
    if (previous && resolve(previous.root) !== resolve(record.root)) throw new Error(`Marketplace already exists: ${record.name}`);
    const saved = { ...record, addedAt: previous?.addedAt ?? record.addedAt, autoUpdate: previous?.autoUpdate ?? record.autoUpdate };
    state.marketplaces = [...state.marketplaces.filter((item) => item.name !== record.name), saved].sort((a, b) => a.name.localeCompare(b.name));
    await saveState(cwd, state);
    return saved;
  } catch (error) {
    state.errors.unshift({ source, message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
    state.errors = state.errors.slice(0, 100);
    await saveState(cwd, state);
    throw error;
  }
}

export async function ensureOfficialMarketplace(cwd: string): Promise<MarketplaceRecord> {
  await assertMarketplaceEnabled(cwd);
  const existing = (await loadState(cwd)).marketplaces.find((item) => item.name === 'claude-plugins-official');
  return existing ?? addMarketplace(cwd, OFFICIAL_MARKETPLACE_SOURCE);
}

export async function listMarketplaces(cwd: string): Promise<MarketplaceRecord[]> { return (await loadState(cwd)).marketplaces; }
export async function marketplaceErrors(cwd: string): Promise<MarketplaceState['errors']> { return (await loadState(cwd)).errors; }

export async function setMarketplaceAutoUpdate(cwd: string, name: string, enabled: boolean): Promise<MarketplaceRecord> {
  const state = await loadState(cwd);
  const record = state.marketplaces.find((item) => item.name === name);
  if (!record) throw new Error(`Marketplace not found: ${name}`);
  record.autoUpdate = enabled;
  await saveState(cwd, state);
  return record;
}

export async function refreshMarketplace(cwd: string, name?: string): Promise<MarketplaceRecord[]> {
  await assertMarketplaceEnabled(cwd);
  const state = await loadState(cwd);
  const targets = name ? state.marketplaces.filter((item) => item.name === name) : state.marketplaces;
  if (name && !targets.length) throw new Error(`Marketplace not found: ${name}`);
  for (const record of targets) {
    try {
      await validateManagedCatalogPaths(cwd, record);
      if (record.kind === 'git') {
        await runGit(['-c', 'http.version=HTTP/1.1', 'pull', '--ff-only'], record.root);
      } else if (record.kind === 'url') {
        await writeFile(record.catalogPath, await fetchJson(cwd, record.catalogUrl ?? record.source), 'utf8');
        record.catalogOrigin = 'network';
      }
      await readManifest(record.catalogPath);
      record.updatedAt = new Date().toISOString();
      delete record.error;
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      state.errors.unshift({ source: record.name, message: record.error, at: new Date().toISOString() });
    }
  }
  state.errors = state.errors.slice(0, 100);
  await saveState(cwd, state);
  return targets;
}

export async function removeMarketplace(cwd: string, name: string): Promise<void> {
  if ((await loadConfig(cwd)).policy.mode === 'restricted') throw new Error('Marketplace mutations are disabled in restricted mode');
  const state = await loadState(cwd);
  const record = state.marketplaces.find((item) => item.name === name);
  if (!record) throw new Error(`Marketplace not found: ${name}`);
  await validateManagedCatalogPaths(cwd, record);
  for (const scope of ['project', 'local'] as const) {
    const root = join(projectStateDir(cwd), scope === 'local' ? 'plugins-local' : 'plugins');
    await safePluginStatePath(cwd, root);
    let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.'))) {
        const plugin = entry.name, metadata = await readMarketplaceReceipt(cwd, plugin, scope);
        if (metadata?.marketplace === name) {
          await removeInstalledPlugin(cwd, plugin, scope);
          await rm(receiptPath(cwd, plugin, scope), { force: true });
        }
    }
  }
  if (record.kind !== 'local') await rm(record.root, { recursive: true, force: true });
  state.marketplaces = state.marketplaces.filter((item) => item.name !== name);
  await saveState(cwd, state);
}

export async function listMarketplacePlugins(cwd: string): Promise<MarketplacePluginView[]> {
  const state = await loadState(cwd);
  const output: MarketplacePluginView[] = [];
  for (const record of state.marketplaces) {
    try {
      const manifest = await readManifest(record.catalogPath);
      for (const plugin of manifest.plugins) {
        const installedScope: MarketplaceInstallScope | undefined = await exists(pluginDirectory(cwd, plugin.name, 'project')) ? 'project' : await exists(pluginDirectory(cwd, plugin.name, 'local')) ? 'local' : undefined;
        const installed = installedScope !== undefined;
        let enabled = installed;
        if (installedScope) { try { enabled = Boolean(await loadPluginAt(pluginDirectory(cwd, plugin.name, installedScope))); } catch { enabled = false; } }
        const snapshotInstallCount = manifest.name === 'claude-plugins-official' && plugin.installCount === undefined && plugin.installs === undefined
          ? OFFICIAL_SNAPSHOT_INSTALL_COUNTS[plugin.name]
          : undefined;
        output.push({ ...plugin, ...(snapshotInstallCount === undefined ? {} : { installCount: snapshotInstallCount }), marketplace: manifest.name, marketplaceRoot: record.root, installed, enabled, ...(installedScope ? { installedScope } : {}) });
      }
    } catch { /* Errors remain visible in the Errors tab. */ }
  }
  return output.sort((a, b) => Number(b.installed) - Number(a.installed) || marketplacePopularity(b) - marketplacePopularity(a) || a.name.localeCompare(b.name) || a.marketplace.localeCompare(b.marketplace));
}

async function clonePluginSource(cwd: string, entry: ClaudeMarketplacePlugin, source: Exclude<ClaudePluginSource, string>, allowCommand = false): Promise<string> {
  const root = join(downloadsRoot(cwd), `${safeName(entry.name)}-${Date.now()}`);
  if (source.source === 'npm') {
    if (!source.package) throw new Error(`npm source is missing package: ${entry.name}`);
    await mkdir(root, { recursive: true });
    const spec = `${source.package}${source.version ? `@${source.version}` : ''}`;
    await execFile('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', root, ...(source.registry ? ['--registry', source.registry] : []), spec], { windowsHide: true, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    return join(root, 'node_modules', ...source.package.split('/'));
  }
  if (source.source === 'archive') {
    if (!source.url || new URL(source.url).protocol !== 'https:') throw new Error(`Archive source must use HTTPS: ${entry.name}`);
    await mkdir(root, { recursive: true });
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'ccpt-marketplace' } });
    if (!response.ok) throw new Error(`Plugin archive request failed (${response.status})`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > 256 * 1024 * 1024) throw new Error('Plugin archive exceeds 256 MiB');
    const archive = join(root, 'plugin.zip');
    await writeFile(archive, content);
    const listing = String((await execFile('tar', ['-tf', archive], { windowsHide: true, timeout: 60_000, maxBuffer: 20 * 1024 * 1024 })).stdout ?? '').split(/\r?\n/).filter(Boolean);
    if (listing.length > 20_000 || listing.some((path) => isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]+/).includes('..') || path.includes('\0'))) throw new Error('Unsafe plugin archive paths');
    const extracted = join(root, 'extracted');
    await mkdir(extracted, { recursive: true });
    await execFile('tar', ['-xf', archive, '-C', extracted], { windowsHide: true, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    if (await exists(join(extracted, '.claude-plugin')) || await exists(join(extracted, 'skills')) || await exists(join(extracted, 'commands'))) return extracted;
    const children = (await readdir(extracted, { withFileTypes: true })).filter((item) => item.isDirectory());
    if (children.length === 1) return join(extracted, children[0]!.name);
    throw new Error('Archive does not contain a Claude plugin at its top level');
  }
  if (source.source === 'command') {
    if (!allowCommand) throw new Error('This plugin uses a command source. Open its details with Enter, review the command, then press Space again to approve it.');
    if (!source.command || source.command.length > 500 || !/^[\x20-\x7e]+$/.test(source.command) || / {4}/.test(source.command)) throw new Error('Unsafe marketplace command source');
    if (source.mode === 'link' && process.platform === 'win32') throw new Error('Command source link mode is not supported on Windows');
    const timeout = Math.max(1, Math.min(600, Math.trunc(source.timeout ?? 60))) * 1_000;
    const shell = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', source.command] : ['-lc', source.command];
    const result = await execFile(shell, args, { cwd: homedir(), windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
    const lines = String(result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1 || !isAbsolute(lines[0]!)) throw new Error('Command source must print exactly one absolute plugin directory');
    const path = resolve(lines[0]!);
    const workspace = resolve(cwd);
    if (process.platform === 'win32' && path.startsWith('\\\\') || workspace === path || workspace.startsWith(`${path}${sep}`)) throw new Error('Command source returned a forbidden directory');
    return path;
  }
  const repository = source.url ?? source.repo;
  if (!repository) throw new Error(`Git source is missing a URL: ${entry.name}`);
  await cloneRepository(repository, root, source.ref);
  if (source.sha) {
    const actual = await runGit(['rev-parse', 'HEAD'], root);
    if (actual.toLowerCase() !== source.sha.toLowerCase()) {
      await runGit(['-c', 'http.version=HTTP/1.1', 'fetch', '--depth', '1', 'origin', source.sha], root);
      await runGit(['checkout', '--detach', source.sha], root);
    }
  }
  return source.path ? assertContained(root, join(root, source.path)) : root;
}

async function sourceDirectory(cwd: string, view: MarketplacePluginView, allowCommand = false): Promise<string> {
  const seed = view.marketplace === 'claude-plugins-official' ? OFFICIAL_PLUGIN_SEEDS[view.name] : undefined;
  if (seed) {
    const target = join(downloadsRoot(cwd), 'official-seeds', safeName(view.name));
    if (await exists(join(target, '.claude-plugin', 'plugin.json'))) return target;
    const incoming = `${target}.incoming-${process.pid}-${Date.now()}`;
    await rm(incoming, { recursive: true, force: true });
    let total = 0;
    for (const [name, encoded] of Object.entries(seed)) {
      if (isAbsolute(name) || name.split(/[\\/]+/).includes('..') || name.includes('\0')) throw new Error(`Unsafe bundled Plugin path: ${name}`);
      const content = Buffer.from(encoded, 'base64');
      total += content.length;
      if (total > 256 * 1024 * 1024) throw new Error(`Bundled Plugin exceeds 256 MiB: ${view.name}`);
      const path = assertContained(incoming, join(incoming, ...name.split('/')));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    await mkdir(dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(incoming, target);
    return target;
  }
  if (typeof view.source === 'string') {
    const marketplace = (await listMarketplaces(cwd)).find((item) => item.name === view.marketplace);
    if (!marketplace) throw new Error(`Marketplace not found: ${view.marketplace}`);
    const manifest = await readManifest(marketplace.catalogPath);
    const base = manifest.metadata?.pluginRoot ? assertContained(marketplace.root, join(marketplace.root, manifest.metadata.pluginRoot)) : marketplace.root;
    const local = assertContained(base, join(base, view.source));
    if (await exists(local)) return local;
    if (isGitSource(marketplace.source)) {
      const checkout = join(downloadsRoot(cwd), `marketplace-${safeName(marketplace.name)}-${Date.now()}`);
      await cloneRepository(marketplace.source, checkout);
      const checkoutBase = manifest.metadata?.pluginRoot ? assertContained(checkout, join(checkout, manifest.metadata.pluginRoot)) : checkout;
      return assertContained(checkoutBase, join(checkoutBase, view.source));
    }
    throw new Error(`Plugin source is not present in the cached Marketplace: ${view.source}`);
  }
  return clonePluginSource(cwd, view, view.source, allowCommand);
}

async function materializeMarketplacePlugin(cwd: string, view: MarketplacePluginView, destination: string, scope: MarketplaceInstallScope, allowCommand = false): Promise<string> {
  if(view.signedOverlay)throw new Error('Signed Marketplace overlays require plugin-set stage-marketplace; switch artifacts and overlay receipts together');
  const source = await sourceDirectory(cwd, view, allowCommand);
  const checked = await validatePlugin(source);
  if (!checked.ok || !checked.plugin) throw new Error(checked.diagnostics.map((item) => item.message).join('; '));
  // Signed/hashed artifacts stay byte-for-byte intact. Catalog executable
  // overlays cannot be made trusted by borrowing the artifact's signature.
  if (checked.plugin.integrity) {
    if (checked.plugin.name !== view.name || view.version && view.version !== checked.plugin.version) throw new Error('Signed artifact identity/version differs from the Marketplace catalog');
    if (['commands', 'skills', 'agents', 'hooks', 'mcpServers'].some(key => (view as unknown as Record<string, unknown>)[key] !== undefined)) throw new Error('Marketplace contribution overlays cannot modify a signed artifact');
    await mkdir(destination, { recursive: true });
    return installPlugin(source, destination, view.name);
  }
  await mkdir(destination, { recursive: true });
  const installed = await installPlugin(source, destination, view.name);
  const originalManifest = checked.plugin.format === 'claude-code' && await exists(checked.plugin.manifestPath) ? JSON.parse(await readFile(checked.plugin.manifestPath, 'utf8')) as Record<string, unknown> : {};
  const effective: Record<string, unknown> = {
    ...originalManifest,
    name: view.name,
    ...(view.version ? { version: view.version } : checked.plugin.version !== '0.0.0' ? { version: checked.plugin.version } : {}),
    ...(view.description ? { description: view.description } : {}),
    ...(view.displayName ? { displayName: view.displayName } : {}),
    ...(view.commands ? { commands: view.commands } : {}),
    ...(view.skills ? { skills: view.skills } : {}),
    ...(view.agents ? { agents: view.agents } : {}),
    ...(view.hooks ? { hooks: view.hooks } : {}),
    ...(view.mcpServers ? { mcpServers: view.mcpServers } : {}),
  };
  await mkdir(join(installed, '.claude-plugin'), { recursive: true });
  await writeFile(join(installed, '.claude-plugin', 'plugin.json'), `${JSON.stringify(effective, null, 2)}\n`, 'utf8');
  await writeFile(join(installed, '.ccpt-marketplace.json'), `${JSON.stringify({ marketplace: view.marketplace, source: view.source, scope, version: effective.version ?? '0.0.0', installedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  return installed;
}

/** Explicit full generation; no individual artifact/receipt publication and no
 * settings mutation. The caller reviews and activates its digest separately. */
export async function stageMarketplacePluginSet(cwd:string,identifiers:string[],confirmed:boolean){
 if(!confirmed)throw new Error('Marketplace plugin-set staging requires --confirm');
 if(!Array.isArray(identifiers)||identifiers.length<1||identifiers.length>32||identifiers.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}@[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id)))throw new Error('Select 1–32 explicit plugin@marketplace identities');
 await assertMarketplaceEnabled(cwd);
 const config=await loadConfig(cwd);if(config.policy.mode==='restricted')throw new Error('Plugin staging disabled in restricted mode');
 if(!await(await import('./workspaceTrust.js')).isWorkspaceTrusted(cwd))throw new Error('Marketplace plugin-set staging requires explicit workspace trust');
 const views=await listMarketplacePlugins(cwd),sources:string[]=[],overlays:Record<string,SignedPluginOverlay>={};const names=new Set<string>();
 for(const id of identifiers){const [name,marketplace]=id.split('@'),view=views.find(item=>item.name===name&&item.marketplace===marketplace);if(!view||names.has(view.name.toLowerCase()))throw new Error('Missing or duplicate Marketplace artifact');names.add(view.name.toLowerCase());
  if(['commands','skills','agents','hooks','mcpServers','lspServers'].some(key=>(view as unknown as Record<string,unknown>)[key]!==undefined))throw new Error('Unsigned catalog contributions cannot be merged into a signed generation; use signedOverlay');
  const source=await sourceDirectory(cwd,view,false),plugin=await loadPluginAt(source);if(plugin.name!==view.name||view.version&&plugin.version!==view.version||!plugin.integrity?.signature)throw new Error('Marketplace generation requires matching independently signed artifact identity/version');
  await verifyPluginSignature(plugin,config);sources.push(source);if(view.signedOverlay)overlays[view.name]=view.signedOverlay;
 }
 return (await import('./pluginSets.js')).stagePluginSet(cwd,sources,true,overlays);
}

export async function installMarketplacePlugin(cwd: string, identifier: string, options: { allowCommand?: boolean; scope?: MarketplaceInstallScope } = {}): Promise<string> {
  await assertMarketplaceEnabled(cwd);
  const [name, requestedMarketplace] = identifier.split('@');
  if (!name) throw new Error('Plugin name is required');
  const marketplace = requestedMarketplace ? (await listMarketplaces(cwd)).find((item) => item.name === requestedMarketplace) : undefined;
  if (requestedMarketplace && marketplace?.catalogOrigin !== 'bundled') { try { await refreshMarketplace(cwd, requestedMarketplace); } catch { /* cached catalog remains installable offline */ } }
  const matches = (await listMarketplacePlugins(cwd)).filter((item) => item.name === name && (!requestedMarketplace || item.marketplace === requestedMarketplace));
  if (!matches.length) throw new Error(`Plugin not found in configured marketplaces: ${identifier}`);
  if (matches.length > 1 && !requestedMarketplace) throw new Error(`Plugin exists in multiple marketplaces; use ${name}@<marketplace>`);
  const view = matches[0]!;
  if (view.installed) throw new Error(`Plugin is already installed: ${view.name}`);
  const scope = options.scope ?? 'project';
  const transactions = join(projectStateDir(cwd), 'plugin-transactions'); await safePluginStatePath(cwd, transactions); await mkdir(transactions, { recursive: true });
  const temporary = await mkdtemp(join(transactions, 'marketplace-install-'));
  try {
    const staged = await materializeMarketplacePlugin(cwd, view, temporary, scope, options.allowCommand === true);
    const installed = await installTrustedPlugin(cwd, staged, scope);
    await recordSignedInstallation(cwd, view, scope, installed);
    return installed;
  } finally { await safePluginStatePath(cwd, temporary); await rm(temporary, { recursive: true, force: true }); }
}

export interface MarketplacePluginUpdateResult { name: string; marketplace: string; scope: MarketplaceInstallScope; path: string; previousVersion: string; version: string }

export async function updateMarketplacePlugin(cwd: string, identifier: string, options: { allowCommand?: boolean; refresh?: boolean } = {}): Promise<MarketplacePluginUpdateResult> {
  await assertMarketplaceEnabled(cwd);
  const [name, requestedMarketplace] = identifier.split('@');
  if (!name) throw new Error('Plugin name is required');
  const scope: MarketplaceInstallScope = await exists(pluginDirectory(cwd, name, 'project')) ? 'project' : 'local';
  const target = pluginDirectory(cwd, name, scope);
  await safePluginStatePath(cwd, target);
  if (!await exists(target)) throw new Error(`Plugin is not installed: ${name}`);
  const metadata = await readMarketplaceReceipt(cwd, name, scope);
  const marketplace = requestedMarketplace ?? metadata?.marketplace;
  if (!marketplace) throw new Error(`Plugin was not installed from a Marketplace: ${name}`);
  if (requestedMarketplace && metadata?.marketplace !== requestedMarketplace) throw new Error(`Plugin ${name} was installed from ${metadata?.marketplace}, not ${requestedMarketplace}`);
  if (options.refresh !== false) await refreshMarketplace(cwd, marketplace);
  const view = (await listMarketplacePlugins(cwd)).find((item) => item.name === name && item.marketplace === marketplace);
  if (!view) throw new Error(`Plugin not found after refreshing Marketplace: ${name}@${marketplace}`);
  const stagingParent = join(projectStateDir(cwd), 'marketplace-updates'); await safePluginStatePath(cwd, stagingParent); await mkdir(stagingParent, { recursive: true });
  const stagingRoot = await mkdtemp(join(stagingParent, `${safeName(name)}-`));
  try {
    const staged = await materializeMarketplacePlugin(cwd, view, stagingRoot, scope, options.allowCommand === true);
    const replaced = await replaceInstalledPlugin(cwd, name, scope, staged);
    await recordSignedInstallation(cwd, view, scope, target);
    return { name, marketplace, scope, path: target, previousVersion: replaced.previous.version, version: replaced.version };
  } finally {
    await safePluginStatePath(cwd, stagingRoot);
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export interface MarketplaceAutoUpdateResult { refreshed: string[]; updated: MarketplacePluginUpdateResult[]; errors: Array<{ source: string; message: string }> }

export async function autoUpdateMarketplaces(cwd: string): Promise<MarketplaceAutoUpdateResult> {
  const configuration=await loadConfig(cwd);
  if (configuration.marketplaceEnabled === false||configuration.pluginRollout||configuration.usePluginSets) return { refreshed: [], updated: [], errors: [] };
  if (process.env.DISABLE_AUTOUPDATER && process.env.FORCE_AUTOUPDATE_PLUGINS !== '1') return { refreshed: [], updated: [], errors: [] };
  const result: MarketplaceAutoUpdateResult = { refreshed: [], updated: [], errors: [] };
  for (const record of (await listMarketplaces(cwd)).filter((item) => item.autoUpdate)) {
    try {
      await refreshMarketplace(cwd, record.name);
      result.refreshed.push(record.name);
      const state = await loadState(cwd);
      const saved = state.marketplaces.find((item) => item.name === record.name);
      if (saved) { saved.lastAutoUpdateAt = new Date().toISOString(); await saveState(cwd, state); }
      const installed = (await listMarketplacePlugins(cwd)).filter((item) => item.marketplace === record.name && item.installed);
      for (const plugin of installed) {
        try {
          const current = await loadPluginAt(pluginDirectory(cwd, plugin.name, plugin.installedScope));
          if (plugin.version && current.version === plugin.version) continue;
          result.updated.push(await updateMarketplacePlugin(cwd, `${plugin.name}@${record.name}`, { refresh: false }));
        }
        catch (error) { result.errors.push({ source: `${plugin.name}@${record.name}`, message: error instanceof Error ? error.message : String(error) }); }
      }
    } catch (error) { result.errors.push({ source: record.name, message: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

export function scheduleMarketplaceAutoUpdate(cwd: string, onComplete?: (result: MarketplaceAutoUpdateResult) => void, maximumDelayMs = 600_000): NodeJS.Timeout | undefined {
  if (process.env.DISABLE_AUTOUPDATER && process.env.FORCE_AUTOUPDATE_PLUGINS !== '1') return undefined;
  const delay = Math.floor(Math.random() * Math.max(1, maximumDelayMs + 1));
  const timer = setTimeout(() => {
    void loadConfig(cwd).then((config) => config.marketplaceEnabled === false||config.pluginRollout||config.usePluginSets ? undefined : ensureOfficialMarketplace(cwd))
      .then(() => autoUpdateMarketplaces(cwd))
      .then((result) => onComplete?.(result))
      .catch((error) => onComplete?.({ refreshed: [], updated: [], errors: [{ source: 'claude-plugins-official', message: error instanceof Error ? error.message : String(error) }] }));
  }, delay);
  timer.unref();
  return timer;
}

export async function uninstallMarketplacePlugin(cwd: string, name: string, scope?: MarketplaceInstallScope): Promise<void> {
  name = name.split('@')[0] ?? name;
  const resolvedScope = scope ?? (await exists(pluginDirectory(cwd, name, 'project')) ? 'project' : 'local');
  const target = pluginDirectory(cwd, name, resolvedScope);
  if (!await exists(target)) throw new Error(`Plugin is not installed: ${name}`);
  await removeInstalledPlugin(cwd, name, resolvedScope);
  const receipt = receiptPath(cwd, name, resolvedScope); await safePluginStatePath(cwd, receipt); await rm(receipt, { force: true });
}

export async function marketplaceSummary(cwd: string): Promise<{ marketplaces: MarketplaceRecord[]; plugins: MarketplacePluginView[]; errors: MarketplaceState['errors'] }> {
  return { marketplaces: await listMarketplaces(cwd), plugins: await listMarketplacePlugins(cwd), errors: await marketplaceErrors(cwd) };
}
