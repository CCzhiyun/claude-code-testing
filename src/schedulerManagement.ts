import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { loadSchedulerJob, prepareAutomationScheduler, schedulerTaskXml, type SchedulerJob } from './automationScheduler.js';
const run = promisify(execFile);
const digest = (job:SchedulerJob) => createHash('sha256').update(JSON.stringify(job)).digest('hex');
const folder = (id:string) => join(homeStateDir(),'schedulers',id);
const executable = () => join(process.env.SystemRoot ?? 'C:\\Windows','System32/schtasks.exe');
const options = {windowsHide:true,timeout:15000,maxBuffer:256000};
function value(xml:string, tag:string):string {
  const matches=[...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`,'g'))];
  if(matches.length!==1) throw new Error('Ambiguous scheduler task definition');
  return matches[0]![1]!.replace(/&(?:#x([a-f0-9]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi,(whole,hex,decimal)=>{
    if(hex || decimal) { const code=parseInt(hex ?? decimal,hex ? 16 : 10); if(code<1 || code>0x10ffff || code>=0xd800&&code<=0xdfff) throw new Error('Invalid scheduler XML entity'); return String.fromCodePoint(code); }
    return ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"} as Record<string,string>)[whole.toLowerCase()]!;
  });
}
/** Verify the owned action/principal, never a display-name match alone. */
export function assertOwnedSchedulerTask(job:SchedulerJob, actual:string, currentUserSid?:string):void {
  if (actual.length>256000 || /<!DOCTYPE|<!ENTITY/i.test(actual) || [...actual.matchAll(/<Exec(?:\s|>)/g)].length!==1 || [...actual.matchAll(/<Principal(?:\s|>)/g)].length!==1) throw new Error('Invalid or foreign scheduler definition');
  const actions=[...actual.matchAll(/<Actions(?:\s[^>]*)?>([\s\S]*?)<\/Actions>/g)];
  if(actions.length!==1 || [...actions[0]![1]!.matchAll(/<\/?([A-Za-z_:][\w:.-]*)\b/g)].some(match=>!['Exec','Command','Arguments','WorkingDirectory'].includes(match[1]!))) throw new Error('Scheduler has additional or foreign actions; no OS task was changed');
  const expected=schedulerTaskXml(job);
  for(const tag of ['Command','Arguments','WorkingDirectory','LogonType','RunLevel']) if(value(actual,tag)!==value(expected,tag)) throw new Error('Scheduler definition does not match the owned action/principal; no OS task was changed');
  const actualUser=value(actual,'UserId');
  if(actualUser!==value(expected,'UserId') && !(currentUserSid && /^S-1-\d+(?:-\d+)+$/.test(currentUserSid) && actualUser===currentUserSid)) throw new Error('Scheduler principal is not the current user');
}
async function query(job:SchedulerJob):Promise<string> {
  const result=await run(executable(),['/Query','/TN',`CCPT-${job.id}`,'/XML'],{...options,encoding:'buffer'});
  const bytes=result.stdout;
  return bytes.subarray(0,100).includes(0) || bytes[0]===0xff&&bytes[1]===0xfe ? bytes.toString('utf16le').replace(/^\uFEFF/,'') : bytes.toString('utf8').replace(/^\uFEFF/,'');
}
async function verifyRegisteredTask(job:SchedulerJob) {
  const actual=await query(job);
  if(value(actual,'UserId')===value(schedulerTaskXml(job),'UserId')) {assertOwnedSchedulerTask(job,actual);return;}
  // Task Scheduler can canonicalize DOMAIN\\name to a SID on export.
  const identity=await run(join(process.env.SystemRoot ?? 'C:\\Windows','System32/whoami.exe'),['/user','/fo','csv','/nh'],options);
  const sid=identity.stdout.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
  if(!sid)throw new Error('Cannot verify current Windows user SID');
  assertOwnedSchedulerTask(job,actual,sid);
}
export async function inspectAutomationScheduler(id:string, queryOS=false) {
  const job=await loadSchedulerJob(id);
  const saved=await readJson<Record<string,unknown> | null>(join(folder(id),'last-result.json'),null);
  const lastResult=saved ? Object.fromEntries(['delivered','disabled','repaired','pendingWorkPaused','busy','invalid','modelsExecuted','automaticExternalReplay','launched','backupCompleted','notDue','budgetExhausted','unknownOutcomeRetained'].filter(key=>typeof saved[key]==='number'||typeof saved[key]==='boolean').map(key=>[key,saved[key]])) : null;
  let registration='not-queried';
  if(queryOS) {
    if(process.platform!=='win32') {try{const {inspectNativeScheduler}=await import('./nativeSchedulers.js');registration=(await inspectNativeScheduler(job)).registration;}catch{registration='unverified-or-unavailable';}}
    else { try { await verifyRegisteredTask(job);registration='owned-action-verified'; } catch {registration='unverified-or-unavailable';} }
  }
  return {id:job.id,cwd:job.cwd,runtime:job.runtime,entry:job.entry,entryBound:!!job.entrySha256,...(!job.entrySha256?{action:'Use migration-preview/migrate with a fresh replacement CLI; legacy execution is blocked'}:{}),minutes:job.minutes,enabled:job.enabled,repairCorrupt:job.repairCorrupt,expectedDigest:digest(job),registration,lastResult,mode:job.goal?'approved-goal-once':job.backup?'bounded-recovery-backup':job.readOnly?'read-only-agent':'context-delivery-only',...(job.manager?{manager:job.manager}:{}),...(job.goal?{goal:job.goal}:{}),...(job.backup?{backup:job.backup}:{}),...(job.readOnly?{limits:job.readOnly}:{})};
}
export async function listAutomationSchedulers() {
  let names:string[]; try { names=await readdir(join(homeStateDir(),'schedulers')); } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const ids=names.filter(name=>/^scheduler_[a-f0-9]{16}$/.test(name)).sort();
  if(ids.length>256) throw new Error('Scheduler inventory exceeds 256 jobs; inspect locally');
  return Promise.all(ids.map(async id=>{try{return await inspectAutomationScheduler(id);}catch{return {id,invalid:true,action:'Inspect this local job; it was not executed or repaired'};}}));
}
function confirm(job:SchedulerJob, expectedDigest:string, confirmed:boolean) {
  if(!confirmed || digest(job)!==expectedDigest) throw new Error('Read automation status first; provide its current --expected-digest and --confirm');
}
/** Upgrade by preparing a NEW ID. Never overwrite an old/foreign OS definition. */
export async function rebindAutomationScheduler(id:string,entry:string,expectedDigest:string,confirmed:boolean) {
  await loadSchedulerJob(id);
  return withFileLock(join(folder(id),'tick.lock'),async()=>{
    const job=await loadSchedulerJob(id);confirm(job,expectedDigest,confirmed);
    if(job.goal||job.backup)throw new Error('Paid Goal/backup schedules require a new explicit prepare and approval; generic rebind is refused');
    if(job.readOnly){const {readOnlyAutomationConfig}=await import('./readOnlyAutomation.js');readOnlyAutomationConfig(await(await import('./config.js')).loadConfig(job.cwd),job.cwd,job.readOnly);}
    const prepared=job.readOnly?await(await import('./scheduledAgent.js')).prepareReadOnlyAutomation(job.cwd,entry,job.readOnly,job.minutes):await prepareAutomationScheduler(job.cwd,entry,job.minutes,job.repairCorrupt);
    job.enabled=false;await writeJson(join(folder(id),'job.json'),job);
    await writeJson(join(folder(id),'management.json'),{action:'rebound',replacementId:prepared.id,at:new Date().toISOString()});
    return {previousId:id,previousEnabled:false,previousOsTaskRetained:true,replacement:prepared,osTaskRegistered:false};
  });
}
export async function recoverAutomationScheduler(id:string,expectedDigest:string,confirmed:boolean){
 await loadSchedulerJob(id);
 return withFileLock(join(folder(id),'tick.lock'),async()=>{
  const job=await loadSchedulerJob(id);if(job.platform!=='linux'&&job.platform!=='darwin')throw new Error('This recovery path is for nonce-bound native user schedulers; Windows registration requires its separate owned-task inspection');
  return(await import('./nativeSchedulers.js')).recoverNativeScheduler(job,expectedDigest,confirmed);
 });
}
/** Disable locally even when querying/removing the OS task fails. Keep all evidence. */
export async function uninstallAutomationScheduler(id:string,expectedDigest:string,confirmed:boolean) {
  await loadSchedulerJob(id);
  return withFileLock(join(folder(id),'tick.lock'),async()=>{
    const job=await loadSchedulerJob(id);confirm(job,expectedDigest,confirmed);
    if((job.platform??'win32')!==process.platform)throw new Error('Scheduler definition belongs to a different OS');
    job.enabled=false;await writeJson(join(folder(id),'job.json'),job);
    if(process.platform!=='win32')return (await import('./nativeSchedulers.js')).uninstallNativeScheduler(job);
    await verifyRegisteredTask(job);
    await run(executable(),['/Delete','/TN',`CCPT-${id}`,'/F'],options);
    await writeJson(join(folder(id),'management.json'),{action:'uninstalled',at:new Date().toISOString(),retainedState:true});
    return {id,enabled:false,osTaskRemoved:true,retainedState:true};
  });
}
