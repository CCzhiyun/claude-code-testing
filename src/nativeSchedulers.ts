import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { SchedulerJob } from './automationScheduler.js';
import { homeStateDir } from './paths.js';
import { writeJson } from './storage.js';
import { readUtf8Text } from './textFiles.js';
import {schedulerManagerPath} from './schedulerManager.js';
const run=promisify(execFile),options={windowsHide:true,timeout:15000,maxBuffer:128000};
export type NativeSchedulerPlatform='linux'|'darwin';
const label=(job:SchedulerJob)=>{if(!/^scheduler_[a-f0-9]{16}$/.test(job.id))throw new Error('Invalid scheduler ID');return `ccpt-${job.id}`;};
function unit(value:string,exec=false):string {
  if(typeof value!=='string'||/[\r\n\0]/.test(value)||value.length>8000)throw new Error('Invalid native scheduler argument');
  let text=value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%');if(exec)text=text.replaceAll('$',()=> '$$');return '"'+text+'"';
}
function xml(value:string):string {if(/[\r\n\0]/.test(value))throw new Error('Invalid native scheduler argument');return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
export function nativeSchedulerDefinitions(job:SchedulerJob,platform:NativeSchedulerPlatform):Record<string,string> {
  const name=label(job);if(!Number.isSafeInteger(job.minutes)||job.minutes<1||job.minutes>1440)throw new Error('Invalid scheduler interval');
  const args=[job.runtime,job.entry,'_automation_tick',job.id,'--state-home',job.home];
  if(platform==='linux')return {
    [name+'.service']:`[Unit]\nDescription=CCPT owned bounded scheduler ${job.id}\n[Service]\nType=oneshot\nExecStart=${args.map(arg=>unit(arg,true)).join(' ')}\nWorkingDirectory=${unit(job.cwd)}\nNoNewPrivileges=true\nUMask=0077\nTimeoutStartSec=120\n`,
    [name+'.timer']:`[Unit]\nDescription=CCPT owned timer ${job.id}\n[Timer]\nOnStartupSec=60s\nOnUnitActiveSec=${job.minutes}min\nAccuracySec=1s\nUnit=${name}.service\n[Install]\nWantedBy=timers.target\n`,
  };
  if(platform!=='darwin')throw new Error('Unsupported native scheduler platform');
  return {[name+'.plist']:`<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${args.map(arg=>`<string>${xml(arg)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(job.cwd)}</string><key>StartInterval</key><integer>${job.minutes*60}</integer><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>ProcessType</key><string>Background</string></dict></plist>\n`};
}
function host(job:SchedulerJob):NativeSchedulerPlatform {
  if(!['linux','darwin'].includes(process.platform)||job.platform!==process.platform||!process.getuid||process.getuid()===0)throw new Error('Native scheduler requires the matching non-root current-user host');return process.platform as NativeSchedulerPlatform;
}
async function destination(platform:NativeSchedulerPlatform,create:boolean):Promise<string> {
  const segments=platform==='linux'?['.config','systemd','user']:['Library','LaunchAgents'];let path=homedir();
  for(const part of segments){path=join(path,part);if(create)await mkdir(path,{recursive:false,mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Native scheduler directory must be real, not a link');}return path;
}
const receipt=(job:SchedulerJob)=>join(homeStateDir(),'schedulers',job.id,'native-registration.json');
interface NativeReceipt {format?:number;phase?:string;platform?:string;nonce?:string;files?:string[]}
async function readReceipt(job:SchedulerJob):Promise<NativeReceipt|null>{
 const path=receipt(job);
 for(const parent of [homeStateDir(),join(homeStateDir(),'schedulers'),join(homeStateDir(),'schedulers',job.id)]){const info=await lstat(parent);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Native receipt parent must be a real directory');}
 try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>64000)throw new Error('Invalid native scheduler receipt');return JSON.parse(await readUtf8Text(path,64000)) as NativeReceipt;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
function ownedDefinitions(job:SchedulerJob,platform:NativeSchedulerPlatform,nonce?:string){
 const definitions=nativeSchedulerDefinitions(job,platform);if(nonce===undefined)return definitions;
 if(!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Invalid scheduler ownership nonce');
 return Object.fromEntries(Object.entries(definitions).map(([name,contents])=>[name,platform==='linux'?`# CCPT transaction ${nonce}\n${contents}`:contents.replace('?>','?>\n<!-- CCPT transaction '+nonce+' -->')]));
}
async function verifyFiles(job:SchedulerJob,platform:NativeSchedulerPlatform):Promise<string[]> {
  const state=await readReceipt(job);
  const directory=await destination(platform,false),definitions=ownedDefinitions(job,platform,state?.nonce),files:string[]=[];
  for(const [name,contents]of Object.entries(definitions)){const path=join(directory,name),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>64000||await readFile(path,'utf8')!==contents)throw new Error('Native scheduler files differ from the owned definition; no manager action was issued');files.push(path);}return files;
}
export async function installNativeScheduler(job:SchedulerJob) {
  const platform=host(job),directory=await destination(platform,true),nonce=randomBytes(16).toString('hex'),definitions=ownedDefinitions(job,platform,nonce),files:string[]=[];
  const prior=await readReceipt(job);
  if(prior&&prior.phase!=='removed')throw new Error('Native registration already exists or is interrupted; inspect it instead of overwriting its receipt');
  await writeJson(receipt(job),{format:2,nonce,phase:'preparing',platform,at:new Date().toISOString()});
  try{
    // Exclusive creation: never overwrite another unit/plist, even if its name matches.
    for(const [name,contents]of Object.entries(definitions)){const path=join(directory,name);await writeFile(path,contents,{flag:'wx',mode:0o600});files.push(path);}
    if(platform==='linux'){await run(await schedulerManagerPath(job),['--user','daemon-reload'],options);await run(await schedulerManagerPath(job),['--user','enable','--now',label(job)+'.timer'],options);}
    else await run(await schedulerManagerPath(job),['bootstrap',`gui/${process.getuid!()}`,files[0]!],options);
    await writeJson(receipt(job),{format:2,nonce,phase:'installed',platform,files,at:new Date().toISOString()});return {id:job.id,installed:true,currentUserOnly:true,platform,mode:job.goal?'approved-goal-once':job.backup?'bounded-recovery-backup':job.readOnly?'read-only-agent':'context-delivery-only'};
  }catch{await writeJson(receipt(job),{format:2,nonce,phase:'interrupted',platform,files,at:new Date().toISOString(),action:'Inspect owned files and manager state; explicit CAS recovery is available for nonce-bound files.'});throw new Error('Native scheduler registration failed; retained receipt/files for explicit inspection. No automatic retry.');}
}
export async function inspectNativeScheduler(job:SchedulerJob) {
  const platform=host(job),files=await verifyFiles(job,platform);
  if(platform==='linux'){
    for(const suffix of ['.timer','.service']){const value=await run(await schedulerManagerPath(job),['--user','show',label(job)+suffix,'--property=FragmentPath','--value'],options);if(value.stdout.trim()!==files.find(path=>path.endsWith(suffix)))throw new Error('Native manager definition origin is not owned');}
  }else{
    const state=await run(await schedulerManagerPath(job),['print',`gui/${process.getuid!()}/${label(job)}`],options);
    if(!state.stdout.split(/\r?\n/).some(line=>line.trim()===`path = ${files[0]}`||line.trim()===`path = "${files[0]}"`))throw new Error('Native manager origin could not be verified');
  }
  return {platform,files,registration:'owned-definition-verified'};
}
export async function uninstallNativeScheduler(job:SchedulerJob) {
  const platform=host(job),state=await readReceipt(job);
  if(!state||state.phase!=='installed')throw new Error('Native registration is incomplete/unknown; inspect retained files/receipt instead of automatic removal');
  const {files}=await inspectNativeScheduler(job);
  if(platform==='linux')await run(await schedulerManagerPath(job),['--user','disable','--now',label(job)+'.timer'],options);
  else await run(await schedulerManagerPath(job),['bootout',`gui/${process.getuid!()}`,files[0]!],options);
  await verifyFiles(job,platform);for(const file of files){const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('Native scheduler file changed; retained');await unlink(file);}
  if(platform==='linux')await run(await schedulerManagerPath(job),['--user','daemon-reload'],options);
  await writeJson(receipt(job),{phase:'removed',platform,at:new Date().toISOString(),retainedState:true});return {id:job.id,enabled:false,osTaskRemoved:true,retainedState:true,platform};
}

/** Pure decision function used by both real-host recovery and boundary tests.
 * Legacy receipts lack ownership proof and are deliberately not adopted. */
export function nativeRecoveryPreview(job:SchedulerJob,state:NativeReceipt,files:Record<string,string|null>){
 if(state.format!==2||!state.nonce||state.platform!==job.platform||!['preparing','interrupted','recovering'].includes(state.phase??''))throw new Error('Native receipt is not recoverable; legacy/unknown ownership requires manual inspection');
 const definitions=ownedDefinitions(job,job.platform as NativeSchedulerPlatform,state.nonce),expected=Object.keys(definitions).sort();
 if(Object.keys(files).some(name=>!expected.includes(name)))throw new Error('Unknown native recovery file');
 for(const name of expected)if(files[name]!==null&&files[name]!==definitions[name])throw new Error('Native recovery found foreign or changed bytes; nothing will be removed');
 const existing=expected.filter(name=>files[name]!==null),digest=createHash('sha256').update(JSON.stringify([job.id,job.manager??null,job.entrySha256??null,job.enabled,state.phase,state.nonce,expected.map(name=>[name,files[name]])])).digest('hex');
 return {id:job.id,expectedDigest:digest,existing,missing:expected.filter(name=>files[name]===null),automaticReplay:false,action:'Disable the job, verify manager origin, remove only nonce-bound bytes, retain all local state. Then explicitly prepare/install again.'};
}
export async function recoverNativeScheduler(job:SchedulerJob,expectedDigest:string,confirmed:boolean){
 const platform=host(job),directory=await destination(platform,false);
 const inspect=async()=>{
  const state=await readReceipt(job);if(!state)throw new Error('Native receipt missing');
  const files:Record<string,string|null>={};
  for(const name of Object.keys(nativeSchedulerDefinitions(job,platform))){const path=join(directory,name);try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>64000)throw new Error('Invalid native recovery file');files[name]=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;files[name]=null;}}
  return {state,files,preview:nativeRecoveryPreview(job,state,files)};
 };
 const initial=await inspect();if(!confirmed)return {...initial.preview,recovered:false};
 if(initial.preview.expectedDigest!==expectedDigest)throw new Error('Native recovery state changed; inspect a fresh digest');
 // Revocation precedes any OS manager mutation. A partial rollback remains inert.
 job.enabled=false;await writeJson(join(homeStateDir(),'schedulers',job.id,'job.json'),job);
 await writeJson(receipt(job),{...initial.state,phase:'recovering'});
 if(platform==='linux'){
  let registered=false;
  for(const suffix of ['.service','.timer']){const result=await run(await schedulerManagerPath(job),['--user','show',label(job)+suffix,'--property=FragmentPath','--value'],options),origin=result.stdout.trim();if(origin&&origin!==join(directory,label(job)+suffix))throw new Error('Manager origin is foreign; retained nonce-bound files');if(origin)registered=true;}
  if(registered)await run(await schedulerManagerPath(job),['--user','disable','--now',label(job)+'.timer'],options);
 }else{
  const listing=await run(await schedulerManagerPath(job),['list'],options);
  if(listing.stdout.split(/\r?\n/).some(line=>line.trim().split(/\s+/).at(-1)===label(job))){
   await inspectNativeScheduler(job);await run(await schedulerManagerPath(job),['bootout',`gui/${process.getuid!()}`,join(directory,label(job)+'.plist')],options);
  }
 }
 const current=await inspect();
 for(const name of current.preview.existing){
  // Recheck bytes immediately before removing this exact, owned file.
  const path=join(directory,name),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>64000||await readUtf8Text(path,64000)!==current.files[name])throw new Error('Native file changed during recovery; retained');await unlink(path);
 }
 if(platform==='linux')await run(await schedulerManagerPath(job),['--user','daemon-reload'],options);
 await writeJson(receipt(job),{...current.state,phase:'removed',at:new Date().toISOString(),recovered:true});
 return {id:job.id,recovered:true,enabled:false,retainedState:true,automaticReplay:false};
}
