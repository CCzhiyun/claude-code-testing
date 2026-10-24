import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
import { readJson, withFileLock, writeJson } from '../storage.js';
import type { SessionIndex, SessionInfo } from './types.js';

const path = () => join(homeStateDir(), 'remote-sessions.json');
const lockPath = () => join(homeStateDir(), 'locks', 'remote-sessions.lock');

export async function saveRemoteSession(session: SessionInfo): Promise<void> {
  await withFileLock(lockPath(), async () => {
    const index = await readJson<SessionIndex>(path(), { version: 1, sessions: {} });
    index.sessions[session.sessionId] = session;
    await writeJson(path(), index);
  });
}

export async function listRemoteSessions(): Promise<SessionInfo[]> {
  const index = await readJson<SessionIndex>(path(), { version: 1, sessions: {} });
  return Object.values(index.sessions).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function loadRemoteSession(sessionId: string): Promise<SessionInfo> {
  const session = (await readJson<SessionIndex>(path(), { version: 1, sessions: {} })).sessions[sessionId];
  if (!session) throw new Error(`Remote session not found: ${sessionId}`);
  return session;
}
