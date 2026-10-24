import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const execution = new AsyncLocalStorage<AbortSignal>();
const boundary = new AsyncLocalStorage<()=>Promise<void>>();
export function withExecutionBoundary<T>(check:()=>Promise<void>,action:()=>T):T{return boundary.run(check,action);}
export async function assertExecutionBoundary():Promise<void>{assertExecutionActive();await boundary.getStore()?.();}
export function executionSignal(): AbortSignal | undefined { return execution.getStore(); }
export function withExecutionSignal<T>(signal: AbortSignal, action: () => T): T { return execution.run(signal, action); }
export function assertExecutionActive(): void { executionSignal()?.throwIfAborted(); }

/** Only accepts a child owned by this process, never a PID from persisted state. */
export function terminateOwnedProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => { child.kill(); });
    killer.on('exit', (code) => { if (code) child.kill(); });
  } else {
    // Commands using this helper are spawned in a dedicated process group.
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

/** Abort and timeouts terminate the owned command group; always dispose listeners. */
export function controlProcess(child: ChildProcess, timeoutMs: number, signal = executionSignal()): { dispose: () => void; error: () => Error | undefined } {
  let failure: Error | undefined;
  const stop = (error: Error): void => { if (failure) return; failure = error; terminateOwnedProcess(child); };
  const abort = (): void => stop(new Error('Execution cancelled'));
  const timer = setTimeout(() => stop(new Error(`Command timed out after ${timeoutMs} ms`)), timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return { error: () => failure, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
