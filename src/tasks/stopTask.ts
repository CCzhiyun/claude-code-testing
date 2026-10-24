import { cancelAgent } from '../agent.js';
import { stopShellTask } from './LocalShellTask/LocalShellTask.js';
export async function stopTask(id: string): Promise<unknown> { if (id.startsWith('shell_')) return stopShellTask(id); if (id.startsWith('agent_')) return cancelAgent(id); throw new Error(`Unsupported stoppable task ID: ${id}`); }
