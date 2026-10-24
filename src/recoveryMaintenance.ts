import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import type {PlatformConfig} from './types.js';
import {projectStateDir} from './paths.js';
import {protectPath,executeCommand} from './policy.js';
import {listWorktreeRecoveries} from './worktree.js';
import {createRecoveryBackup} from './recoveryBackup.js';
import {safePluginStatePath} from './pluginHistory.js';
import {withFileLock,writeJson,createId} from './storage.js';
import {isWorkspaceTrusted} from './workspaceTrust.js';
import {audit} from './audit.js';
import {bindLauncher,type LauncherBinding} from './launcherBinding.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const managed=/^refs\/ccpt\/recovery\/agent_[a-f0-9]{16}\/save_[a-f0-9]{16}$/;
const oid=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const state=(cwd:string)=>join(projectStateDir(cwd),'recovery-maintenance');
const receiptPath=(cwd:string,ref:string)=>join(state(cwd),'refs',hash(ref)+'.json');
async function read<T>(cwd:string,path:string):Promise<T>{await safePluginStatePath(cwd,path);const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>128000)throw new Error('Invalid recovery maintenance state');const bytes=await readFile(path);if(bytes.length>128000)throw new Error('Recovery state exceeds bounds');return JSON.parse(bytes.toString('utf8')) as T;}
async function authority(cwd:string,config:PlatformConfig){protectPath(resolve(cwd),config);if(config.policy.mode==='restricted'||!await isWorkspaceTrusted(cwd))throw new Error('Recovery maintenance requires a trusted workspace and command permissions');await safePluginStatePath(cwd,state(cwd));}
export async function recordRecoveryAge(cwd:string,ref:string,commit:string){
 if(!managed.test(ref)||!oid.test(commit))throw new Error('Invalid managed recovery identity');const path=receiptPath(cwd,ref);await safePluginStatePath(cwd,path);await withFileLock(path+'.lock',async()=>{try{const old=await read<{ref:string;commit:string}>(cwd,path);if(old.ref!==ref||old.commit!==commit)throw new Error('Recovery age receipt changed');return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await writeJson(path,{format:1,ref,commit,createdAt:new Date().toISOString()});});
}
export async function planRecoveryMaintenance(cwd:string,config:PlatformConfig){
 const policy=config.recoveryMaintenance;if(!policy?.enabled)throw new Error('Explicit recoveryMaintenance.enabled is required');
 if(!Number.isSafeInteger(policy.retentionDays)||policy.retentionDays<1||policy.retentionDays>3650||!Number.isSafeInteger(policy.minKeep)||policy.minKeep<1||policy.minKeep>128||!Number.isSafeInteger(policy.maxPrunePerRun)||policy.maxPrunePerRun<1||policy.maxPrunePerRun>32)throw new Error('Invalid recovery retention bounds');
 const refs=await listWorktreeRecoveries(cwd,config);if(refs.length>128)throw new Error('Recovery maintenance is limited to 128 refs');
 const rows:Array<{ref:string;commit:string;createdAt:string|null;retainer?:{ref:string;commit:string};reason:string}>=[];
 for(const ref of refs){let createdAt:string|null=null;try{const age=await read<{format:number;ref:string;commit:string;createdAt:string}>(cwd,receiptPath(cwd,ref.ref));if(age.format!==1||age.ref!==ref.ref||age.commit!==ref.commit||!Number.isFinite(Date.parse(age.createdAt))||Date.parse(age.createdAt)>Date.now())throw new Error('Invalid recovery age receipt');createdAt=age.createdAt;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}rows.push({...ref,createdAt,reason:createdAt?'retained':'unknown-age'});}
 rows.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'')||a.ref.localeCompare(b.ref));const day=Math.floor(Date.now()/86400000),cutoff=day*86400000-policy.retentionDays*86400000;let selected=0;
 for(let i=0;i<rows.length;i++){const row=rows[i]!;if(!row.createdAt)continue;if(i<policy.minKeep){row.reason='minimum-retained';continue;}if(Date.parse(row.createdAt)>cutoff){row.reason='retention-period';continue;}if(selected>=policy.maxPrunePerRun){row.reason='batch-limit';continue;}
  const keeping=await executeCommand('git',['for-each-ref',`--contains=${row.commit}`,'--format=%(refname) %(objectname)','refs/heads/','refs/tags/'],cwd,config);if(keeping.code!==0)throw new Error('Unable to prove branch/tag retention');const keeper=keeping.stdout.trim().split(/\r?\n/).filter(Boolean).sort()[0];if(!keeper){row.reason='sole-recovery-ref';continue;}const [ref,commit]=keeper.split(' ');if(!ref||!/^refs\/(?:heads|tags)\/[^\s]+$/.test(ref)||!commit||!oid.test(commit))throw new Error('Invalid retaining ref');row.retainer={ref,commit};row.reason='eligible';selected++;
 }
 return {digest:hash({policy,day,rows}),day,policy,rows,candidates:rows.filter(r=>r.reason==='eligible'),automaticNetwork:false};
}
/** Atomic Git transaction verifies BOTH recovery and retaining refs. Complete
 * bundle is published first; old/unknown age is never inferred from commit time. */
