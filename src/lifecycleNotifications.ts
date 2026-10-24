import { audit } from './audit.js';
import { runHooks } from './hooks.js';
import type { PlatformConfig } from './types.js';

/** These are post-fact observations, never a rollback, approval or retry gate.
 * A failing observer must not turn a successful file write into a failed tool. */
export async function notifyLifecycle(config: PlatformConfig, cwd: string, event: 'FileChanged' | 'DirectoryAdded' | 'InstructionsLoaded' | 'CwdChanged', payload: Record<string, unknown>): Promise<string[]> {
  try { return (await runHooks(config, event, payload, cwd)).additionalContext; }
  catch (error) {
    await audit({ event: `lifecycle.${event}.observer_failed`, outcome: 'failure', details: { message: 'Observer failed after the action; no retry or rollback was requested.' } }).catch(() => {});
    return [`[${event} observer failed after the action. The action was not rolled back; do not repeat it solely because this observer failed.]`];
  }
}
