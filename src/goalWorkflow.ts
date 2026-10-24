import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createId, withFileLock, writeJson } from './storage.js';
import { readUtf8Text } from './textFiles.js';
import { projectStateDir, homeStateDir } from './paths.js';
import { listSessionGoals, transitionSessionGoal } from './automation.js';
import { scopedSession } from './sessionHistoryView.js';
import { loadProjectPlan, transitionProjectPlan } from './plans.js';
import { executeProjectPlan } from './planExecution.js';
import { loadPlatform } from './platform.js';
import { loadAgent, cancelAgent, listAgents, reconcileExecutionOwner } from './agent.js';
import { applyWorkflowBudget, workflowPolicyDigest, type WorkflowBudget } from './workflowBudget.js';
import { automationDeploymentDigest } from './readOnlyAutomation.js';
import { grantPermissionOnce, parsePermissionRequest } from './permissionApprovals.js';
import { sanitizedEnvironment } from './environment.js';
import { toolRegistry } from './tooling.js';
import { readSpending } from './spending.js';
import { redactModelDiagnostic } from './modelErrors.js';
import { isWorkspaceTrusted } from './workspaceTrust.js';
import { sessionOwner } from './sessionRecovery.js';

interface GoalRun { id:string; version:number; goalId:string; planId:string; planHash:string; sessionId:string; budget:WorkflowBudget; phase:'ready'|'running'|'waiting'|'completed'|'failed'|'unknown'|'cancelled'; attempts:number; maxAttempts:number; agentId?:string; updatedAt:string; reason?:string; pendingFeedback?:string }
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function path(cwd:string,id:string){if(!/^goalrun_[a-f0-9]{16}$/.test(id))throw new Error('Invalid Goal run ID');return join(projectStateDir(cwd),'goal-runs',`${id}.json`);}
async function load(cwd:string,id:string):Promise<GoalRun>{
 const file=path(cwd,id);for(const p of [projectStateDir(cwd),join(projectStateDir(cwd),'goal-runs'),file]){const stat=await lstat(p);if(stat.isSymbolicLink()||(p===file? !stat.isFile()||stat.size>128000:!stat.isDirectory()))throw new Error('Invalid Goal run path');}
 const row=JSON.parse(await readUtf8Text(file,128000)) as GoalRun;
 if(row.id!==id||!Number.isSafeInteger(row.version)||row.version<1||!/^goal_[a-f0-9]{16}$/.test(row.goalId)||!/^plan_[a-f0-9]{16}$/.test(row.planId)||!/^session_[a-f0-9]{16}$/.test(row.sessionId)||!/^[a-f0-9]{64}$/.test(row.planHash)||!['ready','running','waiting','completed','failed','unknown','cancelled'].includes(row.phase)||!Number.isSafeInteger(row.attempts)||row.attempts<0||!Number.isSafeInteger(row.maxAttempts)||row.maxAttempts<1||row.maxAttempts>20||row.attempts>row.maxAttempts||row.budget?.runId!==row.id||row.agentId!==undefined&&!/^agent_[a-f0-9]{16}$/.test(row.agentId))throw new Error('Invalid Goal run state');return row;
}
async function mutate(cwd:string,id:string,version:number,action:(row:GoalRun)=>void|Promise<void>){
 await load(cwd,id);
 return withFileLock(path(cwd,id)+'.lock',async()=>{const row=await load(cwd,id);if(row.version!==version)throw new Error('Goal run changed; refresh before deciding');await action(row);row.version++;row.updatedAt=new Date().toISOString();await writeJson(path(cwd,id),row);return row;});
}
async function validate(cwd:string,row:GoalRun){
 if(!await isWorkspaceTrusted(cwd))throw new Error('Goal workflow requires current workspace trust');
 const goal=(await listSessionGoals(row.sessionId,cwd)).find(goal=>goal.id===row.goalId);
 if(!goal||goal.status!=='active')throw new Error('Goal is paused, blocked, replaced or terminal; no workflow execution authorized');
 const plan=await loadProjectPlan(cwd,row.planId);
 if(plan.sessionId!==row.sessionId||digest(plan.content)!==row.planHash)throw new Error('Approved plan or original conversation binding changed');
 const platform=await loadPlatform(cwd);applyWorkflowBudget(platform.config,row.budget);return plan;
}
export async function prepareGoalWorkflow(cwd:string,input:{goalId:string;planId:string;expectedPlanVersion:number;maxRequests:number;maxTokens:number;allowedTools:string[];maxAttempts?:number}){
 const plan=await loadProjectPlan(cwd,input.planId);
 if(plan.status!=='approved'||plan.version!==input.expectedPlanVersion||!plan.sessionId)throw new Error('Read and approve this exact Plan version with an original session before preparing a Goal workflow');
 const session=await scopedSession(cwd,plan.sessionId),owner=await sessionOwner(session,await listAgents());
 if(owner&&['queued','working'].includes(owner.status))throw new Error('Original session is active');
 const {config}=await loadPlatform(cwd),id=createId('goalrun');
 const budget:WorkflowBudget={runId:id,maxRequests:input.maxRequests,maxTokens:input.maxTokens,allowedTools:[...new Set(input.allowedTools)],deploymentDigest:automationDeploymentDigest(config),policyDigest:workflowPolicyDigest(config)};
 if(budget.allowedTools.some(name=>!toolRegistry.list().some(tool=>tool.name===name)))throw new Error('Unknown workflow tool');
 applyWorkflowBudget(config,budget);
 const maxAttempts=input.maxAttempts??3;if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20)throw new Error('Goal attempts must be 1–20');
 // Attach the original idle owner to its approved Plan rather than creating an
 // unrelated blank session. Full canonical/archive context remains on disk.
 if(owner&&plan.planningAgentId!==owner.id&&plan.executionAgentId!==owner.id)throw new Error('Plan must belong to the original session owner; do not substitute an unrelated Agent');
 const row:GoalRun={id,version:1,goalId:input.goalId,planId:plan.id,planHash:digest(plan.content),sessionId:session.id,budget,phase:'ready',attempts:0,maxAttempts,updatedAt:new Date().toISOString()};
 await validate(cwd,row);
 await mkdir(join(projectStateDir(cwd),'goal-runs'),{recursive:true,mode:0o700});
 for(const p of [projectStateDir(cwd),join(projectStateDir(cwd),'goal-runs')])if((await lstat(p)).isSymbolicLink())throw new Error('Goal workflow state must not be a link');
 await writeJson(path(cwd,id),row);return inspectGoalWorkflow(cwd,id);
}
export async function inspectGoalWorkflow(cwd:string,id:string){
 const row=await load(cwd,id),spending=await readSpending(`goal:${id}`);let pendingRequestId:string|undefined;
 if(row.agentId){const agent=await loadAgent(row.agentId);pendingRequestId=parsePermissionRequest(agent.result)?.id;}
 return {id:row.id,version:row.version,goalId:row.goalId,planId:row.planId,sessionId:row.sessionId,phase:row.phase,attempts:row.attempts,maxAttempts:row.maxAttempts,agentId:row.agentId,pendingRequestId,reason:row.reason?redactModelDiagnostic(row.reason):undefined,budget:row.budget,requests:spending.requests,tokens:spending.tokens,unknownReservations:Object.keys(spending.reservations).length,automaticUnknownReplay:false,fullOriginalSession:true};
}
export async function assertGoalExecutionAllowed(cwd:string,budget:WorkflowBudget){
 const row=await load(cwd,budget.runId);
 if(row.phase!=='running'||JSON.stringify(row.budget)!==JSON.stringify(budget))throw new Error('Goal workflow is no longer authorized to execute');
 const goal=(await listSessionGoals(row.sessionId,cwd)).find(goal=>goal.id===row.goalId);
 if(goal?.status!=='active')throw new Error('Goal is no longer active; workflow execution stopped with conversation retained');
}
/** One process owns an attempt. It executes the entire approved coding/testing
 * plan; there is no implicit approval, quota reset or replay of unknown work. */
