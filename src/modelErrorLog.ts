import {join,dirname} from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import type {PlatformConfig} from './types.js';
import {homeStateDir} from './paths.js';
import {createId,withFileLock,writeJson} from './storage.js';
import {ModelRequestError,ModelBoundaryError,ContextLimitError,redactModelDiagnostic,formatErrorDiagnostic} from './modelErrors.js';
import {resolveModelEndpoint,resolveModelProtocol,resolveModelWireProtocol} from './modelConnection.js';

export interface ModelErrorEntry {
 id:string;at:string;model:string;protocol:string;transport:string;endpoint:string;tools:number;
 status?:number;code?:string;param?:string;requestId?:string;message:string;diagnostic:string;
}
const MAX_BYTES=4*1024*1024,MAX_RECORDS=100;
export const modelErrorLogPath=()=>join(homeStateDir(),'diagnostics','model-errors.json');
async function assertNoLinks(path:string):Promise<void>{
 for(let current=path;;current=dirname(current)){
  try{if((await lstat(current)).isSymbolicLink())throw new Error('Diagnostic paths cannot traverse links');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(dirname(current)===current)return;
 }
}
export async function listModelErrors(limit=10):Promise<ModelErrorEntry[]>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_RECORDS)throw new Error('Error log limit must be 1–100');
 const path=modelErrorLogPath();await assertNoLinks(path);
 try{
  const info=await lstat(path);if(!info.isFile()||info.size>MAX_BYTES)throw new Error('Invalid or oversized model error log; preserve it for manual inspection');
  const raw=await readFile(path,'utf8');if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('Oversized model error log');
  const entries:unknown=JSON.parse(raw);
  if(!Array.isArray(entries)||entries.length>MAX_RECORDS||entries.some(e=>!e||typeof e!=='object'||!/^modelerror_[a-f0-9]{16}$/.test(e.id)||typeof e.diagnostic!=='string'))throw new Error('Invalid model error log; original bytes preserved');
  // Redact again on export, including secrets added to the current environment later.
  return entries.slice(-limit).reverse().map(e=>{
   const safe:Record<string,unknown>={};for(const key of ['id','at','model','protocol','transport','endpoint','tools','status','code','param','requestId','message','diagnostic']){
    const value=e[key];if(typeof value==='string')safe[key]=redactModelDiagnostic(value,key==='diagnostic'?20000:2000,key==='diagnostic');
    else if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)safe[key]=value;
   }return safe as unknown as ModelErrorEntry;
  });
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
/** Bounded sanitized diagnostics only: never request bodies, prompts, tool output,
 * response payloads or headers. Ephemeral runs do not write this log at all. */
export async function recordModelError(config:PlatformConfig,toolCount:number,error:unknown):Promise<string|undefined>{
 if(config.ephemeralSession)return;
 let failure:ModelRequestError|ModelBoundaryError|ContextLimitError|undefined;
 for(let current:unknown=error,depth=0;current instanceof Error&&depth<8;current=current.cause,depth++)if(current instanceof ModelRequestError||current instanceof ModelBoundaryError||current instanceof ContextLimitError){failure=current;break;}
 if(!failure||!(error instanceof Error)||failure instanceof ModelBoundaryError&&failure.category==='cancelled')return;
 const diagnostic=failure instanceof ModelRequestError||failure instanceof ContextLimitError?failure.diagnostics:undefined;
 const causes:string[]=[];const seen=new Set<Error>();
 for(let current:unknown=error;current instanceof Error&&!seen.has(current)&&causes.length<4;current=current.cause){seen.add(current);causes.push(formatErrorDiagnostic(current));}
 const entry:ModelErrorEntry={id:createId('modelerror'),at:new Date().toISOString(),model:redactModelDiagnostic(config.model.name),protocol:resolveModelProtocol(config.model),transport:resolveModelWireProtocol(config.model),endpoint:redactModelDiagnostic(resolveModelEndpoint(config.model)),tools:toolCount,
  ...(failure instanceof ModelRequestError?{status:failure.status}:{}),...(failure instanceof ModelRequestError||failure instanceof ModelBoundaryError?failure.code?{code:failure.code}:{}:{}),
  ...(diagnostic?.param?{param:diagnostic.param}:{}),...(diagnostic?.requestId?{requestId:diagnostic.requestId}:{}),message:redactModelDiagnostic(error.message),diagnostic:redactModelDiagnostic(causes.join('\nCaused by:\n'),20000,true)};
 const path=modelErrorLogPath();await assertNoLinks(path);
 await withFileLock(path+'.lock',async()=>{const entries=(await listModelErrors(MAX_RECORDS)).reverse();entries.push(entry);while(entries.length>MAX_RECORDS||Buffer.byteLength(JSON.stringify(entries))>MAX_BYTES-1024)entries.shift();await writeJson(path,entries);});
 return entry.id;
}
