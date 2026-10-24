import type { AgentStatus, TaskStatus } from '../types.js';
export function pillLabel(status: AgentStatus | TaskStatus): string { return ({ queued: 'Queued', working: 'Working', waiting_for_input: 'Needs input', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' } as Record<string, string>)[status] ?? status; }
