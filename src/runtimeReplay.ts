import {createHash,randomBytes} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homeStateDir} from './paths.js';
import {readJson,withFileLock,writeJson} from './storage.js';
import {scopedSession} from './sessionHistoryView.js';
import {redactModelDiagnostic,withModelDiagnosticSecrets} from './modelErrors.js';
import type {RuntimeEvent} from './runtimeEvents.js';

export type RuntimeReplayPolicy={maxBytes?:number;maxEvents?:number;maxTextChars?:number}&({mode:'metadata'|'redacted';acknowledgement?:never}|{mode:'verbatim';acknowledgement:'I_ACCEPT_LOCAL_PLAINTEXT_TRANSCRIPTS'});
interface Row {generation:string;sequence:number;source:string;at:string;type:string;agentId:string;turn?:number;text?:string;truncated?:boolean;mode:RuntimeReplayPolicy['mode'];prev:string;hash:string}
interface Index {format:1;generation:string;sequence:number;offset:number;hash:string;lastSource:string;lastStart:number}
const zero='0'.repeat(64),boot=randomBytes(16).toString('hex'),pending=new Map<string,Promise<void>>(),backlog=new Map<string,number>(),failed=new Set<string>(),marked=new Set<string>();
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const events=new Set(['agent_status','turn_started','context_recovery','context_pressure','model_retry','text_delta','display_message','assistant_message','usage_updated','tool_started','tool_completed','input_required','agent_completed','agent_failed']);
export function validateRuntimeReplay(p:RuntimeReplayPolicy):void{
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['mode','maxBytes','maxEvents','maxTextChars','acknowledgement'].includes(k))||!['metadata','redacted','verbatim'].includes(p.mode)||p.mode==='verbatim'&&p.acknowledgement!=='I_ACCEPT_LOCAL_PLAINTEXT_TRANSCRIPTS')throw new Error('runtimeReplay requires a capture mode; verbatim needs explicit local-plaintext acknowledgement');
 for(const [key,min,max]of [['maxBytes',4096,64*1024*1024],['maxEvents',1,200000],['maxTextChars',1,1000000]] as const){const n=p[key];if(n!==undefined&&(!Number.isSafeInteger(n)||n<min||n>max))throw new Error(`Invalid runtimeReplay.${key}`);}
}
function location(id:string){if(!/^session_[a-f0-9]{16}$/.test(id))throw new Error('Invalid replay session');return join(homeStateDir(),'runtime-replay',id+'.jsonl');}
async function paths(file:string){for(const p of [homeStateDir(),dirname(file),file,file+'.index.json',file+'.gap.json'])try{const s=await lstat(p);if(s.isSymbolicLink()||p===file&&(!s.isFile()||s.size>64*1024*1024)||p.endsWith('.json')&&(!s.isFile()||s.size>16000))throw new Error('Invalid replay path/type/size');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
function row(raw:string,generation:string,sequence:number,prev:string):Row{const r=JSON.parse(raw) as Row;const{hash,...body}=r;if(!r||r.generation!==generation||r.sequence!==sequence||r.prev!==prev||!/^[a-f0-9]{64}$/.test(hash)||digest(body)!==hash||!events.has(r.type)||!/^[a-f0-9]{64}$/.test(r.source)||!/^agent_[a-f0-9]{16}$/.test(r.agentId)||!Number.isFinite(Date.parse(r.at))||!['metadata','redacted','verbatim'].includes(r.mode))throw new Error('Replay chain changed or contains an invalid event');return r;}
async function range(file:string,start:number,end:number){const handle=await open(file,'r');try{const b=Buffer.alloc(end-start);const{bytesRead}=await handle.read(b,0,b.length,start);if(bytesRead!==b.length)throw new Error('Replay changed during read');return b.toString('utf8');}finally{await handle.close();}}
async function index(file:string):Promise<Index>{
 await paths(file);let size=0;try{size=(await lstat(file)).size;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 let state=await readJson<Index|null>(file+'.index.json',null);
 if(state&&(!state||state.format!==1||!/^[a-f0-9]{16}$/.test(state.generation)||!Number.isSafeInteger(state.sequence)||state.sequence<0||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>size||!Number.isSafeInteger(state.lastStart)||state.lastStart<0||state.lastStart>state.offset||!/^[a-f0-9]{64}$/.test(state.hash)))throw new Error('Invalid replay index; do not reset state');
 if(state&&state.sequence){const raw=await range(file,state.lastStart,state.offset);if(!raw.endsWith('\n'))throw new Error('Replay has a torn tail');const last=JSON.parse(raw.trimEnd()) as Row;if(last.hash!==state.hash||last.sequence!==state.sequence||last.generation!==state.generation||last.source!==state.lastSource)throw new Error('Replay index does not match the journal');const{hash,...body}=last;if(digest(body)!==hash)throw new Error('Replay tail changed');}
 if(!state){let generation=randomBytes(8).toString('hex');if(size){const prefix=await range(file,0,Math.min(size,256));const found=/^\{"generation":"([a-f0-9]{16})"/.exec(prefix);if(!found)throw new Error('Replay generation is missing');generation=found[1]!;}state={format:1,generation,sequence:0,offset:0,hash:zero,lastSource:'',lastStart:0};}
 if(size>state.offset){const tail=await range(file,state.offset,size);if(!tail.endsWith('\n'))throw new Error('Replay has a torn tail; preserve and inspect before retry');let offset=state.offset;for(const line of tail.slice(0,-1).split('\n')){const r=row(line,state.generation,state.sequence+1,state.hash);state={...state,sequence:r.sequence,hash:r.hash,lastSource:r.source,lastStart:offset,offset:offset+Buffer.byteLength(line)+1};offset=state.offset;}await writeJson(file+'.index.json',state);}
 return state;
}
async function append(file:string,event:RuntimeEvent,p:RuntimeReplayPolicy,secrets:string[]){
 await mkdir(dirname(file),{recursive:true,mode:0o700});await paths(file);
 await withFileLock(file+'.lock',async()=>{const state=await index(file),source=digest([boot,event.sequence,event.agentId,event.type]);if(source===state.lastSource)return;
  const body:Omit<Row,'hash'>={generation:state.generation,sequence:state.sequence+1,source,at:event.at,type:event.type,agentId:event.agentId,...('turn'in event?{turn:event.turn}:{}),mode:p.mode,prev:state.hash};
  const raw=event.type==='text_delta'?event.delta:event.type==='assistant_message'||event.type==='display_message'?event.text:event.type==='tool_started'?JSON.stringify(event.input):event.type==='tool_completed'?event.output:event.type==='input_required'?event.question:event.type==='agent_completed'?event.result:event.type==='agent_failed'?event.error:undefined;
  if(raw!==undefined&&p.mode!=='metadata'&&(event.type!=='text_delta'||p.mode==='verbatim')){const max=p.maxTextChars??64000;body.text=p.mode==='verbatim'?raw.slice(0,max):withModelDiagnosticSecrets(secrets,()=>redactModelDiagnostic(raw,Math.min(max,64000),true));body.truncated=raw.length>(p.mode==='redacted'?Math.min(max,64000):max);}
  const record={...body,hash:digest(body)},line=JSON.stringify(record)+'\n',bytes=Buffer.byteLength(line);
  if(state.sequence>=(p.maxEvents??50000)||state.offset+bytes>(p.maxBytes??8*1024*1024))throw new Error('Replay capture capacity reached; existing history preserved');
  const handle=await open(file,'a',0o600);try{await handle.writeFile(line);await handle.sync();}finally{await handle.close();}
  await writeJson(file+'.index.json',{...state,sequence:record.sequence,offset:state.offset+bytes,hash:record.hash,lastSource:source,lastStart:state.offset});
 });
}
/** Opt-in passive journal. Never executes replayed tools/models; private reasoning
 * is always excluded. Verbatim is explicit plaintext, not a redaction promise. */
export function queueRuntimeReplay(event:RuntimeEvent,policy:RuntimeReplayPolicy|undefined,secrets:string[]=[]):void{
 if(!policy||!events.has(event.type))return;validateRuntimeReplay(policy);const file=location(event.sessionId);if((backlog.get(file)??0)>=4096){failed.add(file);return;}
 const p=structuredClone(policy),copy=structuredClone(event);backlog.set(file,(backlog.get(file)??0)+1);
 const next=(pending.get(file)??Promise.resolve()).catch(()=>{}).then(()=>append(file,copy,p,[...secrets]));pending.set(file,next);
 void next.catch(()=>{failed.add(file)}).finally(()=>{backlog.set(file,Math.max(0,(backlog.get(file)??1)-1));if(pending.get(file)===next){pending.delete(file);backlog.delete(file);}});
}
export async function flushRuntimeReplay():Promise<void>{await Promise.allSettled([...pending.values()]);for(const file of failed)if(!marked.has(file))try{await mkdir(dirname(file),{recursive:true,mode:0o700});await paths(file);await writeJson(file+'.gap.json',{captureFailure:true,at:new Date().toISOString()});marked.add(file);}catch{/* A passive journal must not replace the original model/tool outcome. */}}
export async function runtimeReplay(cwd:string,id:string,cursor?:string,limit=100,includeText=false){
 await scopedSession(cwd,id);if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error('Replay page limit must be 1–500');await flushRuntimeReplay();const file=location(id);await mkdir(dirname(file),{recursive:true,mode:0o700});await paths(file);
 return withFileLock(file+'.lock',async()=>{const state=await index(file);let after=0,reset=false;if(cursor!==undefined){const m=/^([a-f0-9]{16}):(\d{1,16})$/.exec(cursor);if(!m||!Number.isSafeInteger(Number(m[2])))throw new Error('Invalid replay cursor');after=Number(m[2]);if(m[1]!==state.generation||after>state.sequence){reset=true;after=0;}}
  let text='';try{text=await readFile(file,'utf8')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(text&&!text.endsWith('\n'))throw new Error('Replay has a torn tail');let seq=0,previous=zero;const items:Row[]=[];
  for(const line of text.split('\n').filter(Boolean)){const r=row(line,state.generation,++seq,previous);previous=r.hash;if(r.sequence>after&&items.length<limit){if(!includeText)delete r.text;items.push(r);}}
  if(seq!==state.sequence||previous!==state.hash)throw new Error('Replay journal/index mismatch');const gap=await readJson<{captureFailure:boolean}|null>(file+'.gap.json',null),last=items.at(-1)?.sequence??after;
  return {sessionId:id,items,cursor:`${state.generation}:${last}`,hasMore:last<seq,reset,captureFailure:failed.has(file)||gap?.captureFailure===true,reasoningExcluded:true,providerStateReplayed:false,executesActions:false as const,exactText:includeText&&items.length>0&&items.every(r=>r.mode==='verbatim'&&!r.truncated),bounded:true};
 });
}
