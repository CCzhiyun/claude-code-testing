import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { sameSessionWorkspace } from './sessionRecovery.js';
import { redactModelDiagnostic } from './modelErrors.js';
import type { ModelMessage, SessionRecord } from './types.js';
import { readUtf8Text } from './textFiles.js';

/** A viewing boundary, not a resume/permission boundary. Never exposes thinking,
 * provider continuation payloads, tool arguments/results or base64 images. */
export async function scopedSession(cwd: string, id: string): Promise<SessionRecord> {
  if (!/^session_[a-f0-9]{16}$/.test(id)) throw new Error('Invalid session ID');
  const directory = join(homeStateDir(), 'sessions'), path = join(directory, `${id}.json`);
  for (const target of [directory, path]) {
    const info = await lstat(target);
    if (info.isSymbolicLink() || (target === path ? !info.isFile() || info.size > 32 * 1024 * 1024 : !info.isDirectory())) throw new Error('Invalid session history path or size');
  }
  const value = JSON.parse(await readUtf8Text(path, 32 * 1024 * 1024)) as SessionRecord;
  if (value.id !== id || typeof value.cwd !== 'string' || !sameSessionWorkspace(value.cwd, cwd)) throw new Error('Session belongs to another workspace');
  if (!Array.isArray(value.messages) || (value.archivedMessages !== undefined && !Array.isArray(value.archivedMessages))) throw new Error('Invalid session messages');
  return value;
}

export async function sessionHistory(cwd: string, id: string, options: { includeText?: boolean; cursor?: string; limit?: number; textLimit?:number } = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be 1–100');
  const textLimit=options.textLimit??2000;if(!Number.isSafeInteger(textLimit)||textLimit<1||textLimit>64000)throw new Error('History textLimit must be 1–64000');
  const session = await scopedSession(cwd, id), archived = session.archivedMessages ?? [];
  const messages = [...archived, ...session.messages];
  const version = createHash('sha256').update(JSON.stringify([archived, session.messages])).digest('hex');
  let end = messages.length;
  if (options.cursor !== undefined) {
    const match = /^([a-f0-9]{64}):(\d{1,8})$/.exec(options.cursor);
    if (!match || match[1] !== version) throw new Error('History changed or cursor invalid; reload the latest page');
    end = Number(match[2]);
    if (end > messages.length) throw new Error('History cursor out of range');
  }
  const start = Math.max(0, end - limit);
  const items = messages.slice(start, end).map((message: ModelMessage, offset) => {
    if (!message || !['user', 'assistant'].includes(message.role) || !(typeof message.content === 'string' || Array.isArray(message.content))) throw new Error('Invalid history message');
    const blocks = Array.isArray(message.content) ? message.content : [];
    const raw = typeof message.content === 'string' ? message.content : blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
    // Explicitly bounded, formatted preview; original context stays on disk.
    return { index: start + offset, role: message.role, archived: start + offset < archived.length,
      tools: blocks.filter(block => block?.type === 'tool_use' && typeof block.name === 'string').map(block => block.name!).filter(name => /^[\w:.-]{1,120}$/.test(name)).slice(0, 100),
      images: blocks.filter(block => block?.type === 'image').length,
      ...(options.includeText === true ? { text: redactModelDiagnostic(raw,textLimit,true), truncated: raw.length > textLimit } : {}) };
  });
  return { sessionId: id, title: redactModelDiagnostic(String(session.title ?? 'Session')), version, total: messages.length, items,
    nextCursor: start ? `${version}:${start}` : null, textIncluded: options.includeText === true,
    permissionGranted: false, toolReplay: false, previewOnly: true };
}
