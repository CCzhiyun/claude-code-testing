import {lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {projectStateDir} from './paths.js';
import {listPlanRecords} from './plans.js';
import {listSessionGoals} from './automation.js';
import {inspectGoalWorkflow,prepareGoalWorkflow,launchGoalWorkflow,resumeGoalWorkflow,recoverGoalWorkflow,cancelGoalWorkflow} from './goalWorkflow.js';
import {publishProjectInvalidation} from './projectEvents.js';
import {redactModelDiagnostic} from './modelErrors.js';
import {loadAgent} from './agent.js';
import {parsePermissionRequest} from './permissionApprovals.js';
import {sameSessionWorkspace} from './sessionRecovery.js';
export type GoalPreparation=Parameters<typeof prepareGoalWorkflow>[1];
export interface GoalCandidate {planId:string;expectedPlanVersion:number;goalId:string;sessionId:string;title:string}
export type GoalDecision={action:'start'|'resume'|'recover'|'cancel';id:string;expectedVersion:number;confirm:boolean;feedback?:string;approveRequestId?:string;confirmUnknown?:boolean};
export async function goalCandidates(cwd:string):Promise<GoalCandidate[]>{
 const plans=(await listPlanRecords(cwd)).filter(p=>p.status==='approved'&&p.sessionId);if(plans.length>200)throw new Error('Goal wizard supports at most 200 approved Plans; narrow the workspace first');
 const result:GoalCandidate[]=[];for(const plan of plans){const goal=(await listSessionGoals(plan.sessionId!,cwd)).find(g=>g.status==='active');if(goal)result.push({planId:plan.id,expectedPlanVersion:plan.version,goalId:goal.id,sessionId:plan.sessionId!,title:plan.title});}return result;
}
export async function listGoalWorkflows(cwd:string){
 const directory=join(projectStateDir(cwd),'goal-runs');let entries;try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Invalid Goal run directory');entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {items:[],errors:[]};throw error;}
 if(entries.length>512)throw new Error('Goal workflow inventory exceeds 512 entries');const items:Array<Awaited<ReturnType<typeof inspectGoalWorkflow>>>=[],errors:Array<{id:string;error:string}>=[];
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(!/^goalrun_[a-f0-9]{16}\.json$/.test(entry.name))continue;const id=entry.name.slice(0,-5);try{if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Goal run entry must be a regular file');items.push(await inspectGoalWorkflow(cwd,id));}catch(error){errors.push({id,error:redactModelDiagnostic(String(error))});}}
 return {items,errors};
}
export async function reviewGoalWorkflow(cwd:string,id:string){const run=await inspectGoalWorkflow(cwd,id);let pendingPermission;if(run.agentId&&run.pendingRequestId){const agent=await loadAgent(run.agentId);if(!sameSessionWorkspace(agent.cwd,cwd)||agent.sessionId!==run.sessionId||agent.workflowBudget?.runId!==id)throw new Error('Pending permission does not belong to this Goal workflow');pendingPermission=parsePermissionRequest(agent.result);if(pendingPermission?.id!==run.pendingRequestId)throw new Error('Permission changed; reopen review');}return {...run,...(pendingPermission?{pendingPermission}:{})};}
/** Human UI actions only. No action is inferred from Agent mailbox/model output.
 * Every decision uses the exact reviewed durable version, never refreshed into approval. */
export async function decideGoalWorkflow(cwd:string,decision:GoalDecision,entry:string){
 if(decision.confirm!==true)throw new Error('Goal workflow action requires explicit human confirmation');
 if(!Number.isSafeInteger(decision.expectedVersion)||decision.expectedVersion<1)throw new Error('Read Goal run and review its exact version first');
 if(decision.feedback!==undefined&&(typeof decision.feedback!=='string'||decision.feedback.length>16000))throw new Error('Goal feedback exceeds bounds');
 await publishProjectInvalidation(cwd,'workspace');
 switch(decision.action){
  case 'start':return launchGoalWorkflow(cwd,decision.id,decision.expectedVersion,resolve(entry));
  case 'recover':return recoverGoalWorkflow(cwd,decision.id,decision.expectedVersion);
  case 'cancel':return cancelGoalWorkflow(cwd,decision.id,decision.expectedVersion);
  case 'resume':return resumeGoalWorkflow(cwd,decision.id,decision.expectedVersion,{...(decision.feedback!==undefined?{feedback:decision.feedback}:{}),...(decision.approveRequestId?{approveRequestId:decision.approveRequestId}:{}),confirmUnknown:decision.confirmUnknown===true});
  default:throw new Error('Unknown Goal workflow action');
 }
}
