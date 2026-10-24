import type { ShellTaskRecord } from '../types.js';
export const isTerminalShellTask = (task: ShellTaskRecord): boolean => ['completed', 'failed', 'cancelled'].includes(task.status);
export function assertShellTaskId(id: string): string { if (!/^shell_[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid shell task id: ${id}`); return id; }
