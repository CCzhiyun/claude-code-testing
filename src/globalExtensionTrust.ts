import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
export type ExtensionKind = 'skill' | 'agent' | 'plugin';
interface Approval { kind: ExtensionKind; path: string; canonical: string; approvedAt: string }
const registry = () => join(homeStateDir(), 'extension-trust.json');
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
function kindCheck(kind: string): asserts kind is ExtensionKind { if (!['skill','agent','plugin'].includes(kind)) throw new Error('Extension kind must be skill, agent or plugin'); }
export async function listGlobalExtensionTrust(): Promise<Approval[]> {
  const rows = await readJson<Approval[]>(registry(), []);
  if (!Array.isArray(rows) || rows.length > 48 || rows.some(row => !row || !['skill','agent','plugin'].includes(row.kind) || !isAbsolute(row.path) || !isAbsolute(row.canonical) || !Number.isFinite(Date.parse(row.approvedAt)))) throw new Error('Invalid global extension trust registry; inspect locally');
  return rows;
}
export async function setGlobalExtensionTrust(path: string, kind: ExtensionKind, approved: boolean, confirmed: boolean) {
  kindCheck(kind);
  if (!confirmed || !isAbsolute(path)) throw new Error('Global extension trust requires an absolute path and --confirm');
  const absolute = resolve(path);
  let canonical = absolute;
  if (approved) {
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Trust a real directory, not a link');
    canonical = await realpath(absolute);
  }
  return withFileLock(`${registry()}.lock`, async () => {
    const rows = (await listGlobalExtensionTrust()).filter(row => row.kind !== kind || key(row.path) !== key(absolute));
    if (approved) rows.push({ kind, path: absolute, canonical, approvedAt: new Date().toISOString() });
    if (rows.length > 48) throw new Error('Global extension trust limit (48) reached');
    await writeJson(registry(), rows);
    return { kind, path: absolute, approved, settingsChanged: false };
  });
}
/** Only USER settings select global executable content. Project/CLI directory
 * overrides remain workspace-confined, even when another root is trusted. */
export async function approvedGlobalDirectories(kind: ExtensionKind, paths: unknown, workspace?: string): Promise<string[]> {
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || paths.length > 16 || paths.some(path => typeof path !== 'string' || !isAbsolute(path))) throw new Error('Global extension directories must contain at most 16 absolute paths');
  const approvals = await listGlobalExtensionTrust();
  const result: string[] = [];
  for (const path of paths as string[]) {
    const absolute = resolve(path), approval = approvals.find(row => row.kind === kind && key(row.path) === key(absolute));
    if (workspace && (key(absolute) === key(workspace) || key(absolute).startsWith(key(workspace) + sep))) { result.push(absolute); continue; }
    if (!approval) throw new Error(`Global ${kind} directory is not approved; use extensions trust or remove it from user settings: ${absolute}`);
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink() || key(await realpath(absolute)) !== key(approval.canonical)) throw new Error('Global extension root changed identity; review and trust it again');
    result.push(absolute);
  }
  return [...new Set(result)];
}
