import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homeStateDir } from './paths.js';
import { withFileLock, writeJson } from './storage.js';
import { readUtf8Text } from './textFiles.js';
import { scopedSession } from './sessionHistoryView.js';
import type { RuntimeEvent } from './runtimeEvents.js';
import { redactModelDiagnostic, withModelDiagnosticSecrets } from './modelErrors.js';

interface Row { sequence: number; at: string; type: string; agentId: string; turn?: number; status?: string; name?: string; isError?: boolean; durationMs?: number; inputTokens?: number; outputTokens?: number; text?:string; truncated?:boolean }
interface State { generation: string; sequence: number; items: Row[] }
const types = new Set(['agent_status', 'turn_started', 'usage_updated', 'tool_started', 'tool_completed', 'input_required', 'agent_completed', 'agent_failed', 'context_recovery', 'context_pressure', 'model_retry','assistant_message']);
const pending = new Map<string, Promise<void>>();
const failures = new Set<string>();
const backlog = new Map<string, number>();
function location(id: string) {
  if (!/^session_[a-f0-9]{16}$/.test(id)) throw new Error('Invalid runtime session ID');
  return join(homeStateDir(), 'runtime-history', `${id}.json`);
}
async function load(path: string): Promise<State> {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 8*1024*1024) throw new Error('Invalid runtime history file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;return { generation: randomBytes(8).toString('hex'), sequence: 0, items: [] }; }
  const state = JSON.parse(await readUtf8Text(path,8*1024*1024)) as State;
  if (!/^[a-f0-9]{16}$/.test(state.generation) || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Array.isArray(state.items) || state.items.length > 512) throw new Error('Invalid runtime history state');
  let previous = Math.max(0, state.sequence - state.items.length);
  for (const row of state.items) {
    if (!row || row.sequence !== ++previous || !types.has(row.type) || !/^agent_[a-f0-9]{16}$/.test(row.agentId) || !Number.isFinite(Date.parse(row.at))) throw new Error('Invalid runtime history record');
  }
  if (previous !== state.sequence) throw new Error('Invalid runtime history sequence');
  return state;
}
function projection(row: Row,includeText=false): Row {
  const out: Row = { sequence: row.sequence, at: row.at, type: row.type, agentId: row.agentId };
  for (const field of ['turn', 'durationMs', 'inputTokens', 'outputTokens'] as const) if (Number.isSafeInteger(row[field]) && Number(row[field]) >= 0) out[field] = row[field]!;
  if (row.status && ['queued','working','waiting_for_input','completed','failed','cancelled'].includes(row.status)) out.status = row.status;
  if (typeof row.name === 'string' && /^[\w:.-]{1,120}$/.test(row.name)) out.name = row.name;
  if (typeof row.isError === 'boolean') out.isError = row.isError;
  if(includeText&&typeof row.text==='string'){out.text=redactModelDiagnostic(row.text,64000,true);out.truncated=row.truncated===true;}
  return out;
}

/** Metadata by default; bounded redacted message/tool text only with explicit
 * opt-in. Never stores reasoning/provider payloads or runs for ephemeral workers. */
export function queueRuntimeHistory(event: RuntimeEvent,policy:{mode?:'metadata'|'redacted';maxTextChars?:number;secrets?:string[]}={}): void {
  if (!types.has(event.type) || !/^agent_[a-f0-9]{16}$/.test(event.agentId)) return;
  const path = location(event.sessionId);
  if ((backlog.get(path) ?? 0) >= 2048) { failures.add(path); return; }
  backlog.set(path, (backlog.get(path) ?? 0) + 1);
  const row = projection({ ...event, sequence: 0 });
  if(policy.mode==='redacted'){
    const raw=event.type==='assistant_message'?event.text:event.type==='tool_completed'?event.output:event.type==='tool_started'?JSON.stringify(event.input):event.type==='input_required'?event.question:undefined;
    if(raw!==undefined){const limit=Math.min(64000,Math.max(1,policy.maxTextChars??16000));row.text=withModelDiagnosticSecrets(policy.secrets??[],()=>redactModelDiagnostic(raw,limit,true));row.truncated=raw.length>limit;}
  }
  const operation = (pending.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Runtime history directory cannot be a link');
    await withFileLock(`${path}.lock`, async () => {
      const state = await load(path); row.sequence = ++state.sequence;
      state.items.push(row); state.items = state.items.slice(-512);
      let bytes=state.items.reduce((sum,item)=>sum+Buffer.byteLength(JSON.stringify(item))+2,0);while(bytes>7*1024*1024&&state.items.length){const first=state.items.shift()!;bytes-=Buffer.byteLength(JSON.stringify(first))+2;}
      await writeJson(path, state);
    });
  });
  pending.set(path, operation);
  void operation.catch(() => { failures.add(path); }).finally(() => { backlog.set(path, Math.max(0, (backlog.get(path) ?? 1) - 1)); if (pending.get(path) === operation) { pending.delete(path); backlog.delete(path); } });
}
export async function flushRuntimeHistory(): Promise<void> { await Promise.allSettled([...pending.values()]); }
export async function runtimeHistory(cwd: string, id: string, cursor?: string, limit = 100,options:{includeText?:boolean}={}) {
  await scopedSession(cwd, id);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Runtime page limit must be 1–200');
  const path = location(id); await pending.get(path)?.catch(() => {});
  const directory = join(homeStateDir(), 'runtime-history');
  try { if ((await lstat(directory)).isSymbolicLink()) throw new Error('Invalid runtime history directory'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const state = await load(path); let after = 0, reset = false;
  if (cursor !== undefined) {
    const match = /^([a-f0-9]{16}):(\d{1,16})$/.exec(cursor);
    if (!match) throw new Error('Invalid runtime cursor');
    after = Number(match[2]);
    if (!Number.isSafeInteger(after)) throw new Error('Invalid runtime cursor');
    reset = match[1] !== state.generation || after > state.sequence || after < state.sequence - state.items.length;
    if (reset) after = state.sequence - state.items.length;
  } else if (state.sequence > state.items.length) { reset = true; after = state.sequence - state.items.length; }
  const items = state.items.filter(row => row.sequence > after).slice(0, limit).map(row=>projection(row,options.includeText===true));
  const last = items.at(-1)?.sequence ?? after;
  return { sessionId: id, items, cursor: `${state.generation}:${last}`, hasMore: last < state.sequence, reset,
    retention: 512, metadataOnly: options.includeText!==true, complete: false, localWriteFailure: failures.has(path), permissionGranted: false,
    version: createHash('sha256').update(`${state.generation}:${state.sequence}`).digest('hex') };
}
