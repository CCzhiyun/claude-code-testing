import {createQuestionDialog,type QuestionDialogState} from './questionDialog.js';
import {goalCandidates,decideGoalWorkflow,reviewGoalWorkflow,type GoalCandidate,type GoalDecision,type GoalPreparation} from '../goalManagement.js';
import {inspectGoalWorkflow,prepareGoalWorkflow} from '../goalWorkflow.js';
export type LocalGoalDialog={kind:'prepare';candidates:GoalCandidate[]}|{kind:'prepare-confirm';input:GoalPreparation}|{kind:'decision';decision:GoalDecision};
const answer=(state:QuestionDialogState,key:string)=>state.answers[key]?.[0]??'';
function question(questions:unknown[],localGoal:LocalGoalDialog):QuestionDialogState{const state=createQuestionDialog('local-human-workflow',JSON.stringify({type:'questions',questions}));if(!state)throw new Error('Invalid Goal wizard');state.localGoal=localGoal;return state;}
export async function createGoalPrepareDialog(cwd:string){
 const candidates=await goalCandidates(cwd);if(!candidates.length)throw new Error('Approve a Plan with an original session and set its active /goal first. Preparing never approves a Plan.');
 return question([
  {id:'plan',question:'Choose an already approved Plan (original conversation retained)',choices:candidates.slice(0,10).map(p=>`${p.planId} · v${p.expectedPlanVersion} · ${p.title}`)},
  {id:'requests',question:'Lifetime paid-model request budget (positive integer)',choices:[]},
  {id:'tokens',question:'Lifetime total token budget (positive integer)',choices:[]},
  {id:'tools',question:'Allowed tools, comma-separated. Tools not listed are denied. Example: read_file,write_file,run_command',choices:[]}
 ],{kind:'prepare',candidates});
}
export async function createGoalDecisionDialog(cwd:string,id:string,action:GoalDecision['action'],feedback?:string){
 const run=await reviewGoalWorkflow(cwd,id);const decision:GoalDecision={id,action,expectedVersion:run.version,confirm:false,...(feedback?{feedback}:{})};
 const label=action==='start'?'Start paid execution':action==='resume'?(run.pendingRequestId?'Approve this exact pending permission once and prepare continuation':'Prepare continuation'):action==='recover'?'Reconcile interrupted owner (never replay)':'Cancel this run';
 if(action==='resume'&&run.pendingRequestId)decision.approveRequestId=run.pendingRequestId;
 if(action==='resume'&&run.phase==='unknown'){if(!feedback)throw new Error('Unknown effects require human verification first. Supply /goal-run resume ID <verification feedback>.');decision.confirmUnknown=true;}
 return question([{id:'confirm',question:`${label}?\nRun ${id} · reviewed v${run.version} · ${run.phase}\nRequests ${run.requests}/${run.budget.maxRequests} · tokens ${run.tokens}/${run.budget.maxTokens}\nTools: ${run.budget.allowedTools.join(', ')}\n${run.pendingPermission?`Exact permission request: ${JSON.stringify(run.pendingPermission)}\n`:''}${decision.confirmUnknown?'You attest that unknown external effects were independently checked.\n':''}Resume prepares only; it does not start. Existing policies and Plan checks still apply.`,choices:['Cancel — change nothing',label]}],{kind:'decision',decision});
}
export async function completeGoalDialog(cwd:string,state:QuestionDialogState,entry:string):Promise<{dialog?:QuestionDialogState;result?:unknown}>{
 const local=state.localGoal;if(!local)throw new Error('Not a local Goal wizard');
 if(local.kind==='prepare'){
  const plan=local.candidates.find(p=>p.planId===answer(state,'plan').split(' · ')[0]);if(!plan)throw new Error('Select an exact reviewed Plan');
  const requests=answer(state,'requests'),tokens=answer(state,'tokens');if(!/^\d+$/.test(requests)||!/^\d+$/.test(tokens))throw new Error('Budgets must be positive integers');
  const maxRequests=Number(requests),maxTokens=Number(tokens);if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>1000||!Number.isSafeInteger(maxTokens)||maxTokens<1024||maxTokens>100000000)throw new Error('Budgets require 1–1000 requests and 1024–100000000 tokens');
  const allowedTools=answer(state,'tools').split(',').map(s=>s.trim()).filter(Boolean);if(!allowedTools.length||allowedTools.length>64)throw new Error('Select 1–64 tools');const {title:_,...binding}=plan;const input:GoalPreparation={...binding,maxRequests,maxTokens,allowedTools};
  return {dialog:question([{id:'confirm',question:`Prepare only; no model request now.\nPlan ${plan.planId} v${plan.expectedPlanVersion}\nGoal ${plan.goalId}\nSession ${plan.sessionId}\nLifetime requests ${maxRequests}, tokens ${maxTokens}\nTools ${allowedTools.join(', ')}\nExplicit start is still required and may incur cost.`,choices:['Cancel — change nothing','Prepare reviewed workflow']}],{kind:'prepare-confirm',input})};
 }
 if(answer(state,'confirm')===state.questions[0]!.choices[0])return {result:'Goal wizard cancelled; no action sent.'};
 if(local.kind==='prepare-confirm'){if(answer(state,'confirm')!=='Prepare reviewed workflow')throw new Error('Explicit prepare confirmation required');return {result:await prepareGoalWorkflow(cwd,local.input)};}
 if(!state.questions[0]!.choices.includes(answer(state,'confirm'))||!answer(state,'confirm'))throw new Error('Explicit Goal decision required');
 return {result:await decideGoalWorkflow(cwd,{...local.decision,confirm:true},entry)};
}