export async function runRecoveryMaintenance(cwd:string,expectedDigest:string,confirmed:boolean,config:PlatformConfig){
 if(!confirmed)throw new Error('Recovery maintenance requires explicit confirmation or configured automatic opt-in');await authority(cwd,config);const lock=join(state(cwd),'maintenance.lock');await safePluginStatePath(cwd,lock);
 return withFileLock(lock,async()=>{const plan=await planRecoveryMaintenance(cwd,config);if(plan.digest!==expectedDigest)throw new Error('Recovery plan changed; review again');if(!plan.candidates.length)return {removed:[],backup:null};
  const backup=await createRecoveryBackup(cwd,config,true);const latest=await planRecoveryMaintenance(cwd,config);if(latest.digest!==plan.digest)throw new Error('Recovery refs changed after backup; no refs removed');
  const retainers=new Map(plan.candidates.map(row=>[row.retainer!.ref,row.retainer!.commit]));const input=['start',...[...retainers].map(([ref,commit])=>`verify ${ref} ${commit}`),...plan.candidates.map(row=>`delete ${row.ref} ${row.commit}`),'prepare','commit',''].join('\n');
  await audit({event:'worktree.recovery.retention',outcome:'requested',details:{digest:plan.digest,refs:plan.candidates.length,backup:backup.sha256}});const applied=await executeCommand('git',['update-ref','--stdin'],cwd,config,undefined,input);if(applied.code!==0)throw new Error('Git retention transaction refused; backup retained, refresh refs before retry');await audit({event:'worktree.recovery.retention',outcome:'success',details:{digest:plan.digest,removed:plan.candidates.length,backup:backup.sha256}});return {removed:plan.candidates.map(r=>r.ref),backup:{directory:backup.directory,sha256:backup.sha256},networkRequests:0};
 });
}
interface RemotePlan {format:1;id:string;phase:'prepared'|'unknown'|'completed';remote:string;url:string;sshWrapper?:LauncherBinding;refs:Array<{source:string;commit:string;target:string}>;digest:string}
async function wrapperIdentity(config:PlatformConfig):Promise<LauncherBinding>{return bindLauncher(config.policy.processWrapper,config.recoveryRemote?.launcherDependencies);}
function receiptBinding(plan:RemotePlan){return {remote:plan.remote,expectedUrl:plan.url,...(plan.sshWrapper?{transport:'ssh-wrapper' as const,sshWrapper:plan.sshWrapper}:{})};}
async function remoteBinding(cwd:string,config:PlatformConfig,expected?:RemotePlan){const binding=config.recoveryRemote;if(!binding||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(binding.remote))throw new Error('Configure a pinned recoveryRemote name and expectedUrl');if(binding.transport==='ssh-wrapper'){const identity=await wrapperIdentity(config);if(expected&&hash(identity)!==hash(expected.sshWrapper))throw new Error('Backup SSH wrapper binding changed');}else if(expected?.sshWrapper)throw new Error('Backup SSH transport changed');const found=await executeCommand('git',['remote','get-url','--push','--all',binding.remote],cwd,config);if(found.code!==0||found.stdout.trim()!==binding.expectedUrl)throw new Error('Remote URL changed or has multiple push destinations');
 if(isAbsolute(binding.expectedUrl)){const local=protectPath(resolve(binding.expectedUrl),config);if(await realpath(local)!==local)throw new Error('Local backup destination must not traverse links');}
 else{const url=new URL(binding.expectedUrl);if(url.protocol==='ssh:'){
  if(binding.transport!=='ssh-wrapper'||!url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_.\/-]+$/.test(url.pathname)||!config.policy.allowNetwork||!config.network.allowedHosts.includes(url.hostname))throw new Error('SSH backup requires explicit ssh-wrapper transport, user, literal repository path and allowed host');
  return {remote:binding.remote,expectedUrl:binding.expectedUrl,transport:'ssh-wrapper' as const,sshWrapper:await wrapperIdentity(config)};
 }if(binding.transport||url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Remote backups require pinned HTTPS without embedded credentials or explicit ssh-wrapper');if(!config.policy.allowNetwork||config.network.allowedHosts.length&&!config.network.allowedHosts.includes(url.hostname))throw new Error('Backup remote network is not permitted');}
 if(binding.transport)throw new Error('SSH transport cannot be used with a local/HTTPS backup');return {remote:binding.remote,expectedUrl:binding.expectedUrl};}
export async function prepareRecoveryRemote(cwd:string,confirmed:boolean,config:PlatformConfig){
 if(!confirmed)throw new Error('Preparing a history upload requires --confirm');await authority(cwd,config);if(!config.policy.allowGitPush)throw new Error('Git push is disabled by policy');const binding=await remoteBinding(cwd,config),refs=await listWorktreeRecoveries(cwd,config);if(!refs.length||refs.length>32)throw new Error('Remote backup supports 1–32 exact refs');const id=createId('backup');const rows=refs.map((row,index)=>({source:row.ref,commit:row.commit,target:`refs/ccpt/backups/${id}/${index}`}));const plan:RemotePlan={format:1,id,phase:'prepared',remote:binding.remote,url:binding.expectedUrl,...('sshWrapper' in binding?{sshWrapper:binding.sshWrapper}:{}),refs:rows,digest:hash({binding,rows})};const path=join(state(cwd),'remote',id+'.json');await safePluginStatePath(cwd,path);await writeJson(path,plan);return {...plan,containsCommittedHistory:true,uploaded:false};
}
async function remotePlan(cwd:string,id:string){if(!/^backup_[a-f0-9]{16}$/.test(id))throw new Error('Invalid backup ID');const path=join(state(cwd),'remote',id+'.json'),plan=await read<RemotePlan>(cwd,path);if(plan.format!==1||plan.id!==id||!['prepared','unknown','completed'].includes(plan.phase)||!Array.isArray(plan.refs)||!plan.refs.length||plan.refs.length>32||plan.refs.some((r,i)=>!managed.test(r.source)||!oid.test(r.commit)||r.target!==`refs/ccpt/backups/${id}/${i}`)||plan.sshWrapper!==undefined&&(!plan.sshWrapper||typeof plan.sshWrapper.path!=='string'||!isAbsolute(plan.sshWrapper.path)||!/^[a-f0-9]{64}$/.test(plan.sshWrapper.sha256))||hash({binding:receiptBinding(plan),rows:plan.refs})!==plan.digest)throw new Error('Invalid remote backup receipt');return {path,plan};}
export async function runRecoveryRemote(cwd:string,id:string,expectedDigest:string,confirmed:boolean,config:PlatformConfig){
 if(!confirmed)throw new Error('Uploading committed history requires --confirm');await authority(cwd,config);if(!config.policy.allowGitPush)throw new Error('Git push disabled');const {path}=await remotePlan(cwd,id);return withFileLock(path+'.lock',async()=>{const {plan}=await remotePlan(cwd,id);if(plan.phase!=='prepared'||plan.digest!==expectedDigest)throw new Error('Backup already attempted or stale; unknown effects must be queried, never replayed');const binding=await remoteBinding(cwd,config,plan);if(hash(binding)!==hash(receiptBinding(plan)))throw new Error('Backup deployment binding changed');const current=await listWorktreeRecoveries(cwd,config);for(const row of plan.refs)if(!current.some(r=>r.ref===row.source&&r.commit===row.commit))throw new Error('Recovery source changed; prepare a new reviewed backup');
  const absent=await executeCommand('git',['ls-remote','--refs',plan.url,...plan.refs.map(r=>r.target)],cwd,config);if(absent.code!==0||absent.stdout.trim())throw new Error('Backup target already exists or absence could not be verified; no push attempted');
  await audit({event:'worktree.backup.remote',outcome:'requested',details:{id,digest:plan.digest,refs:plan.refs.length}});plan.phase='unknown';await writeJson(path,plan);
  const pushed=await executeCommand('git',['push','--atomic','--porcelain',...plan.refs.map(r=>`--force-with-lease=${r.target}:`),plan.url,...plan.refs.map(r=>`${r.commit}:${r.target}`)],cwd,config);if(pushed.code!==0)throw new Error('Remote result unknown or rejected; query this receipt, do not replay');
  return reconcileRemoteReceipt(cwd,id,config);
 });
}
async function reconcileRemoteReceipt(cwd:string,id:string,config:PlatformConfig):Promise<RemotePlan>{const {path,plan}=await remotePlan(cwd,id),binding=await remoteBinding(cwd,config,plan);if(hash(binding)!==hash(receiptBinding(plan)))throw new Error('Remote binding changed');if(plan.phase==='prepared')return plan;const result=await executeCommand('git',['ls-remote','--refs',plan.url,...plan.refs.map(r=>r.target)],cwd,config);if(result.code!==0)throw new Error('Remote result remains unknown');const received=result.stdout.trim().split(/\r?\n/).filter(Boolean);if(received.length===plan.refs.length&&plan.refs.every(row=>received.includes(`${row.commit}\t${row.target}`))){plan.phase='completed';await writeJson(path,plan);await audit({event:'worktree.backup.remote',outcome:'success',details:{id,digest:plan.digest,verified:true}});}return plan;}
export async function queryRecoveryRemote(cwd:string,id:string,confirmed:boolean,config:PlatformConfig):Promise<RemotePlan>{
 if(!confirmed)throw new Error('Remote status query requires --confirm');await authority(cwd,config);const {path}=await remotePlan(cwd,id);return withFileLock(path+'.lock',()=>reconcileRemoteReceipt(cwd,id,config));
}
