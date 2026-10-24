import { readFile } from 'node:fs/promises';
export async function getContainerId(): Promise<string | null> { if (process.platform !== 'linux') return null; try { const content = await readFile('/proc/self/mountinfo', 'utf8'); return content.match(/(?:\/docker\/containers\/|\/sandboxes\/)([0-9a-f]{64})/)?.[1] ?? null; } catch { return null; } }
export function permissionContextLog(mode: string, rules: Record<string, string[]>): Record<string, unknown> { return { mode, ruleCounts: Object.fromEntries(Object.entries(rules).map(([key, value]) => [key, value.length])) }; }
