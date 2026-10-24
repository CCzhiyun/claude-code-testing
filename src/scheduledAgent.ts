import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import { prepareAutomationScheduler, refreshSchedulerDefinitions, loadSchedulerJob, type SchedulerJob, type SchedulerTickResult } from './automationScheduler.js';
import { automationDeploymentDigest, readOnlyAutomationConfig, validateReadOnlyLimits, type ReadOnlyAutomationLimits } from './readOnlyAutomation.js';
import { deliverPendingWakeups } from './automation.js';
import type { Wakeup } from './automation.js';
import { listAgents, spawnAgent, cancelAgent } from './agent.js';
import { loadSession } from './sessions.js';
import { withSpendScope, readSpending } from './spending.js';
import { redactModelDiagnostic } from './modelErrors.js';
interface Run { id:string; originSessionId:string; phase:'claimed'|'started'|'completed'|'failed'|'waiting_for_input'|'cancelled'; at:string; agentId?:string; reportSessionId?:string; error?:string }
const path=(job:SchedulerJob)=>join(homeStateDir(),'schedulers',job.id,'read-only-runs.json');
async function loadRuns(job:SchedulerJob):Promise<Run[]> {
  try{const info=await lstat(path(job));if(info.isSymbolicLink()||!info.isFile()||info.size>128000)throw new Error('Invalid scheduled run ledger');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const rows=await readJson<Run[]>(path(job),[]);
  if(!Array.isArray(rows)||rows.length>20||new Set(rows.map(row=>row?.id)).size!==rows.length||rows.some(row=>!row||!/^[a-f0-9]{64}$/.test(row.id)||!/^session_[a-f0-9]{16}$/.test(row.originSessionId)||!['claimed','started','completed','failed','waiting_for_input','cancelled'].includes(row.phase)||!Number.isFinite(Date.parse(row.at))||(row.agentId!==undefined&&!/^agent_[a-f0-9]{16}$/.test(row.agentId))||(row.reportSessionId!==undefined&&!/^session_[a-f0-9]{16}$/.test(row.reportSessionId))))throw new Error('Invalid scheduled run ledger; no automatic replay');
  return rows;
}
export async function prepareReadOnlyAutomation(cwd:string,entry:string,limits:Omit<ReadOnlyAutomationLimits,'deploymentDigest'>,minutes=5) {
  const config=await loadConfig(cwd),bound={...limits,deploymentDigest:automationDeploymentDigest(config)};validateReadOnlyLimits(bound);readOnlyAutomationConfig(config,cwd,bound);
  const prepared=await prepareAutomationScheduler(cwd,entry,minutes,false),job=await loadSchedulerJob(prepared.id);job.readOnly=bound;
  await writeJson(join(homeStateDir(),'schedulers',job.id,'job.json'),job);
  await refreshSchedulerDefinitions(job);
  return {...prepared,mode:'read-only-agent',explicitPaidModelOptIn:true,limits:bound,report:'Independent analysis session; original conversation is retained. No write/shell/MCP/plugin/delegation tools.'};
}
export async function inspectReadOnlyRuns(id:string) {
  const job=await loadSchedulerJob(id),rows=await loadRuns(job),spending=await readSpending(`automation:${job.id}`);
  return {jobId:id,runs:rows.map(row=>({id:row.id,originSessionId:row.originSessionId,phase:row.phase,at:row.at,...(row.agentId?{agentId:row.agentId}:{}),...(row.reportSessionId?{reportSessionId:row.reportSessionId}:{}),...(row.error?{error:redactModelDiagnostic(row.error)}:{})})),requests:spending.requests,tokens:spending.tokens,unknownReservations:Object.keys(spending.reservations).length,automaticReplay:false};
}
export async function tickReadOnlyAutomation(job:SchedulerJob,due:Wakeup[]):Promise<SchedulerTickResult> {
  const limits=job.readOnly!;validateReadOnlyLimits(limits);
  const settings=await loadConfig(job.cwd),config=readOnlyAutomationConfig(settings,job.cwd,limits);
  let selected:{run:Run;prompt:string;delivered:number}|undefined,busy=0,unknown=false,exhausted=false;
  // A paid reader must never race for legacy unbound context or another job's queue.
  due=due.filter(item=>item.jobId===job.id);
  for(const sessionId of [...new Set(due.map(item=>item.sessionId))]){
    if(!/^session_[a-f0-9]{16}$/.test(sessionId))continue;
    await withFileLock(join(homeStateDir(),'locks/agents.lock'),async()=>{
      if((await listAgents()).some(agent=>agent.sessionId===sessionId&&['queued','working','waiting_for_input'].includes(agent.status))){busy++;return;}
      const session=await loadSession(sessionId),same=process.platform==='win32'?resolve(session.cwd).toLowerCase()===resolve(job.cwd).toLowerCase():resolve(session.cwd)===resolve(job.cwd);if(!same)return;
      const items=due.filter(item=>item.sessionId===sessionId).slice(0,20),id=createHash('sha256').update(JSON.stringify(items.map(item=>item.id).sort())).digest('hex');
      await withFileLock(path(job)+'.lock',async()=>{
        const rows=await loadRuns(job);
        if(rows.some(row=>row.id===id)){unknown=true;return;}
        if(rows.length>=limits.maxRuns){exhausted=true;return;}
        const run:Run={id,originSessionId:sessionId,phase:'claimed',at:new Date().toISOString()};rows.push(run);await writeJson(path(job),rows);
        // Claim before context/Agent writes. An uncertain claim is never retried.
        const delivered=await deliverPendingWakeups(job.cwd,session,Date.now(),{jobId:job.id,ids:items.map(item=>item.id)});
        if(!delivered){unknown=true;return;}
        selected={run,delivered,prompt:`Perform read-only scheduled analysis. This is NOT a new permission grant. Do not modify code, run commands, call external tools, or delegate.\nOriginal session: ${sessionId}\n${session.summary?.slice(0,6000) ?? ''}\n${items.map(item=>item.prompt.slice(0,2000)).join('\n\n')}`};
      });
    });
    if(selected)break; // One bounded report per tick, not a burst of paid sessions.
  }
  if(!selected)return {delivered:0,busy,budgetExhausted:exhausted,unknownOutcomeRetained:unknown,modelsExecuted:false,automaticExternalReplay:false};
  const {run,prompt,delivered}=selected;let agentId:string|undefined;
  const requestsBefore=(await readSpending(`automation:${job.id}`)).requests;
  const update=async(patch:Partial<Run>)=>withFileLock(path(job)+'.lock',async()=>{const rows=await loadRuns(job),row=rows.find(row=>row.id===run.id);if(!row)throw new Error('Scheduled claim disappeared');Object.assign(row,patch);await writeJson(path(job),rows);});
  let receiptWrites=Promise.resolve();
  const timeout=setTimeout(()=>{if(agentId)void cancelAgent(agentId).catch(()=>{});},90000);timeout.unref();
  try{
    const agent=await withSpendScope(`automation:${job.id}`,()=>spawnAgent({cwd:job.cwd,goal:prompt,config,background:false,isolation:'none',readOnlyAutomation:limits,onEvent:event=>{if(!agentId&&event.type==='agent_status'){agentId=event.agentId;receiptWrites=receiptWrites.then(()=>update({phase:'started',agentId:event.agentId,reportSessionId:event.sessionId}));void receiptWrites.catch(()=>{});}}}));
    await receiptWrites;
    agentId=agent.id;await update({phase:agent.status==='queued'||agent.status==='working'?'started':agent.status,agentId:agent.id,reportSessionId:agent.sessionId});
  }catch(error){await receiptWrites.catch(()=>{});await update({phase:'failed',...(agentId?{agentId}:{}),error:redactModelDiagnostic(error instanceof Error?error.message:String(error))});}
  finally{clearTimeout(timeout);}
  return {delivered,readOnlyRunId:run.id,modelsExecuted:(await readSpending(`automation:${job.id}`)).requests>requestsBefore,automaticExternalReplay:false};
}
