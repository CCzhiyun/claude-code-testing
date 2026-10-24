import type { TeamMessage } from '../types.js';
export class MailboxContext {
  private messages: TeamMessage[] = [];
  push(message: TeamMessage): void { if (!this.messages.some((item) => item.id === message.id)) this.messages.push(structuredClone(message)); }
  unread(agentId: string): TeamMessage[] { return this.messages.filter((item) => item.toAgentId === agentId && !item.read).map((item) => structuredClone(item)); }
  markRead(id: string): void { const message = this.messages.find((item) => item.id === id); if (message) message.read = true; }
}
