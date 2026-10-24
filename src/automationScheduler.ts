import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { homeStateDir, projectStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson, atomicWriteFile } from './storage.js';
import { dueWakeups, deliverPendingWakeups } from './automation.js';
import { loadSession } from './sessions.js';
import { listAgents } from './agent.js';
import { isWorkspaceTrusted } from './workspaceTrust.js';
import { repairAutomationState } from './automationRecovery.js';
const run = promisify(execFile);
export interface SchedulerJob { version: 1; id: string; cwd: string; home: string; runtime: string; entry: string; entrySha256?:string; minutes: number; repairCorrupt: boolean; enabled: boolean; platform?:'win32'|'linux'|'darwin'; manager?:import('./schedulerManager.js').SchedulerManagerBinding; readOnly?: import('./readOnlyAutomation.js').ReadOnlyAutomationLimits; goal?:import('./scheduledWorkflows.js').ScheduledGoalBinding; backup?:import('./scheduledWorkflows.js').ScheduledBackupBinding }
const checkId = (id: string) => { if (!/^scheduler_[a-f0-9]{16}$/.test(id)) throw new Error('Invalid scheduler ID'); };
const folder = (id: string) => { checkId(id); return join(homeStateDir(), 'schedulers', id); };
const same = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
const xml = (value: string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const quote = (value: string) => { if (/[\r\n\0"]/.test(value) || value.endsWith('\\')) throw new Error('Unsupported scheduler argument'); return `"${value}"`; };
async function schedulerEntryDigest(entry:string){const info=await lstat(entry);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw new Error('Scheduler entry must be a non-link regular file up to 32 MiB');const bytes=await readFile(entry);if(bytes.length>32*1024*1024)throw new Error('Scheduler entry grew beyond bounds');return createHash('sha256').update(bytes).digest('hex');}
async function verifyEntry(job:SchedulerJob){if(!job.entrySha256)throw new Error('Legacy scheduler entry is unbound; use automation migration-preview/migrate before execution');if(await schedulerEntryDigest(job.entry)!==job.entrySha256)throw new Error('Scheduler CLI entry changed; prepare/review a new job before execution');}

export function schedulerTaskXml(job: SchedulerJob): string {
  checkId(job.id);
  if (!Number.isSafeInteger(job.minutes) || job.minutes < 1 || job.minutes > 1440) throw new Error('Scheduler interval must be 1–1440 minutes');
  const args = [job.entry, '_automation_tick', job.id, '--state-home', job.home].map(quote).join(' ');
  const username = `${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${userInfo().username}`;
  const mode=job.goal?'one approved Goal workflow; explicit paid-model opt-in':job.backup?'bounded committed-history backup; explicit upload opt-in':job.readOnly?'bounded read-only Agent; explicit paid-model opt-in':'context delivery only; no model/tool execution';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>CCPT ${job.id}; ${mode}</Description></RegistrationInfo><Triggers><TimeTrigger><StartBoundary>${new Date(Date.now()+60000).toISOString()}</StartBoundary><Repetition><Interval>PT${job.minutes}M</Interval></Repetition><Enabled>true</Enabled></TimeTrigger></Triggers><Principals><Principal id="Author"><UserId>${xml(username)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT2M</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context="Author"><Exec><Command>${xml(job.runtime)}</Command><Arguments>${xml(args)}</Arguments><WorkingDirectory>${xml(job.cwd)}</WorkingDirectory></Exec></Actions></Task>\n`;
}
export async function prepareAutomationScheduler(cwd: string, entry: string, minutes = 5, repairCorrupt = false) {
  if (!await isWorkspaceTrusted(cwd)) throw new Error('Trust this workspace before preparing OS automation');
  for (const file of [process.execPath, resolve(entry)]) if (!(await lstat(file)).isFile()) throw new Error('Scheduler runtime/entry must be real files');
  if(!['win32','linux','darwin'].includes(process.platform))throw new Error('Unsupported scheduler host');
  const job: SchedulerJob = { version: 1, id: createId('scheduler'), cwd: resolve(cwd), home: homeStateDir(), runtime: process.execPath, entry: resolve(entry), minutes, repairCorrupt, enabled: true,platform:process.platform as 'win32'|'linux'|'darwin' };
  job.entrySha256=await schedulerEntryDigest(job.entry);
  if(process.platform==='linux'||process.platform==='darwin')job.manager=await(await import('./schedulerManager.js')).bindSchedulerManager(await(await import('./config.js')).loadConfig(cwd),process.platform);
  const definition = schedulerTaskXml(job), directory = folder(job.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeJson(join(directory, 'job.json'), job); await atomicWriteFile(join(directory, 'task.xml'), definition);
  await refreshSchedulerDefinitions(job);
  const definitionName=process.platform==='win32'?'task.xml':Object.keys((await import('./nativeSchedulers.js')).nativeSchedulerDefinitions(job,process.platform as 'linux'|'darwin'))[0]!;
  return { id: job.id, taskName: `CCPT-${job.id}`, definition: join(directory, definitionName), installed: false, mode: 'context-delivery-only', modelsExecuted: false };
}
export async function refreshSchedulerDefinitions(job:SchedulerJob) {
  if(!job.platform||job.platform==='win32'){await atomicWriteFile(join(folder(job.id),'task.xml'),schedulerTaskXml(job));return;}
  const {nativeSchedulerDefinitions}=await import('./nativeSchedulers.js');for(const [name,contents]of Object.entries(nativeSchedulerDefinitions(job,job.platform)))await atomicWriteFile(join(folder(job.id),name),contents);
}
export async function loadSchedulerJob(id: string): Promise<SchedulerJob> {
  for (const path of [join(homeStateDir(),'schedulers'),folder(id),join(folder(id),'job.json')]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (path.endsWith('job.json') ? !info.isFile() || info.size > 32000 : !info.isDirectory())) throw new Error('Invalid scheduler state path/size');
  }
  const job = await readJson<SchedulerJob | undefined>(join(folder(id), 'job.json'), undefined);
  if (!job || job.version !== 1 || job.id !== id || ![job.home,job.cwd,job.runtime,job.entry].every(path=>typeof path === 'string' && path.length < 8000 && isAbsolute(path) && !/[\r\n\0"]/.test(path)) || !same(job.home, homeStateDir()) || typeof job.enabled !== 'boolean' || typeof job.repairCorrupt !== 'boolean') throw new Error('Invalid scheduler job');
  schedulerTaskXml(job);
  if(job.readOnly){const {validateReadOnlyLimits}=await import('./readOnlyAutomation.js');validateReadOnlyLimits(job.readOnly);}
  if(job.platform!==undefined&&!['win32','linux','darwin'].includes(job.platform))throw new Error('Invalid scheduler platform');
  if(job.entrySha256!==undefined&&!/^[a-f0-9]{64}$/.test(job.entrySha256))throw new Error('Invalid scheduler entry digest');
  if(job.manager&&(!isAbsolute(job.manager.path)||!/^[a-f0-9]{64}$/.test(job.manager.sha256)||/[\r\n\0]/.test(job.manager.path)||job.manager.path.length>8000))throw new Error('Invalid scheduler manager binding');
  (await import('./scheduledWorkflows.js')).validateScheduledBindings(job);
  return {version:1,id:job.id,cwd:job.cwd,home:job.home,runtime:job.runtime,entry:job.entry,...(job.entrySha256?{entrySha256:job.entrySha256}:{}),minutes:job.minutes,repairCorrupt:job.repairCorrupt,enabled:job.enabled,...(job.platform?{platform:job.platform}:{}),...(job.manager?{manager:job.manager}:{}),...(job.readOnly ? {readOnly:job.readOnly} : {}),...(job.goal?{goal:job.goal}:{}),...(job.backup?{backup:job.backup}:{})};
}
export async function installAutomationScheduler(id: string, confirmed: boolean) {
  if (!confirmed) throw new Error('OS scheduler registration requires --confirm');
  const job = await loadSchedulerJob(id);
  await verifyEntry(job);
  if((job.platform??'win32')!==process.platform)throw new Error('Scheduler definition belongs to a different OS; prepare it on the target host');
  if (!await isWorkspaceTrusted(job.cwd)) throw new Error('Scheduler workspace trust was revoked');
  if(process.platform!=='win32'){const {installNativeScheduler}=await import('./nativeSchedulers.js');return installNativeScheduler(job);}
  // Rebuild from validated fields, never install an edited arbitrary XML action.
  await atomicWriteFile(join(folder(id), 'task.xml'), schedulerTaskXml(job));
  await run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/schtasks.exe'), ['/Create','/TN',`CCPT-${id}`,'/XML',join(folder(id), 'task.xml')], { windowsHide: true, timeout: 15000, maxBuffer: 64000 });
  return { id, installed: true, currentUserOnly: true, mode: job.goal?'approved-goal-once':job.backup?'bounded-recovery-backup':job.readOnly?'read-only-agent':'context-delivery-only' };
}
export async function disableAutomationScheduler(id: string, confirmed: boolean) {
  if (!confirmed) throw new Error('Scheduler disable requires --confirm');
  return withFileLock(join(folder(id),'tick.lock'),async()=>{
  const job = await loadSchedulerJob(id); job.enabled = false; await writeJson(join(folder(id), 'job.json'), job);
  // Persisted revocation makes future ticks inert even if OS task removal is unavailable.
  return { id, enabled: false, osTaskRetained: true, action: 'The owned task is inert; remove it in Windows Task Scheduler if no longer needed.' };
  });
}
/** Default ticks only deliver context. Paid Goal and history-upload modes need
 * separately prepared, bound opt-ins; no tick invents approvals or retries. */
export interface SchedulerTickResult { delivered: number; disabled?: boolean; repaired?: boolean; pendingWorkPaused?: boolean; automaticExternalReplay?: boolean; modelsExecuted?: boolean; busy?: number; invalid?: number; readOnlyRunId?:string; budgetExhausted?:boolean; unknownOutcomeRetained?:boolean; goalRunId?:string; launched?:boolean; backupId?:string; backupCompleted?:boolean; notDue?:boolean }
export async function tickAutomationScheduler(id: string): Promise<SchedulerTickResult> {
  let job = await loadSchedulerJob(id);
  if (!job.enabled) return { delivered: 0, disabled: true };
  if (!await isWorkspaceTrusted(job.cwd)) throw new Error('Scheduler workspace trust was revoked');
  return withFileLock(join(folder(id), 'tick.lock'), async () => {
    job = await loadSchedulerJob(id);
    if (!job.enabled) return {delivered:0,disabled:true};
    await verifyEntry(job);
    if(job.goal||job.backup){const result=await(await import('./scheduledWorkflows.js')).tickScheduledWorkflow(job);await writeJson(join(folder(id),'last-result.json'),result);return result;}
    let due;
    try { due = (await dueWakeups(Date.now(), job.cwd)).filter(item => item.jobId === job.id || item.jobId === undefined); }
    catch (error) {
      if (!job.repairCorrupt) throw error;
      const preview = await repairAutomationState(job.cwd);
      if (!preview.repaired) await repairAutomationState(job.cwd, { confirm: true, expectedDigest: preview.expectedDigest });
      const result = { delivered: 0, repaired: true, pendingWorkPaused: true, automaticExternalReplay: false };
      await writeJson(join(folder(id), 'last-result.json'), result); return result;
    }
    let delivered = 0, busy = 0, invalid = 0;
    if(job.readOnly){const {tickReadOnlyAutomation}=await import('./scheduledAgent.js');const result=await tickReadOnlyAutomation(job,due);await writeJson(join(folder(id),'last-result.json'),result);return result;}
    for (const sessionId of [...new Set(due.slice(0,200).map(item => item.sessionId))]) {
      if (!/^session_[a-f0-9]{16}$/.test(sessionId)) { invalid++; continue; }
      await withFileLock(join(homeStateDir(), 'locks/agents.lock'), async () => {
        if ((await listAgents()).some(agent => agent.sessionId === sessionId && ['queued','working','waiting_for_input'].includes(agent.status))) { busy++; return; }
        const session = await loadSession(sessionId);
        if (!same(session.cwd, job.cwd)) { invalid++; return; }
        delivered += await deliverPendingWakeups(job.cwd, session, Date.now(), { jobId: job.id });
        delivered += await deliverPendingWakeups(job.cwd, session); // Legacy unbound context, never another job's queue.
      });
    }
    const result = { delivered, busy, invalid, automaticExternalReplay: false, modelsExecuted: false };
    await writeJson(join(folder(id), 'last-result.json'), result); return result;
  });
}
