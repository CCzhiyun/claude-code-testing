import { resolve } from 'node:path';
import { readJson } from '../storage.js';
import { networkJson } from '../network.js';
import { ExternalSurfaceRegistry, type ExternalSurfaceAdapter } from '../enterprise.js';
import type { PlatformConfig } from '../types.js';

export type SurfaceKind = 'jetbrains' | 'desktop' | 'cloud' | 'browser' | 'computer-use' | 'scm' | 'identity' | 'runner';

export const surfaceCapabilities: Record<SurfaceKind, readonly string[]> = {
  jetbrains: ['open-file', 'selection', 'diagnostics', 'diff', 'terminal', 'agent-status'],
  desktop: ['session.create', 'session.list', 'session.resume', 'session.dispatch', 'terminal', 'file.open', 'diff', 'preview', 'side-chat', 'task.background', 'pr.monitor', 'connector.invoke', 'computer-use', 'ssh', 'schedule'],
  cloud: ['session.create', 'session.list', 'session.resume', 'session.share', 'session.archive', 'session.delete', 'repository.connect', 'repository.upload', 'teleport', 'diff', 'pr.fix', 'environment.isolate'],
  browser: ['navigate', 'inspect-dom', 'console', 'screenshot', 'record', 'click', 'type', 'select', 'extract', 'test', 'permissions'],
  'computer-use': ['screen.capture', 'screen.inspect', 'mouse', 'keyboard', 'application.approve', 'application.list', 'bug.reproduce'],
  scm: ['event.receive', 'mention', 'prompt', 'workflow.schedule', 'skill.run', 'oidc.exchange', 'github-enterprise', 'gitlab-ci'],
  identity: ['authenticate', 'sso', 'domain.manage', 'organization.manage', 'role.assign', 'policy.publish', 'mcp.govern', 'version.manage'],
  runner: ['environment.local', 'environment.container', 'environment.cloud', 'environment.self-hosted', 'runner.allocate', 'runner.release', 'credential.issue', 'identity.verify', 'hook.run', 'e2e.test'],
};

export interface SurfaceAdapterManifest {
  name: string;
  kind: SurfaceKind;
  endpoint: string;
  capabilities?: string[];
  tokenEnv?: string;
  healthPath?: string;
  invokePath?: string;
  headersFromEnvironment?: Record<string, string>;
}

export interface SurfaceManifestFile { adapters: SurfaceAdapterManifest[] }

function endpointUrl(base: string, path: string): string {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), normalized).href;
}

function validateManifest(value: SurfaceAdapterManifest): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value.name)) throw new Error(`Invalid surface adapter name: ${value.name}`);
  if (!(value.kind in surfaceCapabilities)) throw new Error(`Unsupported surface adapter kind: ${value.kind}`);
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) throw new Error(`Surface adapter ${value.name} must use HTTPS`);
  const allowed = new Set(surfaceCapabilities[value.kind]);
  for (const capability of value.capabilities ?? []) if (!allowed.has(capability)) throw new Error(`Capability ${capability} is invalid for ${value.kind}`);
  if (value.tokenEnv && !/^[A-Z_][A-Z0-9_]*$/.test(value.tokenEnv)) throw new Error(`Invalid credential environment variable for ${value.name}`);
}

export class HttpSurfaceAdapter implements ExternalSurfaceAdapter {
  readonly name: string;
  readonly capabilities: readonly string[];
  readonly #manifest: SurfaceAdapterManifest;
  readonly #network: PlatformConfig['network'];

  constructor(manifest: SurfaceAdapterManifest, network: PlatformConfig['network']) {
    validateManifest(manifest);
    this.#manifest = structuredClone(manifest);
    this.#network = network;
    this.name = manifest.name;
    this.capabilities = [...new Set(manifest.capabilities ?? surfaceCapabilities[manifest.kind])];
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-ccpt-surface-kind': this.#manifest.kind };
    if (this.#manifest.tokenEnv) {
      const token = process.env[this.#manifest.tokenEnv];
      if (!token) throw new Error(`Surface credential is not configured: ${this.#manifest.tokenEnv}`);
      headers.authorization = `Bearer ${token}`;
    }
    for (const [header, environmentName] of Object.entries(this.#manifest.headersFromEnvironment ?? {})) {
      const value = process.env[environmentName];
      if (!value) throw new Error(`Surface header environment variable is not configured: ${environmentName}`);
      headers[header] = value;
    }
    return headers;
  }

  async health(): Promise<{ ready: boolean; detail?: string }> {
    try {
      const response = await networkJson<{ ready?: boolean; detail?: string }>(endpointUrl(this.#manifest.endpoint, this.#manifest.healthPath ?? 'health'), { method: 'GET', headers: this.#headers() }, this.#network);
      if (response.status < 200 || response.status >= 300) return { ready: false, detail: `HTTP ${response.status}` };
      return { ready: response.value.ready !== false, ...(response.value.detail ? { detail: response.value.detail.slice(0, 500) } : {}) };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async invoke(action: string, input: unknown): Promise<unknown> {
    if (!this.capabilities.includes(action)) throw new Error(`Adapter ${this.name} does not support ${action}`);
    const response = await networkJson<{ result?: unknown; error?: string }>(endpointUrl(this.#manifest.endpoint, this.#manifest.invokePath ?? 'invoke'), { method: 'POST', headers: this.#headers(), body: JSON.stringify({ action, input }) }, this.#network);
    if (response.status < 200 || response.status >= 300 || response.value.error) throw new Error(`Surface invocation failed (${response.status}): ${response.value.error ?? response.text.slice(0, 500)}`);
    return response.value.result;
  }
}

export async function loadSurfaceRegistry(cwd: string, config: PlatformConfig, manifestPath = process.env.CCPT_SURFACE_MANIFEST): Promise<ExternalSurfaceRegistry> {
  const registry = new ExternalSurfaceRegistry();
  const path = resolve(manifestPath ?? resolve(cwd, '.ccpt', 'surfaces.json'));
  const file = await readJson<SurfaceManifestFile>(path, { adapters: [] });
  if (!Array.isArray(file.adapters) || file.adapters.length > 64) throw new Error('Surface manifest adapters must be an array of at most 64 entries');
  for (const manifest of file.adapters) registry.register(new HttpSurfaceAdapter(manifest, config.network));
  return registry;
}

export async function surfaceHealth(registry: ExternalSurfaceRegistry, name?: string): Promise<Array<{ name: string; ready: boolean; detail?: string }>> {
  const adapters = name ? registry.list().filter((item) => item.name === name) : registry.list();
  if (name && adapters.length === 0) throw new Error(`External surface adapter is not installed: ${name}`);
  return Promise.all(adapters.map(async (adapter) => {
    try { const health = await registry.health(adapter.name); return { name: adapter.name, ...health }; }
    catch (error) { return { name: adapter.name, ready: false, detail: error instanceof Error ? error.message : String(error) }; }
  }));
}
