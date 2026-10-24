import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import type { PlatformConfig } from './types.js';
import { withoutRuntimeDelivery } from './runtimeOutbox.js';
import { withBudgetHome } from './spending.js';

/** Print-only isolation of local session state; not a promise of zero remote retention. */
export async function withEphemeralSession<T>(config: PlatformConfig, action: (config: PlatformConfig) => Promise<T>): Promise<T> {
  return withBudgetHome(() => ephemeralSession(config, action));
}
async function ephemeralSession<T>(config: PlatformConfig, action: (config: PlatformConfig) => Promise<T>): Promise<T> {
  if (config.hooks.some((hook) => 'async' in hook && hook.async)) throw new Error('--no-session-persistence cannot run asynchronous Hooks');
  const directory = await mkdtemp(join(tmpdir(), 'ccpt-ephemeral-'));
  const previous = process.env.CCPT_HOME;
  const ephemeral = structuredClone(config);
  ephemeral.ephemeralSession = true;
  ephemeral.model.responsesStore = false;
  process.env.CCPT_HOME = directory;
  try { return await withoutRuntimeDelivery(() => action(ephemeral)); }
  finally {
    if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous;
    // Only remove the exact fresh directory created above, never a user-provided path.
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('ccpt-ephemeral-')) throw new Error('Unsafe ephemeral state cleanup target');
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
