import { runHooks } from '../hooks.js';
import type { ModelMessage, PlatformConfig } from '../types.js';
export interface StopHookResult { blockingErrors: ModelMessage[]; preventContinuation: boolean; additionalContext: string[] }
export async function handleStopHooks(config: PlatformConfig, cwd: string, payload: Record<string, unknown>, options: { taskCompleted?: boolean; teammateIdle?: boolean } = {}): Promise<StopHookResult> {
  const events = options.taskCompleted ? ['TaskCompleted'] as const : options.teammateIdle ? ['TeammateIdle'] as const : ['Stop'] as const;
  const additionalContext: string[] = [];
  try { for (const event of events) additionalContext.push(...(await runHooks(config, event, payload, cwd)).additionalContext); return { blockingErrors: [], preventContinuation: false, additionalContext }; }
  catch (error) { return { blockingErrors: [{ role: 'user', content: `Stop hook blocked continuation: ${error instanceof Error ? error.message : String(error)}` }], preventContinuation: true, additionalContext }; }
}
