import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {homeStateDir} from './paths.js';
import {loadSchedulerJob,prepareAutomationScheduler} from './automationScheduler.js';
import {readJson,writeJson,withFileLock} from './storage.js';
import {authoritySnapshot,assertAuthorityUnchanged} from './activeAuthority.js';
import {isWorkspaceTrusted} from './workspaceTrust.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pathFor=(id:string)=>join(homeStateDir(),'schedulers',id,'migration.json');
async function receipt(id:string){
 const path=pathFor(id);try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16000)throw new Error('Invalid retained migration receipt');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 const row=await readJson<Record<string,unknown>|null>(path,null);
 if(!row||row.format!==1||!['preparing','prepared'].includes(String(row.phase))||typeof row.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(row.reviewDigest)||row.replacementId!==undefined&&!/^scheduler_[a-f0-9]{16}$/.test(String(row.replacementId)))throw new Error('Damaged migration receipt; retain evidence and inspect scheduler inventory');
 return {phase:row.phase as 'preparing'|'prepared',reviewDigest:row.reviewDigest,replacementId:row.replacementId as string|undefined};
}
async function entryBinding(entry:string){
 if(!isAbsolute(entry)||/[\x00-\x1f\x7f"]/.test(entry)||entry.length>8000)throw new Error('Migration requires an absolute replacement CLI entry');
 const path=resolve(entry),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw new Error('Replacement CLI must be a bounded non-link file');
 const bytes=await readFile(path);if(bytes.length>32*1024*1024)throw new Error('Replacement CLI grew beyond bounds');
 return {path,sha256:createHash('sha256').update(bytes).digest('hex')};
}
/** Read-only review never loads or executes the old entry. Old paid schedules
 * cannot silently acquire fresh deployment/budget/Goal approval. */
export async function previewSchedulerMigration(id:string,entry:string){
 const job=await loadSchedulerJob(id);
 if(job.entrySha256)throw new Error('Scheduler is already entry-bound; use reviewed rebind instead');
 if(job.goal||job.backup||job.readOnly)throw new Error('Legacy paid/upload schedules require a fresh explicit prepare and approval');
 if((job.platform??'win32')!==process.platform)throw new Error('Migrate the scheduler on its original target OS');
 if(!await isWorkspaceTrusted(job.cwd))throw new Error('Trust this workspace before reviewing migration');
 const replacement=await entryBinding(entry),authority=await authoritySnapshot(job.cwd),retained=await receipt(id);
 return {id,cwd:job.cwd,minutes:job.minutes,previousEnabled:job.enabled,replacement,authority,expectedDigest:hash({job,replacement,authority}),retained,mode:'context-delivery-only' as const,automaticReplay:false,osTaskModified:false};
}
export async function migrateLegacyScheduler(id:string,entry:string,expectedDigest:string,confirmed:boolean){
 if(!confirmed||!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('Migration requires reviewed --expected-digest and --confirm');
 await loadSchedulerJob(id);
 return withFileLock(join(homeStateDir(),'schedulers',id,'tick.lock'),async()=>{
  const review=await previewSchedulerMigration(id,entry);
  if(review.expectedDigest!==expectedDigest)throw new Error('Migration state, entry or policy changed; review a fresh digest');
  if(review.retained)throw new Error('Migration already started; inspect retained receipt and inventory, never replay an unknown prepare');
  await assertAuthorityUnchanged(review.cwd,review.authority);
  const job=await loadSchedulerJob(id);
  // Revocation is the first mutation. No OS manager command is issued here.
  job.enabled=false;await writeJson(join(homeStateDir(),'schedulers',id,'job.json'),job);
  await writeJson(pathFor(id),{format:1,phase:'preparing',reviewDigest:expectedDigest,at:new Date().toISOString()});
  const candidate=await prepareAutomationScheduler(job.cwd,review.replacement.path,job.minutes,job.repairCorrupt);
  const next=await loadSchedulerJob(candidate.id);
  // If policy/entry changed during prepare, leave both local jobs inert and the
  // receipt unknown. Operators inspect them; no silent rollback or OS retry.
  try{await assertAuthorityUnchanged(review.cwd,review.authority);if(next.entrySha256!==review.replacement.sha256)throw new Error('Replacement entry changed during migration');}
  catch(error){next.enabled=false;await writeJson(join(homeStateDir(),'schedulers',next.id,'job.json'),next);throw error;}
  await writeJson(pathFor(id),{format:1,phase:'prepared',reviewDigest:expectedDigest,replacementId:next.id,at:new Date().toISOString()});
  return {previousId:id,previousEnabled:false,previousOsTaskRetained:true,replacement:candidate,osTaskRegistered:false,automaticExternalReplay:false,wakeupsRebound:false};
 });
}
