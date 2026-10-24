import type { HookEvent, PlatformConfig } from '../types.js';
import { runHooks, type HookExecutionResult } from '../hooks.js';

export interface LifecycleEmission {
  sequence: number;
  event: HookEvent;
  emittedAt: string;
  result: HookExecutionResult;
}

export class LifecycleDispatcher {
  #sequence = 0;
  readonly history: LifecycleEmission[] = [];

  constructor(private readonly config: PlatformConfig, private readonly cwd = process.cwd()) {}

  async emit(event: HookEvent, payload: Record<string, unknown>): Promise<LifecycleEmission> {
    const result = await runHooks(this.config, event, { ...payload, lifecycleSequence: this.#sequence + 1 }, this.cwd);
    const emission = { sequence: ++this.#sequence, event, emittedAt: new Date().toISOString(), result };
    this.history.push(emission);
    if (this.history.length > 1_000) this.history.shift();
    return emission;
  }

  async submitPrompt(prompt: string, sessionId: string): Promise<{ prompt: string; context: string[] }> {
    const submitted = await this.emit('UserPromptSubmit', { prompt, sessionId });
    const expanded = await this.emit('UserPromptExpansion', { prompt, sessionId, context: submitted.result.additionalContext });
    const updated = expanded.result.updatedInput?.prompt;
    return { prompt: typeof updated === 'string' ? updated : prompt, context: [...submitted.result.additionalContext, ...expanded.result.additionalContext] };
  }

  displayMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): Promise<LifecycleEmission> {
    return this.emit('MessageDisplay', { message, level });
  }

  async stop(payload: Record<string, unknown>, failure?: unknown): Promise<LifecycleEmission> {
    return this.emit(failure ? 'StopFailure' : 'Stop', { ...payload, ...(failure ? { error: failure instanceof Error ? failure.message : String(failure) } : {}) });
  }

  instructionsLoaded(paths: string[]): Promise<LifecycleEmission> { return this.emit('InstructionsLoaded', { paths }); }
  cwdChanged(previous: string, current: string): Promise<LifecycleEmission> { return this.emit('CwdChanged', { previous, current }); }
  directoryAdded(path: string): Promise<LifecycleEmission> { return this.emit('DirectoryAdded', { path }); }
  fileChanged(path: string, change: 'created' | 'modified' | 'deleted'): Promise<LifecycleEmission> { return this.emit('FileChanged', { path, change }); }
  teammateIdle(agentId: string): Promise<LifecycleEmission> { return this.emit('TeammateIdle', { agentId }); }
  elicitation(input: Record<string, unknown>): Promise<LifecycleEmission> { return this.emit('Elicitation', input); }
  elicitationResult(input: Record<string, unknown>): Promise<LifecycleEmission> { return this.emit('ElicitationResult', input); }
  sessionEnd(sessionId: string, reason: string): Promise<LifecycleEmission> { return this.emit('SessionEnd', { sessionId, reason }); }
}
