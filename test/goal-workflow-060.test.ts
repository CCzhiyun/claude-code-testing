import {test,expect} from 'bun:test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../src/config.js';
import {writeJson} from '../src/storage.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {createSession,saveSession,loadSession} from '../src/sessions.js';
import {setSessionGoal} from '../src/automation.js';
import {createProjectPlan,transitionProjectPlan} from '../src/plans.js';
import {prepareGoalWorkflow,runGoalWorkflow,inspectGoalWorkflow,resumeGoalWorkflow,cancelGoalWorkflow,recoverGoalWorkflow} from '../src/goalWorkflow.js';
import {loadProjectPlan} from '../src/plans.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';

async function fixture(action:(f:{root:string;requests:any[];config:typeof defaultConfig;sessionId:string;goalId:string;planId:string;planVersion:number})=>Promise<void>,approval=false){
 const root=await mkdtemp(join(tmpdir(),'ccpt-goal-060-')),old={home:process.env.CCPT_HOME,entry:process.env.CCPT_CLI_ENTRY};process.env.CCPT_HOME=join(root,'home');process.env.CCPT_CLI_ENTRY=join(import.meta.dir,'../src/cli.ts');const requests:any[]=[];
 const server=Bun.serve({port:0,async fetch(req){const body:any=await req.json();requests.push(body);const hasResult=JSON.stringify(body).includes('Wrote implementation.txt');const message=hasResult?{content:'Implementation and verification completed.'}:{tool_calls:[{id:`write_${requests.length}`,type:'function',function:{name:'write_file',arguments:'{"path":"implementation.txt","content":"verified implementation"}'}}]};return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:50,completion_tokens:20}});}});
 const config=structuredClone(defaultConfig);config.marketplaceEnabled=false;config.disableBundledSkills=true;config.hooks=[];config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/chat/completions`;config.model.apiKeyEnv='';config.model.maxContextTokens=16000;config.model.maxOutputTokens=512;config.agents.defaultIsolation='none';config.policy.workspaceRoots=[root];if(approval)config.policy.permissionRules={allow:[],deny:[],ask:['write_file']};
 await writeJson(join(root,'.ccpt/settings.json'),config);await trustWorkspace(root);const session=await createSession('Original architecture',root);session.archivedMessages=[{role:'user',content:'Archived architecture decision'}];session.messages=[{role:'user',content:'ORIGINAL_ARCHITECTURE_CONTEXT'}];await saveSession(session);const goal=await setSessionGoal({sessionId:session.id,objective:'Implement and verify approved change'},root),plan=await createProjectPlan({cwd:root,sessionId:session.id,request:'Implement verified change',content:'# Approved implementation\n- [ ] Write implementation.txt\n- [ ] Verify output'}),approved=await transitionProjectPlan(root,plan.id,'approved',{expectedVersion:plan.version});
 try{await action({root,requests,config,sessionId:session.id,goalId:goal.id,planId:plan.id,planVersion:approved.version});}finally{server.stop(true);if(old.home===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old.home;if(old.entry===undefined)delete process.env.CCPT_CLI_ENTRY;else process.env.CCPT_CLI_ENTRY=old.entry;await removeOwnedTemporaryFixture(root);}
}
const limits={maxRequests:6,maxTokens:500000,allowedTools:['write_file','read_file'],maxAttempts:3};
test('approved Goal executes real coding in a background worker with full original session and bounded budget',()=>fixture(async f=>{
 const run=await prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits});expect(f.requests).toHaveLength(0);
 const final=await runGoalWorkflow(f.root,run.id,run.version);expect(final.phase).toBe('completed');expect(final.requests).toBe(2);expect(await readFile(join(f.root,'implementation.txt'),'utf8')).toBe('verified implementation');expect(JSON.stringify(f.requests[0])).toContain('ORIGINAL_ARCHITECTURE_CONTEXT');const session=await loadSession(f.sessionId);expect(session.archivedMessages?.[0]!.content).toBe('Archived architecture decision');expect(final.sessionId).toBe(f.sessionId);
}),25000);
test('Goal waits for exact human approval then continues same Agent without resetting its request budget',()=>fixture(async f=>{
 const run=await prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits});const waiting=await runGoalWorkflow(f.root,run.id,run.version);expect(waiting.phase).toBe('waiting');expect(waiting.pendingRequestId).toBeString();expect(f.requests).toHaveLength(1);
 await expect(resumeGoalWorkflow(f.root,run.id,waiting.version,{approveRequestId:'stale'})).rejects.toThrow('changed');const ready=await resumeGoalWorkflow(f.root,run.id,waiting.version,{approveRequestId:waiting.pendingRequestId!});const final=await runGoalWorkflow(f.root,run.id,ready.version);expect(final.phase).toBe('completed');expect(final.agentId).toBe(waiting.agentId);expect(final.requests).toBe(3);expect(final.attempts).toBe(2);
},true),30000);
test('unapproved/stale Plan and unbounded workflow are rejected without any model requests',()=>fixture(async f=>{
 await expect(prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:1,...limits})).rejects.toThrow('exact Plan');await expect(prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits,maxRequests:0})).rejects.toThrow('bounds');expect(f.requests).toHaveLength(0);
}));
test('changed deployment does not silently redirect a prepared Goal workflow',()=>fixture(async f=>{
 const run=await prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits});f.config.model.name='different-model';await writeJson(join(f.root,'.ccpt/settings.json'),f.config);await expect(runGoalWorkflow(f.root,run.id,run.version)).rejects.toThrow('model/policy changed');expect((await inspectGoalWorkflow(f.root,run.id)).phase).toBe('ready');expect(f.requests).toHaveLength(0);
}));

test('Goal request budget is cumulative across human continuation and cannot be reset by resuming',()=>fixture(async f=>{
 const run=await prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits,maxRequests:1});const waiting=await runGoalWorkflow(f.root,run.id,run.version);expect(waiting.phase).toBe('waiting');expect(waiting.requests).toBe(1);
 const ready=await resumeGoalWorkflow(f.root,run.id,waiting.version,{feedback:'Continue within the original budget only.'});const final=await runGoalWorkflow(f.root,run.id,ready.version);expect(final.phase).toBe('waiting');expect(final.requests).toBe(1);expect(f.requests).toHaveLength(1);expect(final.agentId).toBe(waiting.agentId);expect(final.reason).toContain('Human input');
}),25000);

test('cancelled Goal run rejects stale decisions and never launches or reopens a workflow',()=>fixture(async f=>{
 const run=await prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits});const cancelled=await cancelGoalWorkflow(f.root,run.id,run.version);expect(cancelled.phase).toBe('cancelled');await expect(cancelGoalWorkflow(f.root,run.id,run.version)).rejects.toThrow('changed');await expect(runGoalWorkflow(f.root,run.id,cancelled.version)).rejects.toThrow('not ready');expect(f.requests).toHaveLength(0);expect((await loadSession(f.sessionId)).messages[0]!.content).toBe('ORIGINAL_ARCHITECTURE_CONTEXT');
}));

async function interrupted(f:any,pid:number){
 const run=await prepareGoalWorkflow(f.root,{goalId:f.goalId,planId:f.planId,expectedPlanVersion:f.planVersion,...limits}),agentId='agent_6161616161616161',now=new Date().toISOString();
 await transitionProjectPlan(f.root,f.planId,'executing',{expectedVersion:f.planVersion,executionAgentId:agentId});
 await writeJson(join(process.env.CCPT_HOME!,'agents',agentId+'.json'),{id:agentId,sessionId:f.sessionId,planId:f.planId,cwd:f.root,role:'lead',goal:'Interrupted fixture',depth:0,status:'working',pid,heartbeatAt:'2000-01-01T00:00:00Z',createdAt:now,updatedAt:now,workflowBudget:run.budget});
 const file=join(f.root,'.ccpt/goal-runs',run.id+'.json'),row=JSON.parse(await readFile(file,'utf8'));row.phase='running';row.attempts=1;row.version++;await writeJson(file,row);return {run,row,agentId};
}
test('direct Goal recovery reconciles only the dead bound owner and allows explicit verified continuation without replay',()=>fixture(async f=>{
 const child=Bun.spawn(['node','-e','process.exit(0)'],{stdout:'ignore',stderr:'ignore'});await child.exited;
 const {run,row,agentId}=await interrupted(f,child.pid);
 const unrelated=join(process.env.CCPT_HOME!,'agents/agent_6262626262626262.json');await writeJson(unrelated,{id:'agent_6262626262626262',status:'working',pid:child.pid,updatedAt:'2000-01-01T00:00:00Z'});const before=await readFile(unrelated,'utf8');
 const recovered=await recoverGoalWorkflow(f.root,run.id,row.version);expect(recovered.phase).toBe('unknown');expect(recovered.attempts).toBe(1);expect(recovered.requests).toBe(0);expect(f.requests).toHaveLength(0);expect((await loadProjectPlan(f.root,f.planId)).status).toBe('failed');expect(await readFile(unrelated,'utf8')).toBe(before);
 await expect(resumeGoalWorkflow(f.root,run.id,recovered.version,{feedback:'Continue'})).rejects.toThrow('verification');
 const ready=await resumeGoalWorkflow(f.root,run.id,recovered.version,{feedback:'Human verified fixture effects; continue within original budget',confirmUnknown:true});expect(ready.phase).toBe('ready');expect(ready.agentId).toBe(agentId);expect(ready.budget).toEqual(run.budget);expect(ready.attempts).toBe(1);expect(f.requests).toHaveLength(0);
 await expect(recoverGoalWorkflow(f.root,run.id,row.version)).rejects.toThrow('changed');
}));
test('direct recovery never treats a live owner as dead based only on an expired heartbeat',()=>fixture(async f=>{
 const {run,row}=await interrupted(f,process.pid);await expect(recoverGoalWorkflow(f.root,run.id,row.version)).rejects.toThrow('still active');expect((await inspectGoalWorkflow(f.root,run.id)).version).toBe(row.version);expect((await loadProjectPlan(f.root,f.planId)).status).toBe('executing');expect(f.requests).toHaveLength(0);
}));
test('concurrent direct recovery has one CAS winner, retains the same budget and never calls the model',()=>fixture(async f=>{
 const child=Bun.spawn(['node','-e','process.exit(0)'],{stdout:'ignore',stderr:'ignore'});await child.exited;const {run,row}=await interrupted(f,child.pid);
 const outcomes=await Promise.allSettled([recoverGoalWorkflow(f.root,run.id,row.version),recoverGoalWorkflow(f.root,run.id,row.version)]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await inspectGoalWorkflow(f.root,run.id)).phase).toBe('unknown');expect(f.requests).toHaveLength(0);
}));
