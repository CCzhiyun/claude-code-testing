import { spawnAgent, continueAgent } from './agent.js';
import { assertSessionIdle, forkSession, loadSession } from './sessions.js';
import { listUsage, summarizeUsage } from './usage.js';
import { formatContextPressure } from './contextBudget.js';
import type { PlatformConfig, AgentRecord } from './types.js';
import type { RuntimeEvent } from './runtimeEvents.js';
import { sameSessionWorkspace } from './sessionRecovery.js';

export type PrintFormat = 'text' | 'json' | 'stream-json';
export interface PrintOptions { prompt: string; cwd: string; config: PlatformConfig; format: PrintFormat; role?: string; resume?: string; fork?: boolean; worktree?: boolean; instructions?: string; continueAgentId?: string; onAgent?: (id: string) => void }
export async function runPrint(options: PrintOptions): Promise<number> { return (await runPrintTurn(options)).code; }
export async function runPrintTurn(options: PrintOptions): Promise<{ code: number; agent: AgentRecord }> {
  if (options.fork && !options.resume) throw new Error('--fork-session requires --resume <session-id>');
  let sessionId = options.resume;
  if (sessionId) {
    const source = await loadSession(sessionId);
    if (!sameSessionWorkspace(source.cwd, options.cwd)) throw new Error('Resumed session belongs to another workspace; set --cwd explicitly');
    await assertSessionIdle(sessionId);
    if (options.fork) sessionId = (await forkSession(sessionId)).id;
  }
  const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const onEvent = (event: RuntimeEvent): void => {
      options.onAgent?.(event.agentId);
      if (options.format === 'stream-json') write({ type: 'runtime', schema_version: 1, event });
      else if (options.format === 'text' && event.type === 'context_pressure') process.stderr.write(`${formatContextPressure(event.notice)}\n`);
      else if (options.format === 'text' && event.type === 'model_retry') process.stderr.write(`${event.notice.reason}; retry in ${Math.ceil(event.notice.delayMs / 1000)}s\n`);
  };
  const agent = options.continueAgentId
    ? await continueAgent(options.continueAgentId, options.prompt, { config: options.config, onEvent })
    : await spawnAgent({ goal: options.prompt, cwd: options.cwd, config: options.config, ...(options.role ? { role: options.role } : {}), isolation: options.worktree ? 'worktree' : 'none', background: false,
      ...(sessionId ? { sessionId } : {}), ...(options.instructions ? { instructions: options.instructions } : {}), onEvent });
  const code = agent.status === 'completed' ? 0 : agent.status === 'waiting_for_input' ? 2 : 1;
  const usage = summarizeUsage((await listUsage({ sessionId: agent.sessionId })).filter(record => record.agentId === agent.id));
  const result = { type: 'result', schema_version: 1, agent_id: agent.id, session_id: agent.sessionId, status: agent.status, is_error: code !== 0, result: agent.result ?? '', error: agent.error ?? null, usage, resumable: !options.config.ephemeralSession };
  if (options.format === 'text') process.stdout.write(`${agent.displayResult ?? agent.result ?? agent.error ?? agent.status}\n`);
  else write(result);
  return { code, agent };
}

export async function readPrintInput(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Provide a prompt after --print or pipe UTF-8 text on stdin');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new Error('Piped prompt exceeds the 1 MiB limit');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
