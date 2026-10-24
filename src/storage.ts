import { mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const pendingWrites = new Map<string, Promise<void>>();

/** Sharing violations can briefly affect Windows reads/new temp files too, not just rename.
 * Retries are bounded and never replace an access failure with a fallback value. */
export async function retrySharingViolation<T>(operation: () => Promise<T>, platform = process.platform): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (platform !== 'win32' || attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(done => setTimeout(done, Math.min(160, 10 * 2 ** attempt)));
    }
  }
}

async function renameAtomic(temporary: string, path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 7) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(160, 10 * 2 ** attempt)));
    }
  }
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await retrySharingViolation(() => readFile(path, 'utf8'))) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  return atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteFile(path: string, value: string): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => { /* A failed predecessor must not poison later writes. */ }).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await retrySharingViolation(() => writeFile(temporary, value, { mode: 0o600 }));
      await renameAtomic(temporary, path);
    } finally {
      await retrySharingViolation(() => rm(temporary, { force: true }));
    }
  });
  pendingWrites.set(path, operation);
  try {
    await operation;
  } finally {
    if (pendingWrites.get(path) === operation) pendingWrites.delete(path);
  }
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

interface LockOwner { pid: number; token?: string; createdAt: string }

async function lockOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(await retrySharingViolation(() => readFile(path, 'utf8'))) as LockOwner;
    return Number.isSafeInteger(value?.pid) && value.pid > 0 ? value : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function ownerExited(owner: LockOwner): boolean {
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

async function reclaimExitedLock(path: string): Promise<void> {
  // Serialize reapers and reread ownership. Age never authorizes stealing a live
  // lock. Unknown/corrupt owners and permission-denied probes fail closed.
  const reaperPath = `${path}.reclaim`;
  let reaper: FileHandle;
  try { reaper = await open(reaperPath, 'wx', 0o600); }
  catch (error) { if (['EEXIST', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return; throw error; }
  try {
    let owner:LockOwner|undefined;
    try{owner=await lockOwner(path);}catch(error){
      // A competing Windows handle can temporarily deny reads. Unknown ownership
      // is never evidence of death: keep the lock and let the bounded caller wait.
      if(process.platform==='win32'&&['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))return;
      throw error;
    }
    if (owner && ownerExited(owner)) await rm(path, { force: true });
  } finally { await reaper.close(); await retrySharingViolation(()=>rm(reaperPath, { force: true })); }
}

export async function withFileLock<T>(path: string, operation: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  const token = randomUUID();
  let handle: FileHandle | undefined;
  while (!handle) {
    if (Date.now() - started >= timeoutMs) throw new Error(`Timed out acquiring state lock: ${path}`);
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
    } catch (error) {
      if (handle) { await handle.close(); await retrySharingViolation(()=>rm(path, { force: true })); throw error; }
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can report sharing violations as EPERM/EACCES for a competing wx open.
      // Still require an existing lock; never treat other access errors as permission grants.
      if (code !== 'EEXIST' && !(process.platform === 'win32' && ['EPERM','EACCES','EBUSY'].includes(code??''))) throw error;
      await reclaimExitedLock(path);
      if (Date.now() - started >= timeoutMs) throw new Error(`Timed out acquiring state lock: ${path}`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25 + Math.floor(Math.random() * 50)));
    }
  }
  try { return await operation(); }
  finally {
    await handle.close();
    if ((await lockOwner(path))?.token === token) await retrySharingViolation(()=>rm(path, { force: true }));
  }
}
