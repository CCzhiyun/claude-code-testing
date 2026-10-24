import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { McpServerConfig } from '../types.js';

type ApprovalRecord = { version: 1; approved: Record<string, string> };
const fingerprint = (config: McpServerConfig): string => createHash('sha256').update(JSON.stringify(config)).digest('hex');
export async function handleMcpjsonServerApprovals(root: string, servers: Record<string, McpServerConfig>, approve: (name: string, config: McpServerConfig) => Promise<boolean>): Promise<{ approved: string[]; denied: string[] }> {
  const directory = join(resolve(root), '.ccpt'); const path = join(directory, 'mcp-approvals.json'); let record: ApprovalRecord = { version: 1, approved: {} }; try { record = JSON.parse(await readFile(path, 'utf8')) as ApprovalRecord; } catch { /* First approval. */ }
  const approved: string[] = []; const denied: string[] = [];
  for (const [name, config] of Object.entries(servers)) { const digest = fingerprint(config); if (record.approved[name] === digest || await approve(name, structuredClone(config))) { record.approved[name] = digest; approved.push(name); } else denied.push(name); }
  await mkdir(directory, { recursive: true }); await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); return { approved, denied };
}
