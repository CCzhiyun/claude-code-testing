import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { projectStateDir, assertWithinRoots } from './paths.js';
import { protectPath, executeCommand } from './policy.js';
import { safePluginStatePath } from './pluginHistory.js';
import { boundedIndexBytes, indexSharedObject } from './gitIndexSnapshot.js';
import { isWorkspaceTrusted } from './workspaceTrust.js';
import { writeJson, withFileLock } from './storage.js';
import type { PlatformConfig } from './types.js';

const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const normalize=(path:string)=>process.platform==='win32'?path.toLowerCase():path;
async function bounded(path:string,max:number){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw new Error('Invalid conflict recovery file type/size');const bytes=await readFile(path);if(bytes.length>max)throw new Error('Recovery file grew beyond bound');return bytes;}
async function workingState(path:string){try{const bytes=await bounded(path,16*1024*1024);return {present:true,sha256:hash(bytes),mode:(await lstat(path)).mode&0o777};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {present:false};throw error;}}
async function gitPath(cwd:string,name:string,config:PlatformConfig){const result=await executeCommand('git',['rev-parse','--git-path',name],cwd,config);if(result.code!==0)throw new Error('Cannot locate recovery Git path');const lexical=resolve(cwd,result.stdout.trim()),actual=protectPath(lexical,config);if(normalize(lexical)!==normalize(actual))throw new Error('Git recovery paths must not traverse links');return actual;}
interface Receipt {format:1;id:string;phase:string;path:string;repositoryHead?:string;originalWorkingMode?:number;originalIndexSha256:string;indexSha256?:string;originalWorking:{present:boolean;sha256?:string};selected:{deleted?:boolean;sha256?:string};sharedIndex?:{name:string;sha256:string}}
async function review(cwd:string,id:string,config:PlatformConfig){
 if(!/^conflict_[a-f0-9]{16}$/.test(id))throw new Error('Invalid conflict recovery ID');
 const root=protectPath(resolve(cwd),config),directory=join(projectStateDir(root),'conflict-resolutions',id);await safePluginStatePath(root,directory);
 for(const name of ['receipt.json','index.original','working.original','restore.json'])await safePluginStatePath(root,join(directory,name));
 const raw=await bounded(join(directory,'receipt.json'),64000),receipt=JSON.parse(raw.toString('utf8')) as Receipt;
 if(receipt.format!==1||receipt.id!==id||receipt.phase!=='completed'||typeof receipt.path!=='string'||!receipt.path||!receipt.originalWorking||typeof receipt.originalWorking.present!=='boolean'||!receipt.selected||!/^[a-f0-9]{64}$/.test(receipt.indexSha256??'')||!/^[a-f0-9]{64}$/.test(receipt.originalIndexSha256))throw new Error('Only a completed valid conflict resolution can be restored');
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(receipt.repositoryHead??'')||!Number.isSafeInteger(receipt.originalWorkingMode)||receipt.originalWorkingMode!<0||receipt.originalWorkingMode!>0o777)throw new Error('Legacy conflict receipt lacks HEAD/mode binding; inspect backups manually');
 try{await lstat(join(directory,'restore.json'));throw new Error('Conflict restore already started; inspect retained restore receipt before manual recovery');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const lexical=resolve(root,receipt.path),file=protectPath(lexical,config);assertWithinRoots(file,[root]);if(normalize(file)!==normalize(lexical))throw new Error('Recovery working path must not traverse links');
 const index=await gitPath(root,'index',config),currentIndex=await boundedIndexBytes(index),original=await boundedIndexBytes(join(directory,'index.original'));indexSharedObject(original);
 if(hash(currentIndex)!==receipt.indexSha256||hash(original)!==receipt.originalIndexSha256)throw new Error('Git index changed or original backup was tampered; refusing whole-index overwrite');
 const head=await executeCommand('git',['rev-parse','HEAD'],root,config);if(head.code!==0||head.stdout.trim()!==receipt.repositoryHead)throw new Error('Repository HEAD changed; inspect backups manually');
 const working=await workingState(file);if(receipt.selected.deleted?working.present:!working.present||working.sha256!==receipt.selected.sha256)throw new Error('Working file changed after resolution; no overwrite allowed');
 let originalWorking:Buffer|undefined;
 if(receipt.originalWorking.present){originalWorking=await bounded(join(directory,'working.original'),16*1024*1024);if(hash(originalWorking)!==receipt.originalWorking.sha256)throw new Error('Original working backup was tampered');}
 const sharedOid=indexSharedObject(original);let shared:{name:string;bytes:Buffer;path:string;exists:boolean}|undefined;
 if(sharedOid){
  const name=`sharedindex.${sharedOid}`;if(receipt.sharedIndex?.name!==name)throw new Error('Shared-index recovery receipt mismatch');await safePluginStatePath(root,join(directory,name));
  const bytes=await boundedIndexBytes(join(directory,name)),length=sharedOid.length/2;
  if(hash(bytes)!==receipt.sharedIndex.sha256||bytes.subarray(-length).toString('hex')!==sharedOid||createHash(length===20?'sha1':'sha256').update(bytes.subarray(0,-length)).digest('hex')!==sharedOid)throw new Error('Retained shared-index checksum mismatch');
  const path=await gitPath(root,name,config);let exists=false;try{if(hash(await boundedIndexBytes(path))!==hash(bytes))throw new Error('Existing shared-index object differs from retained bytes');exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  shared={name,bytes,path,exists};
 }
 const binding={id,path:receipt.path,head:receipt.repositoryHead,receipt:hash(raw),index:hash(currentIndex),working,original:hash(original),shared:shared?{name:shared.name,sha256:hash(shared.bytes),exists:shared.exists}:null,authority:hash(JSON.stringify(config))};
 return {root,directory,receipt,index,currentIndex,original,file,originalWorking,shared,binding,reviewDigest:hash(JSON.stringify(binding))};
}
export async function previewConflictRestore(cwd:string,id:string,config:PlatformConfig){const value=await review(cwd,id,config);return {id,path:value.receipt.path,reviewDigest:value.reviewDigest,restoresOriginalIndex:true,restoresSplitObject:!!value.shared,restoresOriginalWorking:value.receipt.originalWorking.present,committed:false,pushed:false};}
/** Explicit undo of the exact still-current resolution. A newer staging change,
 * edit or HEAD blocks it. Both before/after bytes remain; unknown never replays. */
export async function restoreConflictResolution(cwd:string,id:string,expectedDigest:string,confirmed:boolean,config:PlatformConfig){
 if(!confirmed||!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('Conflict restore requires --confirm and exact review digest');
 if(['restricted','bypass'].includes(config.policy.mode)||!await isWorkspaceTrusted(cwd))throw new Error('Conflict restore requires trusted non-bypass permissions');
 return withFileLock(join(projectStateDir(cwd),'git-conflict-resolution.lock'),async()=>{
  const before=await review(cwd,id,config);if(before.reviewDigest!==expectedDigest)throw new Error('Conflict restore review changed');
  const lockPath=before.index+'.lock',lock=await open(lockPath,'wx',0o600),identity=await lock.stat();let closed=false,committed=false;
  try{
   const value=await review(cwd,id,config);if(value.reviewDigest!==expectedDigest)throw new Error('Conflict restore changed before exclusive Git lock');
   const recovery=join(value.directory,'restore-backup');await safePluginStatePath(value.root,recovery);await mkdir(recovery,{mode:0o700});
   await copyFile(value.index,join(recovery,'index.before'));
   await writeJson(join(value.directory,'restore.json'),{format:1,phase:'applying',reviewDigest:expectedDigest,automaticReplay:false});
   if(value.shared&&!value.shared.exists){const temporary=join(recovery,value.shared.name);await copyFile(join(value.directory,value.shared.name),temporary);if(hash(await boundedIndexBytes(temporary))!==hash(value.shared.bytes))throw new Error('Retained shared-index changed during copy');await link(temporary,value.shared.path);}
   if(value.binding.working.present){await rename(value.file,join(recovery,'working.before'));const moved=await workingState(join(recovery,'working.before'));if(moved.sha256!==value.binding.working.sha256)throw new Error('Editor changed working file; latest bytes retained in restore-backup');}
   if(value.originalWorking){const temporary=join(recovery,'working.publish');await copyFile(join(value.directory,'working.original'),temporary);if(hash(await bounded(temporary,16*1024*1024))!==hash(value.originalWorking))throw new Error('Original working backup changed during copy');if(process.platform!=='win32')await chmod(temporary,value.receipt.originalWorkingMode!);await link(temporary,value.file);await unlink(temporary);}
   const working=await workingState(value.file);if(value.originalWorking?!working.present||working.sha256!==hash(value.originalWorking):working.present)throw new Error('Working file changed before restore index publication');
   if(hash(await boundedIndexBytes(value.index))!==value.binding.index)throw new Error('Git index changed before restore publication');
   const head=await executeCommand('git',['rev-parse','HEAD'],value.root,config);if(head.code!==0||head.stdout.trim()!==value.binding.head)throw new Error('HEAD changed before restore publication');
   await lock.writeFile(value.original);const current=await lstat(lockPath);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino)throw new Error('Git lock ownership changed');await lock.close();closed=true;await rename(lockPath,value.index);committed=true;
   await writeJson(join(value.directory,'restore.json'),{format:1,phase:'completed',reviewDigest:expectedDigest,automaticReplay:false});
   return {id,path:value.receipt.path,restored:true,backup:recovery,committed:false,pushed:false};
  }catch(error){await writeJson(join(before.directory,'restore-failure.json'),{phase:'unknown',automaticReplay:false,inspectBackups:true}).catch(()=>{});throw error;}
  finally{if(!closed)await lock.close();if(!committed)try{const current=await lstat(lockPath);if(!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino)await unlink(lockPath);}catch{}}
 });
}
