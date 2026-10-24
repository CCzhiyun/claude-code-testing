import { join, resolve } from 'node:path';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { redactAuditValue } from './audit.js';

export interface PermissionDenial { timestamp: string; cwd: string; sessionId: string; tool: string; subject: string; reason: string; source: 'user' | 'policy' }
const historyPath = (): string => join(homeStateDir(), 'permission-denials.json');
export async function recordPermissionDenial(entry: Omit<PermissionDenial, 'timestamp'>, secrets: string[] = []): Promise<void> {
  const scrub = (value: string): string => {
    let result = String(redactAuditValue(value));
    for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[redacted]');
    return result.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 2000);
  };
  const record: PermissionDenial = { ...entry, cwd: resolve(entry.cwd), timestamp: new Date().toISOString(), subject: scrub(entry.subject), reason: scrub(entry.reason) };
  await withFileLock(`${historyPath()}.lock`, async () => {
    const records = await readJson<PermissionDenial[]>(historyPath(), []);
    await writeJson(historyPath(), [...records, record].slice(-200));
  });
}
export async function listPermissionDenials(cwd: string): Promise<PermissionDenial[]> {
  const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  return (await readJson<PermissionDenial[]>(historyPath(), [])).filter((entry) => normalize(entry.cwd) === normalize(cwd)).reverse();
}
