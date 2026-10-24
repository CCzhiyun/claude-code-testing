import type { PlatformConfig } from '../types.js';

export type ShellTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ShellTaskRecord {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  actor?: string;
  teamSessionId?: string;
  status: ShellTaskStatus;
  workerPid?: number;
  commandPid?: number;
  exitCode?: number;
  stdoutPath: string;
  stderrPath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ShellTaskRuntime {
  config: PlatformConfig;
}
