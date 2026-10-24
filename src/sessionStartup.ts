import { resolve } from 'node:path';
import { assertSessionIdle, listSessions, loadSession } from './sessions.js';

const workspaceKey = (cwd: string): string => process.platform === 'win32' ? resolve(cwd).toLowerCase() : resolve(cwd);
export class AmbiguousSessionNameError extends Error {
  constructor(readonly query: string) { super('More than one conversation has this name. Open /resume to choose a session, or use its session ID.'); }
}

/** Names never select an arbitrary duplicate or silently cross workspace boundaries. */
export async function resolveSessionReference(cwd: string, reference: string): Promise<string> {
  if (/^session_[a-f0-9]{16}$/.test(reference)) {
    const session = await loadSession(reference);
    if (workspaceKey(session.cwd) !== workspaceKey(cwd)) throw new Error('Resumed session belongs to another workspace');
    return session.id;
  }
  const matches = (await listSessions()).filter(session => workspaceKey(session.cwd) === workspaceKey(cwd) && session.title === reference);
  if (matches.length > 1) throw new AmbiguousSessionNameError(reference);
  if (!matches.length) throw new Error('No conversation found with that name in this workspace. Open /resume to search, or use a session ID.');
  return matches[0]!.id;
}

export async function startupSession(cwd: string, resume: string | undefined, latest: boolean, options: { allowActive?: boolean } = {}): Promise<string | undefined> {
  if (resume && latest) throw new Error('--resume and --continue cannot be combined');
  if (resume === undefined && !latest) return undefined;
  const id = resume !== undefined ? await resolveSessionReference(cwd, resume) : (await listSessions()).find(session => workspaceKey(session.cwd) === workspaceKey(cwd))?.id;
  if (!id) throw new Error('No previous conversation exists in this workspace');
  const session = await loadSession(id);
  if (workspaceKey(session.cwd) !== workspaceKey(cwd)) throw new Error('Resumed session belongs to another workspace');
  if (!options.allowActive || latest) await assertSessionIdle(id);
  return id;
}
