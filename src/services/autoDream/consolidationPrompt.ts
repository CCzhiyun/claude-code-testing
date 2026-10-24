import type { SessionRecord } from '../../types.js';

export function buildConsolidationPrompt(sessions: SessionRecord[], existingMemory = ''): string {
  const transcripts = sessions.map((session) => `<session id="${session.id}" title=${JSON.stringify(session.title)}>\n${session.summary ?? session.messages.map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content : '[structured content]'}`).join('\n')}\n</session>`).join('\n\n');
  return ['Consolidate durable, project-specific knowledge from these sessions.', 'Keep verified decisions, commands, conventions and unresolved risks. Exclude secrets and transient chatter.', existingMemory ? `<existing_memory>\n${existingMemory}\n</existing_memory>` : '', `<sessions>\n${transcripts}\n</sessions>`].filter(Boolean).join('\n\n');
}
