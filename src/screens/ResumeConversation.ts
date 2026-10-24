import type { SessionRecord } from '../types.js';
import { listSessions } from '../sessions.js';
export interface ResumeConversationRow { id: string; title: string; cwd: string; updatedAt: string; messages: number; parentId?: string }
export async function loadResumeConversationRows(query = ''): Promise<ResumeConversationRow[]> { const normalized = query.trim().toLowerCase(); return (await listSessions()).filter((session) => !normalized || `${session.title} ${session.cwd} ${session.id}`.toLowerCase().includes(normalized)).map(toResumeConversationRow); }
export function toResumeConversationRow(session: SessionRecord): ResumeConversationRow { return { id: session.id, title: session.title, cwd: session.cwd, updatedAt: session.updatedAt, messages: session.messages.length + (session.archivedMessages?.length ?? 0), ...(session.parentId ? { parentId: session.parentId } : {}) }; }
export function renderResumeConversationRow(row: ResumeConversationRow, selected = false): string { return `${selected ? '›' : ' '} ${row.title} · ${row.messages} messages · ${row.cwd}`; }
