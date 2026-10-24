import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { permissionSubject } from './utils/permissions/permissions.js';

interface PermissionGrant { version: 2; id: string; sessionId: string; tool: string; expiresAt: string; uses: number; effect: 'allow' | 'deny'; inputHash?: string }

const grantsPath = (): string => join(homeStateDir(), 'permission-approvals.json');
const grantId = (sessionId: string, tool: string, subject: string): string => createHash('sha256').update(`${sessionId}\n${tool}\n${subject}`).digest('hex').slice(0, 24);

export interface PermissionRequestPayload {
  type: 'permission_request';
  id: string;
  sessionId: string;
  tool: string;
  subject: string;
  input: Record<string, unknown>;
  reason: string;
  choices: ['allow_once', 'allow_session', 'deny'];
  preview?: string;
}

/** JSON object key ordering is irrelevant; arrays and argument boundaries are not. */
export function permissionInputHash(input: Record<string, unknown>): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

export function permissionRequestPayload(sessionId: string, tool: string, input: Record<string, unknown>, reason: string): PermissionRequestPayload {
  const subject = permissionSubject(tool, input);
  return { type: 'permission_request', id: `${grantId(sessionId, tool, subject)}-${permissionInputHash(input).slice(0, 16)}`, sessionId, tool, subject, input, reason, choices: ['allow_once', 'allow_session', 'deny'] };
}

async function storeGrant(request: Pick<PermissionRequestPayload, 'sessionId' | 'tool' | 'subject'>, ttlMs: number, uses: number, effect: 'allow' | 'deny', inputHash?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + Math.max(1_000, Math.min(ttlMs, 24 * 60 * 60_000))).toISOString();
  await withFileLock(`${grantsPath()}.lock`, async () => {
    const grants = await readJson<PermissionGrant[]>(grantsPath(), []);
    const active = grants.filter((item) => item.version === 2 && Date.parse(item.expiresAt) > Date.now() && item.id !== grantId(request.sessionId, request.tool, request.subject));
    // Never spread a request here: it contains raw file contents and possibly credentials.
    active.push({ version: 2, id: grantId(request.sessionId, request.tool, request.subject), sessionId: request.sessionId, tool: request.tool, expiresAt, uses, effect, ...(inputHash ? { inputHash } : {}) });
    await writeJson(grantsPath(), active.slice(-256));
  });
}

export async function grantPermissionOnce(request: Pick<PermissionRequestPayload, 'sessionId' | 'tool' | 'subject' | 'input'>, ttlMs = 5 * 60_000): Promise<void> {
  await storeGrant(request, ttlMs, 1, 'allow', permissionInputHash(request.input));
}

export async function grantPermissionForSession(request: Pick<PermissionRequestPayload, 'sessionId' | 'tool' | 'subject'>, ttlMs = 12 * 60 * 60_000): Promise<void> {
  await storeGrant(request, ttlMs, 10_000, 'allow');
}

export async function denyPermissionForSession(request: Pick<PermissionRequestPayload, 'sessionId' | 'tool' | 'subject'>): Promise<void> {
  await storeGrant(request, 12 * 60 * 60_000, 10_000, 'deny');
}

export async function resetSessionPermissions(sessionId: string): Promise<void> {
  await withFileLock(`${grantsPath()}.lock`, async () => {
    const grants = await readJson<PermissionGrant[]>(grantsPath(), []);
    await writeJson(grantsPath(), grants.filter((grant) => grant.sessionId !== sessionId));
  });
}

export async function consumePermissionGrant(sessionId: string, tool: string, input: Record<string, unknown>): Promise<boolean> {
  return (await consumePermissionDecision(sessionId, tool, input)) === 'allow';
}

export async function consumePermissionDecision(sessionId: string, tool: string, input: Record<string, unknown>): Promise<'allow' | 'deny' | undefined> {
  const subject = permissionSubject(tool, input);
  return withFileLock(`${grantsPath()}.lock`, async () => {
    const now = Date.now();
    const grants = await readJson<PermissionGrant[]>(grantsPath(), []);
    const id = grantId(sessionId, tool, subject);
    const index = grants.findIndex((item) => item.version === 2 && item.id === id && Date.parse(item.expiresAt) > now && item.uses > 0 && (!item.inputHash || item.inputHash === permissionInputHash(input)));
    if (index < 0) {
      const active = grants.filter((item) => item.version === 2 && Date.parse(item.expiresAt) > now && item.uses > 0);
      if (active.length !== grants.length) await writeJson(grantsPath(), active);
      return undefined;
    }
    const matched = grants[index]!;
    if (matched.effect === 'deny') return 'deny';
    matched.uses -= 1;
    await writeJson(grantsPath(), grants.filter((item) => Date.parse(item.expiresAt) > now && item.uses > 0));
    return 'allow';
  });
}

export function parsePermissionRequest(value: string | undefined): PermissionRequestPayload | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PermissionRequestPayload>;
    if (parsed.type !== 'permission_request' || typeof parsed.sessionId !== 'string' || typeof parsed.tool !== 'string' || typeof parsed.subject !== 'string' || typeof parsed.reason !== 'string' || !parsed.input || typeof parsed.input !== 'object' || Array.isArray(parsed.input)) return undefined;
    const expected = permissionRequestPayload(parsed.sessionId, parsed.tool, parsed.input, parsed.reason);
    // Accept old IDs for pending requests created before the upgrade; grants still use new exact-input semantics.
    if (parsed.subject !== expected.subject || (parsed.id !== expected.id && parsed.id !== grantId(parsed.sessionId, parsed.tool, parsed.subject))) return undefined;
    return { ...expected, ...(typeof parsed.preview === 'string' ? { preview: parsed.preview } : {}) };
  } catch { return undefined; }
}
