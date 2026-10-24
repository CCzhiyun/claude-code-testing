import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { createSession, saveSession, loadSession } from '../src/sessions.js';
import { sessionHistory } from '../src/sessionHistoryView.js';
import { queueRuntimeHistory, flushRuntimeHistory, runtimeHistory } from '../src/runtimeHistory.js';
import { publishRuntimeEvent } from '../src/runtimeEvents.js';
import { setSessionGoal, listSessionGoals, activeSessionGoal, transitionSessionGoal, scheduleWakeup, bindWakeupToJob, deliverPendingWakeups, listWakeups } from '../src/automation.js';
import { prepareAutomationScheduler, tickAutomationScheduler, loadSchedulerJob } from '../src/automationScheduler.js';
import { tickReadOnlyAutomation } from '../src/scheduledAgent.js';
import { automationDeploymentDigest } from '../src/readOnlyAutomation.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { writeJson } from '../src/storage.js';
import { executeTool } from '../src/tooling.js';
import { executeFileEdit } from '../src/tools/FileEditTool/FileEditTool.js';
import { createCheckpoint, restoreCheckpoint } from '../src/checkpoints.js';
import { spawnAgent } from '../src/agent.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
import type { ToolContext } from '../src/types.js';

async function fixture(action:(root:string,home:string)=>Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),'ccpt-platform-059-')),old=process.env.CCPT_HOME,home=join(root,'home'); process.env.CCPT_HOME=home;
  await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[]});
  try { await action(root,home); } finally { await flushRuntimeHistory(); if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root); }
}
const entry=join(import.meta.dir,'../src/cli.ts'),hook=join(import.meta.dir,'lifecycle-057-fixture.cjs');
function configFor(root:string){const config=structuredClone(defaultConfig);config.policy.workspaceRoots=[root];config.policy.mode='bypass';config.marketplaceEnabled=false;config.disableBundledSkills=true;config.hooks=[];return config;}
async function makeDue(root:string){const path=join(root,'.ccpt/automation.json'),state=JSON.parse(await readFile(path,'utf8'));for(const row of state.wakeups)row.runAt='2020-01-01T00:00:00Z';await writeJson(path,state);}

