import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from '../../paths.js';
import { loadShellTask, stopShellTask } from './LocalShellTask.js';
export async function killShellTasks(teamSessionId?: string): Promise<number> { let names: string[]; try { names = await readdir(join(homeStateDir(), 'shell-tasks')); } catch { return 0; } let stopped = 0; for (const name of names.filter((value) => /^shell_[a-f0-9]{16}\.json$/.test(value))) { const task = await loadShellTask(name.slice(0, -5)); if (teamSessionId && task.teamSessionId !== teamSessionId) continue; if (!['completed', 'failed', 'cancelled'].includes(task.status)) { await stopShellTask(task.id, teamSessionId); stopped += 1; } } return stopped; }
