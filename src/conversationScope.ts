import type { AgentRecord, ModelMessage } from './types.js';

// Deliberately narrow: a greeting followed by a request must retain coding tools.
export function isGreetingOnly(text: string): boolean {
  const parts = text.trim().toLowerCase().split(/[\s\p{P}]+/u).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^(?:hello|hi|hey|你好|您好|嗨|哈喽|早上好|下午好|晚上好)$/u.test(part));
}

export function isGreetingTurn(
  record: Pick<AgentRecord, 'goal' | 'parentId' | 'planId' | 'instructions' | 'skills' | 'turnSkills'>,
  messages: ModelMessage[],
  profileSkills: string[] = [],
): boolean {
  if (!isGreetingOnly(record.goal) || record.parentId || record.planId || record.instructions || record.skills?.length || record.turnSkills?.length || profileSkills.length) return false;
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  if (Array.isArray(latestUser?.content) && latestUser.content.some((block) => block.type === 'image')) return false;
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  // A short answer to an active workflow question is not a fresh greeting.
  return !Array.isArray(assistant?.content) || !assistant.content.some((block) => block.type === 'tool_use' && ['ask_user', 'ask_user_question'].includes(block.name ?? ''));
}
