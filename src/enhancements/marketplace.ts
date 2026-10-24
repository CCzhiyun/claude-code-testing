import { createHash } from 'node:crypto';

export interface MarketplacePlugin { name: string; version: string; description: string; archiveUrl: string; sha256: string; tags: string[]; recommendedFor?: string[] }
export interface MarketplaceManifest { schema: 1; organization?: string; generatedAt: string; plugins: MarketplacePlugin[] }
export interface MarketplaceSource { name: string; url: string; private?: boolean; tokenEnv?: string; organization?: string }
export type MarketplaceFetcher = (url: string, headers: Record<string, string>) => Promise<string>;

function validateManifest(value: unknown): MarketplaceManifest {
  const manifest = value as MarketplaceManifest;
  if (manifest?.schema !== 1 || !Array.isArray(manifest.plugins)) throw new Error('Unsupported marketplace manifest');
  const names = new Set<string>();
  for (const plugin of manifest.plugins) {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(plugin.name) || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(plugin.version)) throw new Error(`Invalid marketplace plugin: ${plugin.name}`);
    if (!/^https:\/\//i.test(plugin.archiveUrl) || !/^[a-f0-9]{64}$/i.test(plugin.sha256)) throw new Error(`Unsafe marketplace artifact: ${plugin.name}`);
    const identity = `${plugin.name}@${plugin.version}`;
    if (names.has(identity)) throw new Error(`Duplicate marketplace plugin: ${identity}`);
    names.add(identity);
  }
  return manifest;
}

export class MarketplaceRegistry {
  #catalog = new Map<string, MarketplacePlugin & { source: string; organization?: string }>();
  constructor(readonly sources: readonly MarketplaceSource[]) {}

  async sync(fetcher: MarketplaceFetcher, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
    const next = new Map<string, MarketplacePlugin & { source: string; organization?: string }>();
    for (const source of this.sources) {
      if (!/^https:\/\//i.test(source.url)) throw new Error(`Marketplace source must use HTTPS: ${source.name}`);
      const token = source.tokenEnv ? environment[source.tokenEnv] : undefined;
      if (source.private && !token) throw new Error(`Private marketplace ${source.name} requires ${source.tokenEnv ?? 'a token'}`);
      const manifest = validateManifest(JSON.parse(await fetcher(source.url, token ? { authorization: `Bearer ${token}` } : {})));
      if (source.organization && manifest.organization !== source.organization) throw new Error(`Marketplace organization mismatch for ${source.name}`);
      for (const plugin of manifest.plugins) next.set(`${plugin.name}@${plugin.version}`, { ...plugin, source: source.name, ...(manifest.organization ? { organization: manifest.organization } : {}) });
    }
    this.#catalog = next;
  }

  list(): Array<MarketplacePlugin & { source: string; organization?: string }> { return [...this.#catalog.values()].sort((a, b) => a.name.localeCompare(b.name) || b.version.localeCompare(a.version)); }
  find(name: string, version?: string): (MarketplacePlugin & { source: string; organization?: string }) | undefined { return this.list().find((plugin) => plugin.name === name && (!version || plugin.version === version)); }
  recommend(context: { organization?: string; tags?: string[]; project?: string } = {}): Array<MarketplacePlugin & { source: string; organization?: string; score: number }> {
    const tags = new Set((context.tags ?? []).map((tag) => tag.toLowerCase()));
    return this.list().map((plugin) => ({ ...plugin, score: (context.organization && plugin.organization === context.organization ? 100 : 0) + plugin.tags.filter((tag) => tags.has(tag.toLowerCase())).length * 10 + (context.project && plugin.recommendedFor?.includes(context.project) ? 25 : 0) })).filter((plugin) => plugin.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }
}

export function verifyMarketplaceArchive(content: Uint8Array, expectedSha256: string): boolean { return createHash('sha256').update(content).digest('hex').toLowerCase() === expectedSha256.toLowerCase(); }
