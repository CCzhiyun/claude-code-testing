import { loadAgent, cancelAgent } from './agent.js';
import { loadShellTask, stopShellTask, getShellTaskOutput } from './tasks/LocalShellTask/LocalShellTask.js';
import { sameWorkspace } from './components/resourceDialog.js';

/** UI/CLI management actions may only affect records belonging to the current project. */
export async function projectAgent(cwd: string, id: string) {
  const agent = await loadAgent(id);
  if (!sameWorkspace(agent.cwd, cwd)) throw new Error('Agent belongs to another workspace. Open that project to manage it.');
  return agent;
}
export async function stopProjectTask(cwd: string, id: string) {
  if (id.startsWith('shell_')) {
    const task = await loadShellTask(id);
    if (!sameWorkspace(task.cwd, cwd)) throw new Error('Shell task belongs to another workspace.');
    return stopShellTask(id);
  }
  await projectAgent(cwd, id);
  return cancelAgent(id);
}
export async function projectShellOutput(cwd: string, id: string) {
  const task = await loadShellTask(id);
  if (!sameWorkspace(task.cwd, cwd)) throw new Error('Shell task belongs to another workspace.');
  return getShellTaskOutput(id);
}
