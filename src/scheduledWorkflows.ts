import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {readFile} from 'node:fs/promises';
import {executeCommand,protectPath} from './policy.js';
import {loadConfig} from './config.js';
import {homeStateDir} from './paths.js';
import {readJson,writeJson,withFileLock} from './storage.js';
import {authoritySnapshot,assertAuthorityUnchanged} from './activeAuthority.js';
import {inspectGoalWorkflow,launchGoalWorkflow} from './goalWorkflow.js';
import {prepareAutomationScheduler,loadSchedulerJob,refreshSchedulerDefinitions,type SchedulerJob,type SchedulerTickResult} from './automationScheduler.js';
import {prepareRecoveryRemote,runRecoveryRemote,queryRecoveryRemote} from './recoveryMaintenance.js';
import {listWorktreeRecoveries} from './worktree.js';
import {redactModelDiagnostic} from './modelErrors.js';
import type {PlatformConfig} from './types.js';
import {withExecutionBoundary} from './executionControl.js';
export interface ScheduledGoalBinding {id:string;expectedVersion:number;authority:string;notBefore:string}
export interface ScheduledBackupBinding {configuration:string;authority:string;repositoryPath:string;repositorySha256:string;maxRuns:number;notBefore:string}
interface Claim {id:string;at:string;phase:'claimed'|'launched'|'completed'|'unknown';backupId?:string;error?:string}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const folder=(job:SchedulerJob)=>join(homeStateDir(),'schedulers',job.id);
const receipt=(job:SchedulerJob)=>join(folder(job),'workflow-runs.json');
const date=(value:unknown)=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const instant=(at?:string)=>{const value=at??new Date(Date.now()+60000).toISOString();if(!date(value)||Date.parse(value)<Date.now())throw new Error('Schedule at a future ISO instant');return new Date(value).toISOString();};
export function validateScheduledBindings(job:SchedulerJob){
 if([job.readOnly,job.goal,job.backup].filter(Boolean).length>1)throw new Error('Scheduler execution modes cannot be mixed');
 if(job.goal&&(!/^goalrun_[a-f0-9]{16}$/.test(job.goal.id)||!Number.isSafeInteger(job.goal.expectedVersion)||job.goal.expectedVersion<1||!hex(job.goal.authority)||!date(job.goal.notBefore)))throw new Error('Invalid scheduled Goal binding');
 if(job.backup&&(!hex(job.backup.configuration)||!hex(job.backup.authority)||typeof job.backup.repositoryPath!=='string'||!isAbsolute(job.backup.repositoryPath)||job.backup.repositoryPath.length>8000||!hex(job.backup.repositorySha256)||!Number.isSafeInteger(job.backup.maxRuns)||job.backup.maxRuns<1||job.backup.maxRuns>20||!date(job.backup.notBefore)))throw new Error('Invalid bounded backup binding');
}
async function repoDigest(path:string){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)throw new Error('Invalid backup repository configuration');const bytes=await readFile(path);if(bytes.length>1024*1024)throw new Error('Repository configuration exceeds bounds');return createHash('sha256').update(bytes).digest('hex');}
async function backupRepository(cwd:string,config:PlatformConfig){
 for(const key of ['core.hooksPath','core.fsmonitor']){const value=await executeCommand('git',['config','--get',key],cwd,config);if(value.code!==1&&!(key==='core.fsmonitor'&&value.code===0&&['false','0'].includes(value.stdout.trim())))throw new Error('Unattended backup refuses custom Git hooks/fsmonitor');}
 const includes=await executeCommand('git',['config','--local','--get-regexp','^include'],cwd,config);if(includes.code!==1)throw new Error('Unattended backup refuses unbound repository config includes');
 const hook=await executeCommand('git',['rev-parse','--git-path','hooks/pre-push'],cwd,config);if(hook.code!==0)throw new Error('Cannot inspect backup Git hooks');try{await lstat(protectPath(resolve(cwd,hook.stdout.trim()),config));throw new Error('Unattended backup refuses a pre-push Hook');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const common=await executeCommand('git',['rev-parse','--git-common-dir'],cwd,config);if(common.code!==0)throw new Error('Cannot bind repository configuration');const repositoryPath=protectPath(resolve(cwd,common.stdout.trim(),'config'),config);return {repositoryPath,repositorySha256:await repoDigest(repositoryPath)};
}
async function backupBoundary(job:SchedulerJob,config:PlatformConfig){const binding=job.backup!;await assertAuthorityUnchanged(job.cwd,binding.authority);protectPath(binding.repositoryPath,config);if(await repoDigest(binding.repositoryPath)!==binding.repositorySha256)throw new Error('Backup repository configuration changed; explicitly review a new schedule');const hook=protectPath(resolve(binding.repositoryPath,'..','hooks/pre-push'),config);try{await lstat(hook);throw new Error('Backup pre-push Hook changed; re-review rather than execute new code');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
async function claims(job:SchedulerJob){
 const path=receipt(job);try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64000)throw new Error('Invalid scheduled workflow ledger');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const rows=await readJson<Claim[]>(path,[]);if(!Array.isArray(rows)||rows.length>20||new Set(rows.map(r=>r?.id)).size!==rows.length||rows.some(row=>!row||!hex(row.id)||!date(row.at)||!['claimed','launched','completed','unknown'].includes(row.phase)||row.backupId!==undefined&&!/^backup_[a-f0-9]{16}$/.test(row.backupId)||row.error!==undefined&&(typeof row.error!=='string'||row.error.length>4000)))throw new Error('Damaged scheduled workflow ledger; no automatic repair/replay');return rows;
}
function backupConfiguration(config:PlatformConfig){
 if(!config.recoveryRemote||!config.policy.allowGitPush||config.policy.mode==='bypass'||config.policy.mode==='restricted')throw new Error('Scheduled backup requires a pinned remote and non-bypass Git push permission');
 if(config.hooks.length||config.policy.processWrapper)throw new Error('Unattended backup does not accept executable Hooks/process wrappers; prepare a dedicated reviewed policy');
 return digest({remote:config.recoveryRemote,policy:config.policy,network:config.network});
}
export async function prepareScheduledGoal(cwd:string,entry:string,id:string,expectedVersion:number,confirmed:boolean,minutes=5,at?:string){
 if(!confirmed)throw new Error('Scheduling paid approved Coding requires explicit --confirm');
 const run=await inspectGoalWorkflow(cwd,id);if(run.version!==expectedVersion||run.phase!=='ready')throw new Error('Review an exact ready Goal workflow first');
 const binding:ScheduledGoalBinding={id,expectedVersion,authority:await authoritySnapshot(cwd),notBefore:instant(at)};
 const prepared=await prepareAutomationScheduler(cwd,entry,minutes),job=await loadSchedulerJob(prepared.id);job.goal=binding;validateScheduledBindings(job);await writeJson(join(folder(job),'job.json'),job);await refreshSchedulerDefinitions(job);
 return {...prepared,mode:'approved-goal-once',goal:binding,budget:run.budget,originalSessionId:run.sessionId,explicitPaidModelOptIn:true,installed:false};
}
export async function prepareScheduledBackup(cwd:string,entry:string,maxRuns:number,confirmed:boolean,minutes=60,at?:string){
 if(!confirmed)throw new Error('Scheduled committed-history uploads require explicit --confirm');
 const config=await loadConfig(cwd),configuration=backupConfiguration(config);
 if(!Number.isSafeInteger(maxRuns)||maxRuns<1||maxRuns>20)throw new Error('Invalid bounded backup run limit');
 const binding:ScheduledBackupBinding={configuration,authority:await authoritySnapshot(cwd),...await backupRepository(cwd,config),maxRuns,notBefore:instant(at)};
 validateScheduledBindings({backup:binding} as SchedulerJob);
 const prepared=await prepareAutomationScheduler(cwd,entry,minutes),job=await loadSchedulerJob(prepared.id);job.backup=binding;await writeJson(join(folder(job),'job.json'),job);await refreshSchedulerDefinitions(job);
 return {...prepared,mode:'bounded-recovery-backup',backup:binding,containsCommittedHistory:true,uploaded:false,installed:false};
}
export async function inspectScheduledWorkflows(id:string){const job=await loadSchedulerJob(id),rows=await claims(job);return {id,mode:job.goal?'approved-goal-once':job.backup?'bounded-recovery-backup':'not-workflow',goal:job.goal,backup:job.backup,runs:rows,expectedDigest:digest(rows),automaticUnknownReplay:false};}
/** Called only under scheduler tick.lock. Write-ahead claims are deliberately
 * never refunded or replayed after an ambiguous launcher/push interruption. */
export async function tickScheduledWorkflow(job:SchedulerJob):Promise<SchedulerTickResult>{
 validateScheduledBindings(job);const rows=await claims(job),binding=job.goal??job.backup;if(!binding)throw new Error('Not a scheduled workflow');
 if(rows.some(row=>['claimed','unknown'].includes(row.phase)))return {delivered:0,unknownOutcomeRetained:true,automaticExternalReplay:false};
 if(Date.parse(binding.notBefore)>Date.now())return {delivered:0,notDue:true};
 await assertAuthorityUnchanged(job.cwd,binding.authority);
 if(job.goal){
  if(rows.length)return {delivered:0,goalRunId:job.goal.id,launched:false};
  const run=await inspectGoalWorkflow(job.cwd,job.goal.id);if(run.phase!=='ready'||run.version!==job.goal.expectedVersion)throw new Error('Scheduled Goal version/state changed; review a new schedule');
  const row:Claim={id:digest(job.goal),at:new Date().toISOString(),phase:'claimed'};rows.push(row);await writeJson(receipt(job),rows);
  try{await assertAuthorityUnchanged(job.cwd,binding.authority);await launchGoalWorkflow(job.cwd,job.goal.id,job.goal.expectedVersion,job.entry);row.phase='launched';await writeJson(receipt(job),rows);return {delivered:0,goalRunId:job.goal.id,launched:true,automaticExternalReplay:false};}
  catch(error){row.phase='unknown';row.error=redactModelDiagnostic(String(error)).slice(0,4000);await writeJson(receipt(job),rows);throw error;}
 }
 const backup=job.backup!;if(rows.length>=backup.maxRuns)return {delivered:0,budgetExhausted:true};
 if(rows.length&&Date.now()-Date.parse(rows.at(-1)!.at)<job.minutes*60000)return {delivered:0,notDue:true};
 const config=await loadConfig(job.cwd);if(backupConfiguration(config)!==backup.configuration)throw new Error('Scheduled backup policy/deployment changed');await backupBoundary(job,config);await backupRepository(job.cwd,config);
 if(!(await listWorktreeRecoveries(job.cwd,config)).length)return {delivered:0,notDue:true};
 const plan=await prepareRecoveryRemote(job.cwd,true,config),row:Claim={id:digest([job.id,rows.length,plan.id]),backupId:plan.id,at:new Date().toISOString(),phase:'claimed'};rows.push(row);await writeJson(receipt(job),rows);
 try{const result=await withExecutionBoundary(()=>backupBoundary(job,config),()=>runRecoveryRemote(job.cwd,plan.id,plan.digest,true,config));row.phase=result.phase==='completed'?'completed':'unknown';await writeJson(receipt(job),rows);return {delivered:0,backupId:plan.id,backupCompleted:row.phase==='completed',automaticExternalReplay:false};}
 catch(error){row.phase='unknown';row.error=redactModelDiagnostic(String(error)).slice(0,4000);await writeJson(receipt(job),rows);throw error;}
}
export async function reconcileScheduledBackup(id:string,expectedDigest:string,confirmed:boolean){
 if(!confirmed)throw new Error('Scheduled backup reconciliation requires --confirm');const initial=await loadSchedulerJob(id);
 return withFileLock(join(folder(initial),'tick.lock'),async()=>{const job=await loadSchedulerJob(id),rows=await claims(job);if(!job.backup||digest(rows)!==expectedDigest)throw new Error('Refresh the exact scheduled backup ledger before deciding');
  const config=await loadConfig(job.cwd);if(backupConfiguration(config)!==job.backup.configuration)throw new Error('Backup binding changed');
  for(const row of rows.filter(row=>['claimed','unknown'].includes(row.phase))){if(!row.backupId)throw new Error('Unknown claim has no connector receipt; retain for manual verification');const result=await queryRecoveryRemote(job.cwd,row.backupId,true,config);if(result.phase==='completed'){row.phase='completed';delete row.error;await writeJson(receipt(job),rows);}}
  return inspectScheduledWorkflows(id);
 });
}
