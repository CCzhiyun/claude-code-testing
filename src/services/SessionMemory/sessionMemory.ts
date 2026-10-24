import type { ModelMessage } from '../../types.js';
import { messageText, sessionMemoryFingerprint } from './sessionMemoryUtils.js';
export interface SessionMemory { fingerprint: string; summary: string; decisions: string[]; updatedAt: string }
export function buildSessionMemory(messages: ModelMessage[], maxChars = 20_000): SessionMemory { const lines = messages.map((message) => `${message.role}: ${messageText(message).replace(/\s+/g, ' ').trim()}`).filter((line) => line.length > 6); const decisions = lines.filter((line) => /\b(decid|must|should|constraint|verify|通过|决定|必须|约束)\b/i.test(line)).slice(-20); return { fingerprint: sessionMemoryFingerprint(messages), summary: lines.join('\n').slice(-maxChars), decisions, updatedAt: new Date().toISOString() }; }
