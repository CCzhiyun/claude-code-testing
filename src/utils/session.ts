import { fingerprint } from './portable.js';

export type SessionRole = 'user' | 'assistant' | 'system' | 'tool';
export interface SessionMessage { id?: string; role: SessionRole; content: unknown; createdAt?: string; toolUseId?: string }
export interface SessionSummary { id: string; cwd: string; title?: string; createdAt: string; updatedAt: string; parentId?: string; messages: SessionMessage[]; tags?: string[] }

export function sessionTitle(session: Pick<SessionSummary, 'title' | 'messages'>, maximum = 60): string {
  if (session.title?.trim()) return [...session.title.trim()].slice(0, maximum).join('');
  const first = session.messages.find((message) => message.role === 'user');
  const value = typeof first?.content === 'string' ? first.content : 'Untitled session';
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, maximum).join('') || 'Untitled session';
}

export function sessionUrl(id: string, base = 'ccpt://session/'): string { return new URL(encodeURIComponent(id), base).toString(); }
export function sessionActivity(session: Pick<SessionSummary, 'createdAt' | 'updatedAt' | 'messages'>): { durationMs: number; turns: number; lastActiveAt: string } { return { durationMs: Math.max(0, Date.parse(session.updatedAt) - Date.parse(session.createdAt)), turns: session.messages.filter((message) => message.role === 'user').length, lastActiveAt: session.updatedAt }; }
export function normalizeSession(session: SessionSummary): SessionSummary { const createdAt = new Date(session.createdAt).toISOString(); const updatedAt = new Date(session.updatedAt).toISOString(); return { ...session, id: session.id.trim(), cwd: session.cwd, createdAt, updatedAt: updatedAt < createdAt ? createdAt : updatedAt, messages: [...session.messages], ...(session.tags ? { tags: [...new Set(session.tags.map((tag) => tag.trim()).filter(Boolean))] } : {}) }; }
export function searchSessions(sessions: readonly SessionSummary[], query: string, limit = 20): SessionSummary[] { const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean); return sessions.filter((session) => { const text = `${session.id} ${session.cwd} ${sessionTitle(session)} ${session.tags?.join(' ') ?? ''} ${session.messages.map((message) => typeof message.content === 'string' ? message.content : '').join(' ')}`.toLocaleLowerCase(); return terms.every((term) => text.includes(term)); }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(0, limit)); }
export function recoverConversation(messages: readonly SessionMessage[]): SessionMessage[] { const seen = new Set<string>(); const output: SessionMessage[] = []; for (const message of messages) { const id = message.id ?? fingerprint(message, 24); if (seen.has(id)) continue; seen.add(id); output.push({ ...message, id }); } return output; }
export function forkSession(session: SessionSummary, id: string, atMessage?: string, now = new Date().toISOString()): SessionSummary { const index = atMessage ? session.messages.findIndex((message) => message.id === atMessage) : -1; return { ...session, id, parentId: session.id, createdAt: now, updatedAt: now, title: `${sessionTitle(session)} (fork)`, messages: session.messages.slice(0, index < 0 ? undefined : index + 1).map((message) => ({ ...message })), ...(session.tags ? { tags: [...session.tags] } : {}) }; }

export function groupToolUses(messages: readonly SessionMessage[]): Array<{ toolUseId?: string; messages: SessionMessage[] }> { const groups: Array<{ toolUseId?: string; messages: SessionMessage[] }> = []; for (const message of messages) { const previous = groups.at(-1); if (previous && previous.toolUseId === message.toolUseId) previous.messages.push(message); else groups.push({ ...(message.toolUseId ? { toolUseId: message.toolUseId } : {}), messages: [message] }); } return groups; }
export function messageText(message: SessionMessage): string { if (typeof message.content === 'string') return message.content; if (Array.isArray(message.content)) return message.content.map((block) => typeof block === 'string' ? block : block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : '').filter(Boolean).join('\n'); return ''; }
export function isUserMessage(message: SessionMessage): boolean { return message.role === 'user'; }
export function isAssistantMessage(message: SessionMessage): boolean { return message.role === 'assistant'; }
export function tokenEstimate(value: string): number { let score = 0; for (const character of value) score += /[\u2e80-\u9fff\uf900-\ufaff]/u.test(character) ? 1 : /\s/.test(character) ? 0.1 : 0.25; return Math.max(1, Math.ceil(score)); }
export function contextBudget(messages: readonly SessionMessage[], maximum: number): { used: number; maximum: number; remaining: number; ratio: number } { const used = messages.reduce((sum, message) => sum + tokenEstimate(messageText(message)), 0); return { used, maximum, remaining: Math.max(0, maximum - used), ratio: maximum <= 0 ? 1 : Math.min(1, used / maximum) }; }

export type ControlMessage = { type: 'interrupt' | 'compact' | 'permission' | 'status'; requestId?: string; payload?: unknown };
export function parseControlMessage(value: unknown): ControlMessage | undefined { if (!value || typeof value !== 'object') return undefined; const input = value as Record<string, unknown>; if (!['interrupt', 'compact', 'permission', 'status'].includes(String(input.type))) return undefined; return { type: input.type as ControlMessage['type'], ...(typeof input.requestId === 'string' ? { requestId: input.requestId } : {}), ...('payload' in input ? { payload: input.payload } : {}) }; }