export async function runGoalWorkflow(cwd:string,id:string,expectedVersion:number){
 const initial=await load(cwd,id);await validate(cwd,initial);
 await mutate(cwd,id,expectedVersion,row=>{if(row.phase!=='ready'||row.attempts>=row.maxAttempts)throw new Error('Goal workflow is not ready or attempt limit reached');row.phase='running';row.attempts++;delete row.reason;});
 try{
  const record=await executeProjectPlan({cwd,planId:initial.planId,background:false,workflowBudget:initial.budget,...(initial.pendingFeedback?{feedback:initial.pendingFeedback}:{})});
  const current=await load(cwd,id);
  if(current.phase!=='running')return inspectGoalWorkflow(cwd,id);
  await mutate(cwd,id,current.version,row=>{row.agentId=record.id;row.phase=record.status==='completed'?'completed':record.status==='waiting_for_input'?'waiting':record.status==='cancelled'?'cancelled':'failed';delete row.pendingFeedback;if(record.error||record.status==='waiting_for_input')row.reason=record.error??'Human input/permission required; inspect the original Agent before continuing.';});
  if(record.status==='completed'){
   const goal=(await listSessionGoals(initial.sessionId,cwd)).find(goal=>goal.id===initial.goalId);
   if(goal?.status==='active')await transitionSessionGoal(goal.id,'completed',goal.version??1,cwd);
  }
 }catch(error){const current=await load(cwd,id);if(current.phase==='running')await mutate(cwd,id,current.version,row=>{row.phase='unknown';row.reason=redactModelDiagnostic(error instanceof Error?error.message:String(error));});}
 return inspectGoalWorkflow(cwd,id);
}
export async function launchGoalWorkflow(cwd:string,id:string,version:number,entry:string){
 const row=await load(cwd,id);if(row.version!==version||row.phase!=='ready')throw new Error('Refresh the ready Goal workflow version before launch');await validate(cwd,row);
 const config=(await loadPlatform(cwd)).config;
 const args=[resolve(entry),'_goal_worker',id,'--cwd',resolve(cwd),'--expected-version',String(version)];
 const internal:NodeJS.ProcessEnv={CCPT_HOME:homeStateDir()};
 for(const key of ['CCPT_MANAGED_CONFIG','CCPT_AUDIT_HMAC_KEY','CCPT_AUDIT_INTEGRITY','CCPT_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CCPT_CLI_ENTRY',...(config.model.apiKeyEnv?[config.model.apiKeyEnv]:[]),...Object.values(config.model.headersFromEnvironment??{})])if(process.env[key])internal[key]=process.env[key];
 const wrapper=config.policy.processWrapper,child=spawn(wrapper??process.execPath,wrapper?[process.execPath,...args]:args,{cwd:resolve(cwd),detached:true,stdio:'ignore',windowsHide:true,env:sanitizedEnvironment(config.policy.mode,internal,config.policy.allowedEnvironmentVariables)});
 await new Promise<void>((yes,no)=>{child.once('spawn',yes);child.once('error',no);});child.unref();return {id,launched:true,claimVersion:version,automaticReplay:false};
}
export async function resumeGoalWorkflow(cwd:string,id:string,version:number,input:{feedback?:string;approveRequestId?:string;confirmUnknown?:boolean}){
 const old=await load(cwd,id);await validate(cwd,old);
 await mutate(cwd,id,version,async row=>{
  if(!['waiting','failed','unknown'].includes(row.phase)||row.attempts>=row.maxAttempts)throw new Error('Goal workflow cannot resume in this state or is out of attempts');
  if(row.phase!=='waiting'&&!input.confirmUnknown)throw new Error('Failed/unknown outcomes require explicit external-side-effect verification before retry');
  const plan=await loadProjectPlan(cwd,row.planId),owner=plan.executionAgentId?await reconcileExecutionOwner(plan.executionAgentId,{cwd,sessionId:row.sessionId,planId:row.planId,runId:id}):undefined;
  if(owner?.status==='working'||owner?.status==='queued')throw new Error('Execution Agent is still active');
  if(owner?.status==='failed'&&plan.status==='executing')await transitionProjectPlan(cwd,plan.id,'failed',{expectedVersion:plan.version,expectedExecutionAgentId:owner.id,error:'Interrupted execution; human verified continuation required.'});
  if(input.approveRequestId){const request=parsePermissionRequest(owner?.result);if(!request||request.id!==input.approveRequestId||request.sessionId!==row.sessionId)throw new Error('Pending permission changed; no approval granted');await grantPermissionOnce(request);}
  if(!input.feedback?.trim()&&!input.approveRequestId)throw new Error('Human continuation feedback or an exact pending approval is required');
  row.phase='ready';row.pendingFeedback=(input.feedback?.trim()??'The human approved this exact pending request once; all other permissions remain unchanged.').slice(0,20000);delete row.reason;
 });return inspectGoalWorkflow(cwd,id);
}
/** Reconcile only a matching owned execution. A missing/unknown owner is not a retry license. */
export async function recoverGoalWorkflow(cwd:string,id:string,version:number){
 const recovered=await mutate(cwd,id,version,async row=>{
  if(row.phase==='completed')return; // Reconcile a crash between run and Goal terminal writes.
  if(row.phase!=='running'&&row.phase!=='unknown')throw new Error('Only interrupted workflows need recovery');
  const plan=await loadProjectPlan(cwd,row.planId);
  const candidate=plan.executionAgentId?await loadAgent(plan.executionAgentId):undefined;
  const agent=candidate?.workflowBudget?.runId===id?await reconcileExecutionOwner(candidate.id,{cwd,sessionId:row.sessionId,planId:row.planId,runId:id}):undefined;
  if(!agent||agent.workflowBudget?.runId!==id){row.phase='unknown';row.reason='No matching execution owner. Verify external effects manually; nothing was replayed.';return;}
  if(['queued','working'].includes(agent.status))throw new Error('Execution owner is still active');
  if(agent.status==='failed'&&plan.status==='executing')await transitionProjectPlan(cwd,plan.id,'failed',{expectedVersion:plan.version,expectedExecutionAgentId:agent.id,error:'Interrupted execution; external effects remain unknown. No automatic replay.'});
  row.agentId=agent.id;row.phase=agent.status==='completed'?'completed':agent.status==='waiting_for_input'?'waiting':agent.status==='cancelled'?'cancelled':'unknown';
  if(row.phase==='unknown')row.reason='Execution interrupted. Verify external effects manually before an explicit continuation; nothing was replayed.';
 });
 if(recovered.phase==='completed'){
  const goal=(await listSessionGoals(recovered.sessionId,cwd)).find(goal=>goal.id===recovered.goalId);
  if(goal?.status==='active')await transitionSessionGoal(goal.id,'completed',goal.version??1,cwd);
 }
 return inspectGoalWorkflow(cwd,id);
}
export async function cancelGoalWorkflow(cwd:string,id:string,version:number){
 await mutate(cwd,id,version,async row=>{if(['completed','cancelled'].includes(row.phase))throw new Error('Goal workflow is already terminal');const plan=await loadProjectPlan(cwd,row.planId);if(plan.executionAgentId){const agent=await loadAgent(plan.executionAgentId);if(agent.workflowBudget?.runId===id)await cancelAgent(agent.id);}row.phase='cancelled';row.reason='Cancelled by the human. Conversation and files retained; no rollback.';});return inspectGoalWorkflow(cwd,id);
}
