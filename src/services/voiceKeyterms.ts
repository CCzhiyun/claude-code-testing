import { basename } from 'node:path';
const GLOBAL_KEYTERMS = ['MCP', 'symlink', 'grep', 'regex', 'localhost', 'codebase', 'TypeScript', 'JSON', 'OAuth', 'webhook', 'gRPC', 'worktree'];
export function splitIdentifier(name: string): string[] { return name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[-_./\s]+/).map((word) => word.trim()).filter((word) => word.length > 2 && word.length <= 20); }
export async function getVoiceKeyterms(recentFiles?: ReadonlySet<string>, projectRoot = process.cwd()): Promise<string[]> { const terms = new Set(GLOBAL_KEYTERMS); terms.add(basename(projectRoot)); for (const file of recentFiles ?? []) { for (const word of splitIdentifier(basename(file).replace(/\.[^.]+$/, ''))) terms.add(word); if (terms.size >= 50) break; } return [...terms].slice(0, 50); }