test('history is metadata-only until explicitly requested; hidden/provider/tool data never escapes',()=>fixture(async(root)=>{
  const session=await createSession('safe',root);session.archivedMessages=[{role:'user',content:'Archived question'}];
  session.messages=[{role:'assistant',responses:{scope:'PRIVATE-PROVIDER',id:'PRIVATE-RESPONSE',prefixHash:'PRIVATE-HASH',output:[{secret:'PRIVATE-OUTPUT'}],stored:true},content:[{type:'thinking',text:'PRIVATE-REASONING',signature:'PRIVATE-SIG'},{type:'tool_use',name:'read_file',id:'call_1',input:{secret:'PRIVATE-INPUT'}},{type:'text',text:'Visible answer'},{type:'image',data:'PRIVATE-IMAGE'}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'PRIVATE-RESULT'}]}];await saveSession(session);
  const metadata=await sessionHistory(root,session.id);expect(JSON.stringify(metadata)).not.toContain('Visible answer');
  const page=await sessionHistory(root,session.id,{includeText:true});expect(page.items[1]).toMatchObject({text:'Visible answer',tools:['read_file'],images:1});expect(page.items[0]!.archived).toBe(true);expect(page.permissionGranted).toBe(false);expect(page.toolReplay).toBe(false);expect(JSON.stringify(page)).not.toContain('PRIVATE-');
}));
test('history pagination is chronological, bounded and snapshot-bound',()=>fixture(async root=>{
  const s=await createSession('pages',root);s.messages=Array.from({length:6},(_,i)=>({role:'user',content:`message ${i}`}));await saveSession(s);
  const page=await sessionHistory(root,s.id,{limit:2,includeText:true});expect(page.items.map(row=>row.index)).toEqual([4,5]);
  const older=await sessionHistory(root,s.id,{limit:2,cursor:page.nextCursor!,includeText:true});expect(older.items.map(row=>row.index)).toEqual([2,3]);
  s.messages.push({role:'assistant',content:'new'});await saveSession(s);await expect(sessionHistory(root,s.id,{cursor:page.nextCursor!})).rejects.toThrow('changed');
}));
test('history rejects foreign workspaces, path traversal, corrupt data and invalid limits',()=>fixture(async root=>{
  const other=join(root,'other');await mkdir(other);const s=await createSession('foreign',other);
  await expect(sessionHistory(root,s.id)).rejects.toThrow('another workspace');await expect(sessionHistory(root,'../settings')).rejects.toThrow('Invalid session');
  for(const limit of [0,101,NaN,1.5])await expect(sessionHistory(other,s.id,{limit})).rejects.toThrow('limit');
}));
test('history redacts environment secrets and bounds visible previews',()=>fixture(async root=>{
  const previous=process.env.CCPT_API_KEY;process.env.CCPT_API_KEY='fixture-private-key-059';
  try{const s=await createSession('redaction',root);s.messages=[{role:'user',content:'fixture-private-key-059 Bearer abc123 https://user:pwd@example.test/path?token=xx '+ 'x'.repeat(2500)}];await saveSession(s);const page=await sessionHistory(root,s.id,{includeText:true});expect(page.items[0]!.truncated).toBe(true);expect(page.items[0]!.text!.length).toBeLessThanOrEqual(2000);expect(page.items[0]!.text).not.toContain('fixture-private-key');expect(page.items[0]!.text).not.toContain('abc123');expect(page.items[0]!.text).not.toContain('token=');}
  finally{if(previous===undefined)delete process.env.CCPT_API_KEY;else process.env.CCPT_API_KEY=previous;}
}));
test('runtime journal persists projected metadata only and resumes from a cursor',()=>fixture(async(root,home)=>{
  const session=await createSession('runtime',root),context={agentId:'agent_1111111111111111',sessionId:session.id};
  for(const data of [{type:'thinking_delta',turn:0,delta:'PRIVATE-THINKING'},{type:'tool_started',turn:0,name:'read_file',input:{secret:'PRIVATE-INPUT'}},{type:'tool_completed',turn:0,name:'read_file',output:'PRIVATE-OUTPUT',isError:false,durationMs:4},{type:'agent_failed',error:'PRIVATE-STACK'}] as const)queueRuntimeHistory(publishRuntimeEvent({...context,...data}));
  await flushRuntimeHistory();const page=await runtimeHistory(root,session.id,undefined,1);expect(page.items).toHaveLength(1);expect(page.hasMore).toBe(true);
  const rest=await runtimeHistory(root,session.id,page.cursor);expect(rest.items).toHaveLength(2);expect(rest.hasMore).toBe(false);expect(rest.metadataOnly).toBe(true);expect(rest.complete).toBe(false);
  expect(await readFile(join(home,'runtime-history',`${session.id}.json`),'utf8')).not.toContain('PRIVATE');expect((await runtimeHistory(root,session.id,rest.cursor)).items).toEqual([]);
}));
test('runtime retention signals a gap and rejects malformed cursors or forged records',()=>fixture(async(root,home)=>{
  const s=await createSession('retention',root),ctx={agentId:'agent_1111111111111111',sessionId:s.id};
  queueRuntimeHistory(publishRuntimeEvent({...ctx,type:'turn_started',turn:0}));await flushRuntimeHistory();const initial=await runtimeHistory(root,s.id);
  for(let i=1;i<=515;i++)queueRuntimeHistory(publishRuntimeEvent({...ctx,type:'turn_started',turn:i}));await flushRuntimeHistory();
  const page=await runtimeHistory(root,s.id,initial.cursor,200);expect(page.reset).toBe(true);expect(page.items[0]!.sequence).toBe(5);expect(page.hasMore).toBe(true);
  await expect(runtimeHistory(root,s.id,'bad')).rejects.toThrow('cursor');
  const path=join(home,'runtime-history',`${s.id}.json`),state=JSON.parse(await readFile(path,'utf8'));state.items[0].type='PRIVATE-INJECTED';await writeJson(path,state);await expect(runtimeHistory(root,s.id)).rejects.toThrow('Invalid runtime');
}),20000);
test('Goal pause/block/resume uses CAS and never reopens terminal goals',()=>fixture(async root=>{
  const goal=await setSessionGoal({sessionId:'s',objective:'Deliver verified work'},root);
  await expect(transitionSessionGoal(goal.id,'paused',1,root)).rejects.toThrow('reason');
  const paused=await transitionSessionGoal(goal.id,'paused',1,root,'Human review needed');expect(paused.version).toBe(2);expect(await activeSessionGoal('s',root)).toBeUndefined();
  await expect(transitionSessionGoal(goal.id,'completed',2,root)).rejects.toThrow('Resume');
  await transitionSessionGoal(goal.id,'blocked',2,root,'External dependency');await transitionSessionGoal(goal.id,'active',3,root);await transitionSessionGoal(goal.id,'completed',4,root);
  await expect(transitionSessionGoal(goal.id,'active',5,root)).rejects.toThrow('Terminal');
}));
test('16 same-version Goal decisions have one winner; replacing a goal revokes paused state',()=>fixture(async root=>{
  const g=await setSessionGoal({sessionId:'s',objective:'First'},root);const decisions=await Promise.allSettled(Array.from({length:16},()=>transitionSessionGoal(g.id,'paused',1,root,'review')));expect(decisions.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  await setSessionGoal({sessionId:'s',objective:'Second'},root);expect((await listSessionGoals('s',root)).find(row=>row.id===g.id)!.status).toBe('cancelled');await expect(transitionSessionGoal(g.id,'active',2,root)).rejects.toThrow('changed');
}),15000);
test('separate jobs consume only their bound wakeups; foreground consumes legacy context only',()=>fixture(async root=>{
  await trustWorkspace(root);const session=await createSession('origin',root),a=await prepareAutomationScheduler(root,entry),b=await prepareAutomationScheduler(root,entry);
  for(const jobId of [a.id,b.id,undefined])await scheduleWakeup({sessionId:session.id,prompt:jobId??'legacy',runAt:new Date(Date.now()+60000).toISOString(),...(jobId?{jobId}:{})},root);
  await makeDue(root);expect(await deliverPendingWakeups(root,session)).toBe(1);expect((await tickAutomationScheduler(a.id)).delivered).toBe(1);
  const rows=await listWakeups(root);expect(rows.find(row=>row.jobId===b.id)!.status).toBe('scheduled');expect((await tickAutomationScheduler(b.id)).delivered).toBe(1);expect((await loadSession(session.id)).messages).toHaveLength(3);
}));
test('paid reader ignores unbound and foreign job queues without making requests',()=>fixture(async root=>{
  await trustWorkspace(root);const config=configFor(root);await writeJson(join(root,'.ccpt/settings.json'),config);const s=await createSession('origin',root),a=await prepareAutomationScheduler(root,entry),b=await prepareAutomationScheduler(root,entry);
  const legacy=await scheduleWakeup({sessionId:s.id,prompt:'legacy',runAt:new Date(Date.now()+60000).toISOString()},root),foreign=await scheduleWakeup({sessionId:s.id,jobId:b.id,prompt:'foreign',runAt:new Date(Date.now()+60000).toISOString()},root);
  const job=await loadSchedulerJob(a.id);job.readOnly={maxRequests:1,maxTokens:4096,maxRuns:1,deploymentDigest:automationDeploymentDigest(config)};
  const result=await tickReadOnlyAutomation(job,[legacy,foreign]);expect(result.modelsExecuted).toBe(false);expect(result.delivered).toBe(0);expect((await loadSession(s.id)).messages).toEqual([]);
}));
test('legacy binding is explicit and immutable; wrong workspace and terminal records fail closed',()=>fixture(async root=>{
  await trustWorkspace(root);const s=await createSession('migration',root),a=await prepareAutomationScheduler(root,entry),b=await prepareAutomationScheduler(root,entry),item=await scheduleWakeup({sessionId:s.id,prompt:'migrate',runAt:new Date(Date.now()+60000).toISOString()},root);
  expect((await bindWakeupToJob(item.id,a.id,root)).jobId).toBe(a.id);await expect(bindWakeupToJob(item.id,b.id,root)).rejects.toThrow('immutable');
  const other=join(root,'other');await mkdir(other);await expect(scheduleWakeup({sessionId:s.id,jobId:a.id,prompt:'wrong',runAt:new Date(Date.now()+60000).toISOString()},other)).rejects.toThrow('another workspace');
}));
test('file writes emit created/modified events and observer denial never reports a successful write as failed',()=>fixture(async root=>{
  const config=configFor(root),log=join(root,'files.jsonl');config.hooks=[{event:'FileChanged',matcher:'*target.txt',command:`node "${hook}" fail "${log}"`}];
  const s=await createSession('writes',root),ctx:ToolContext={cwd:root,config,agentId:'agent_1111111111111111',sessionId:s.id,depth:0};
  for(const content of ['one','two']){const result=await executeTool('write_file',{path:'target.txt',content},ctx,async()=> '');expect(result.content).toContain('Wrote');expect(result.content).toContain('not rolled back');}
  expect(await readFile(join(root,'target.txt'),'utf8')).toBe('two');const rows=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(rows.map(row=>row.change)).toEqual(['created','modified']);expect(rows.every(row=>row.session_id===s.id)).toBe(true);expect(JSON.stringify(rows)).not.toContain('"content"');
}));
test('exact edits and checkpoint deletion restoration emit FileChanged automatically',()=>fixture(async root=>{
  const config=configFor(root),log=join(root,'changes.jsonl');config.hooks=[{event:'FileChanged',command:`node "${hook}" ok "${log}"`}];
  const s=await createSession('edit',root),ctx:ToolContext={cwd:root,config,agentId:'agent_1111111111111111',sessionId:s.id,depth:0};
  const path=join(root,'new.txt'),checkpoint=await createCheckpoint({cwd:root,config,files:[path],sessionId:s.id});await writeFile(path,'old');await executeFileEdit({path:'new.txt',oldText:'old',newText:'new'},ctx);await restoreCheckpoint({cwd:root,config,id:checkpoint.id});
  const rows=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(rows.map(row=>row.change)).toEqual(['modified','deleted']);expect(rows.map(row=>row.tool)).toEqual(['edit_file','checkpoint_restore']);
}));
test('real Agent lazy scoped instructions fire once across repeated file access; journal survives the worker',()=>fixture(async(root,home)=>{
  await writeFile(join(root,'fixture.ts'),'export const answer = 42;');await mkdir(join(root,'.ccpt/rules'),{recursive:true});await writeFile(join(root,'.ccpt/rules/typescript.md'),'---\npaths: ["*.ts"]\n---\nSCOPED-FIXTURE-RULE');
  const log=join(root,'rules.jsonl'),requests:any[]=[],server=Bun.serve({port:0,async fetch(req){requests.push(await req.json());return Response.json({choices:[{message:requests.length<=2?{tool_calls:[{id:`call_${requests.length}`,type:'function',function:{name:'read_file',arguments:'{"path":"fixture.ts"}'}}]}:{content:'DONE'},finish_reason:requests.length<=2?'tool_calls':'stop'}]});}});
  const config=configFor(root);config.model.apiProtocol='chat-completions';config.model.apiKeyEnv='';config.model.endpointUrl=`http://127.0.0.1:${server.port}/chat/completions`;config.hooks=[{event:'InstructionsLoaded',matcher:'scoped-rules',command:`node "${hook}" ok "${log}"`}];await writeJson(join(root,'.ccpt/settings.json'),config);
  try{const agent=await spawnAgent({cwd:root,config,goal:'Read fixture.ts twice and explain it.',background:false,isolation:'none',allowedTools:['read_file']});expect(agent.status).toBe('completed');expect(requests).toHaveLength(3);const rows=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({load_reason:'file_access',source:'scoped-rules',path:'fixture.ts'});expect(rows[0].rule_ids).toHaveLength(1);const history=await runtimeHistory(root,agent.sessionId);expect(history.items.some(row=>row.type==='tool_completed')).toBe(true);expect(history.items.some(row=>row.type==='agent_completed')).toBe(true);expect(await readFile(join(home,'runtime-history',`${agent.sessionId}.json`),'utf8')).not.toContain('SCOPED-FIXTURE-RULE');}
  finally{server.stop(true);}
}),20000);
