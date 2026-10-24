import {copyFile,lstat,readFile,writeFile,mkdir,open,rename,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {executeCommand,protectPath} from './policy.js';
import {projectStateDir,assertWithinRoots} from './paths.js';
import {safePluginStatePath} from './pluginHistory.js';
import {reviewBinaryConflict} from './worktree.js';
import {createId,writeJson,withFileLock} from './storage.js';
import {isWorkspaceTrusted} from './workspaceTrust.js';
import {audit} from './audit.js';
import type {PlatformConfig} from './types.js';
import {boundedIndexBytes,sharedIndexSnapshot,indexSharedObject} from './gitIndexSnapshot.js';
export type ConflictChoice='ours'|'theirs'|'working'|'delete';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function exactPath(cwd:string,file:string,config:PlatformConfig){const root=protectPath(resolve(cwd),config),lexical=resolve(root,file),actual=protectPath(lexical,config);assertWithinRoots(actual,[root]);const normalize=(path:string)=>process.platform==='win32'?path.toLowerCase():path;if(normalize(lexical)!==normalize(actual))throw new Error('Conflict path must not traverse links');return root;}
async function readWorking(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new Error('Working file exceeds safe resolution bounds; bytes retained');const bytes=await readFile(path);if(bytes.length>16*1024*1024)throw new Error('Working file grew beyond bounds; bytes retained');return bytes;}
export async function reviewConflictResolution(cwd:string,file:string,config:PlatformConfig){
 exactPath(cwd,file,config);
 const reviewed=await reviewBinaryConflict(cwd,file,config);return {...reviewed,choices:['ours','theirs','working','delete'] as ConflictChoice[],instructions:'Pick exact bytes or deletion, then explicitly confirm. Original working bytes and Git index are retained. No commit, hooks from Git attributes, push, or PR.'};
}
/** Keeps original bytes even on an interrupted apply. Shared Git index is held
 * under Git's own exclusive lock; only a private candidate index is modified.
 * A non-cooperating editor may still race on working files; publication never
 * overwrites a concurrently created path. Uncertain states retain a receipt. */
export async function resolveConflict(cwd:string,file:string,choice:ConflictChoice,expectedVersion:string,confirmed:boolean,config:PlatformConfig){
 if(!confirmed||!/^[a-f0-9]{64}$/.test(expectedVersion)||!['ours','theirs','working','delete'].includes(choice))throw new Error('Conflict resolution requires exact choice, reviewed version, and explicit confirmation');
 if(config.policy.mode==='restricted'||config.policy.mode==='bypass'||!await isWorkspaceTrusted(cwd))throw new Error('Conflict resolution requires trusted non-bypass command permissions');
 const root=exactPath(cwd,file,config);
 return withFileLock(join(projectStateDir(root),'git-conflict-resolution.lock'),async()=>{
  const initial=await reviewBinaryConflict(root,file,config);if(initial.version!==expectedVersion)throw new Error('Conflict index/working bytes changed; review again');
  const indexResult=await executeCommand('git',['rev-parse','--git-path','index'],root,config);if(indexResult.code!==0)throw new Error('Cannot locate Git index');
  const index=protectPath(resolve(root,indexResult.stdout.trim()),config);const stat=await lstat(index);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new Error('Unsupported Git index type/size');
  const lockPath=index+'.lock',lock=await open(lockPath,'wx',0o600),identity=await lock.stat();let committed=false,closed=false,directory:string|undefined;
  try{
   const reviewed=await reviewBinaryConflict(root,file,config);if(reviewed.version!==expectedVersion)throw new Error('Conflict changed before exclusive Git lock');
   const head=await executeCommand('git',['rev-parse','HEAD'],root,config);if(head.code!==0||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})\s*$/.test(head.stdout))throw new Error('Cannot bind conflict recovery to repository HEAD');
   const source=choice==='ours'||choice==='theirs'?reviewed.versions.find(v=>v.side===choice):undefined;
   if(source?.present&&(!['100644','100755'].includes(source.mode??'')||(source.bytes??Infinity)>16*1024*1024))throw new Error('Only regular blobs up to 16 MiB may be selected; symlinks/submodules are not followed');
   let bytes:Buffer|undefined,mode='100644';const working=protectPath(resolve(root,reviewed.path),config);assertWithinRoots(working,[root]);
   if(source?.present){const blob=await executeCommand('git',['cat-file','blob',source.objectId!],root,config,undefined,undefined,{binaryOutput:true});if(blob.code!==0||!blob.stdoutBytes||blob.stdoutBytes.length!==source.bytes)throw new Error('Unable to read exact conflict blob');bytes=blob.stdoutBytes;mode=source.mode!;}
   else if(choice==='working'&&reviewed.working.present){if(reviewed.working.markersRemain)throw new Error('Conflict markers remain');bytes=await readWorking(working);if(sha(bytes)!==reviewed.working.sha256)throw new Error('Working bytes changed');mode=reviewed.versions.find(v=>v.present&&['100644','100755'].includes(v.mode??''))?.mode??'100644';}
   const id=createId('conflict');directory=join(projectStateDir(root),'conflict-resolutions',id);await safePluginStatePath(root,directory);await mkdir(directory,{recursive:true,mode:0o700});
   const originalIndex=await boundedIndexBytes(index),shared=await sharedIndexSnapshot(root,config,originalIndex);await writeFile(join(directory,'index.original'),originalIndex,{flag:'wx',mode:0o600});
   if(shared)await writeFile(join(directory,shared.name),shared.bytes,{flag:'wx',mode:0o600});
   const candidate=join(directory,'index.candidate');await copyFile(index,candidate);await mkdir(join(directory,'empty-hooks'));let oid='0'.repeat(reviewed.versions.find(v=>v.objectId)?.objectId?.length??40);
   // Materialize a complete private index before any working-file mutation.
   // Never changes core.splitIndex or removes the repository's shared object.
   if(shared){const expanded=await executeCommand('git',['update-index','--no-split-index'],root,config,undefined,undefined,{gitIndexFile:candidate});if(expanded.code!==0)throw new Error('Cannot materialize private split index; originals retained');}
   if(bytes){await writeFile(join(directory,'selected.bytes'),bytes,{flag:'wx',mode:0o600});const blob=await executeCommand('git',['hash-object','-w','--no-filters','--stdin'],root,config,undefined,bytes);if(blob.code!==0||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})\s*$/.test(blob.stdout))throw new Error('Cannot create exact unfiltered resolution blob');oid=blob.stdout.trim();}
   const input=`0 ${'0'.repeat(oid.length)}\t${reviewed.path}\0${bytes?`${mode} ${oid}\t${reviewed.path}\0`:''}`;
   const staged=await executeCommand('git',['update-index','-z','--index-info'],root,config,undefined,Buffer.from(input),{gitIndexFile:candidate});if(staged.code!==0)throw new Error('Private candidate index rejected');
   if(indexSharedObject(await boundedIndexBytes(candidate)))throw new Error('Candidate still depends on a shared index; retained originals');
   const finalReview=await reviewBinaryConflict(root,file,config);if(finalReview.version!==expectedVersion||sha(await boundedIndexBytes(index))!==sha(originalIndex)||shared&&sha(await boundedIndexBytes(shared.path))!==shared.sha256)throw new Error('Working/index changed before apply; originals retained');
   const receipt={format:1,id,path:reviewed.path,choice,expectedVersion,phase:'applying',repositoryHead:head.stdout.trim(),originalWorkingMode:reviewed.working.present?(await lstat(working)).mode&0o777:0,originalIndexSha256:sha(originalIndex),...(shared?{sharedIndex:{name:shared.name,sha256:shared.sha256,retained:true},publishedIndex:'full'}:{}),originalWorking:reviewed.working,selected:bytes?{sha256:sha(bytes),bytes:bytes.length,mode,oid}:{deleted:true}};
   await writeJson(join(directory,'receipt.json'),receipt);await audit({event:'git.conflict.resolve',outcome:'requested',details:{id,path:reviewed.path,choice,expectedVersion}});
   if(reviewed.working.present){const backup=join(directory,'working.original');await rename(working,backup);if(sha(await readWorking(backup))!==reviewed.working.sha256){try{await link(backup,working);}catch{}throw new Error('Editor changed working bytes; latest bytes retained in backup');}}
   if(bytes){const publish=join(directory,'working.publish');await copyFile(join(directory,'selected.bytes'),publish);if(process.platform!=='win32')await(await import('node:fs/promises')).chmod(publish,mode==='100755'?0o755:0o644);try{await link(publish,working);await unlink(publish);}catch{if(reviewed.working.present)try{await link(join(directory,'working.original'),working);}catch{}throw new Error('Working path was concurrently created or cannot be published; no concurrent file overwritten');}}
   else{try{await lstat(working);throw new Error('Working path concurrently reappeared; inspect retained receipt');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
   if(bytes&&sha(await readWorking(working))!==sha(bytes))throw new Error('Working bytes changed before index publication; inspect retained originals');
   const next=await readFile(candidate);if(next.length>64*1024*1024)throw new Error('Candidate index exceeds bound');await lock.writeFile(next);const latestLock=await lstat(lockPath);if(latestLock.isSymbolicLink()||latestLock.dev!==identity.dev||latestLock.ino!==identity.ino)throw new Error('Git lock ownership changed; no index publication');await lock.close();closed=true;await rename(lockPath,index);committed=true;
   await writeJson(join(directory,'receipt.json'),{...receipt,phase:'completed',indexSha256:sha(next)});await audit({event:'git.conflict.resolve',outcome:'success',details:{id,path:reviewed.path,choice}});
   return {id,path:reviewed.path,choice,staged:true,deleted:!bytes,backup:directory,committed:false,pushed:false};
  }catch(error){if(directory)await writeJson(join(directory,'failure.json'),{phase:'unknown',automaticReplay:false,inspectBackups:true}).catch(()=>{});throw error;}
  finally{if(!closed)await lock.close();if(!committed)try{const current=await lstat(lockPath);if(!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino)await unlink(lockPath);}catch{}}
 });
}
