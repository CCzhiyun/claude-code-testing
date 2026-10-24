import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import {appendIntegrityAudit,auditIntegrityEnabled,auditDay,readIntegrityAudit} from './auditIntegrity.js';

export interface AuditEvent {
  event: string;
  actor?: string;
  sessionId?: string;
  outcome: 'allowed' | 'denied' | 'requested' | 'success' | 'failure';
  details?: Record<string, unknown>;
}

export async function audit(entry: AuditEvent): Promise<void> {
  if(auditIntegrityEnabled()){await appendIntegrityAudit(redactAuditValue({timestamp:new Date().toISOString(),...entry}));return;}
  const directory = join(homeStateDir(), 'audit');
  await mkdir(directory, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const line = JSON.stringify(redactAuditValue({ timestamp: new Date().toISOString(), ...entry }));
  await appendFile(join(directory, `${day}.jsonl`), `${line}\n`, { mode: 0o600 });
}

const sensitiveKey = /(?:content|secret|token|password|passwd|credential|authorization|cookie|private|api.?key)/i;

export function redactAuditValue(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    let output = value.slice(0, 20_000)
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
      .replace(/:\/\/[^/@\s]+@/g, '://[redacted]@');
    for (const [name, secret] of Object.entries(process.env)) {
      if (secret && secret.length >= 4 && sensitiveKey.test(name)) output = output.replaceAll(secret, '[redacted]');
    }
    return output;
  }
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => redactAuditValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redactAuditValue(item, name)]));
  }
  return value;
}

export async function readAudit(day = new Date().toISOString().slice(0, 10)): Promise<string> {
  auditDay(day);
  if(auditIntegrityEnabled())return readIntegrityAudit(day);
  try {
    return await readFile(join(homeStateDir(), 'audit', `${day}.jsonl`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
