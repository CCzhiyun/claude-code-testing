import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig } from '../src/config.js';
import { createId, writeJson } from '../src/storage.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { prepareAutomationScheduler, disableAutomationScheduler, loadSchedulerJob, schedulerTaskXml, tickAutomationScheduler } from '../src/automationScheduler.js';
import { assertOwnedSchedulerTask, inspectAutomationScheduler, listAutomationSchedulers, rebindAutomationScheduler, uninstallAutomationScheduler } from '../src/schedulerManagement.js';
import { createProjectNotification, listProjectNotifications, markProjectNotificationsRead } from '../src/notifications.js';
import { projectEventsAfter } from '../src/projectEvents.js';
import { HookDecisionError, runHooks } from '../src/hooks.js';
import { stopFailurePayload } from '../src/hookFailure.js';
import { ContextLimitError, ModelRequestError } from '../src/modelErrors.js';
import { spawnAgent, saveAgent } from '../src/agent.js';
import { createSession, loadSession } from '../src/sessions.js';
import { createTeam, deleteTeam } from '../src/teamStore.js';
import { sendTeamMessage, readTeamMailbox } from '../src/mailbox.js';
import { extensionAuthorityWatchPaths, watchLocalState } from '../src/localStateWatch.js';
import { setGlobalExtensionTrust } from '../src/globalExtensionTrust.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
import type { AgentRecord } from '../src/types.js';

async function fixture(action:(root:string,home:string)=>Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),'ccpt-foundation-057-')),prior=process.env.CCPT_HOME,home=join(root,'home'); process.env.CCPT_HOME=home;
  await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[]});
  try { await action(root,home); } finally {if(prior===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=prior;await removeOwnedTemporaryFixture(root);}
}
const entry=join(import.meta.dir,'../src/cli.ts'),hook=join(import.meta.dir,'lifecycle-057-fixture.cjs');
const until=async(fn:()=>boolean)=>{const deadline=Date.now()+4000;while(!fn()&&Date.now()<deadline)await Bun.sleep(20);expect(fn()).toBe(true);};

test('owned scheduler inventory/status is read-only and redacts unknown last-result fields',()=>fixture(async(root,home)=>{
  await trustWorkspace(root);const prepared=await prepareAutomationScheduler(root,entry);
  await writeJson(join(home,'schedulers',prepared.id,'last-result.json'),{delivered:3,modelsExecuted:false,secret:'PRIVATE'});
  const status=await inspectAutomationScheduler(prepared.id);expect(status.registration).toBe('not-queried');expect(status.lastResult).toEqual({delivered:3,modelsExecuted:false});expect(JSON.stringify(status)).not.toContain('PRIVATE');
  expect((await listAutomationSchedulers()).length).toBe(1);expect((await loadSchedulerJob(prepared.id)).enabled).toBe(true);
}));
test('scheduler rebind uses CAS and creates a new unregistered ID while preserving old definition',()=>fixture(async root=>{
  await trustWorkspace(root);const old=await prepareAutomationScheduler(root,entry,9),status=await inspectAutomationScheduler(old.id);
  await expect(rebindAutomationScheduler(old.id,entry,'0'.repeat(64),true)).rejects.toThrow('current');
  await expect(rebindAutomationScheduler(old.id,entry,status.expectedDigest,false)).rejects.toThrow('confirm');
  const updated=await rebindAutomationScheduler(old.id,entry,status.expectedDigest,true);
  expect(updated.osTaskRegistered).toBe(false);expect(updated.replacement.id).not.toBe(old.id);expect(updated.replacement.installed).toBe(false);
  expect((await loadSchedulerJob(old.id)).enabled).toBe(false);expect((await loadSchedulerJob(updated.replacement.id)).minutes).toBe(9);
  expect((await tickAutomationScheduler(old.id)).disabled).toBe(true);expect(await readFile(old.definition,'utf8')).toContain(old.id);
  await expect(rebindAutomationScheduler(old.id,entry,status.expectedDigest,true)).rejects.toThrow('current');
}));
test('uninstall without confirmation never changes an owned job or invokes OS removal',()=>fixture(async root=>{
  await trustWorkspace(root);const job=await prepareAutomationScheduler(root,entry),status=await inspectAutomationScheduler(job.id);
  await expect(uninstallAutomationScheduler(job.id,status.expectedDigest,false)).rejects.toThrow('confirm');
  expect((await loadSchedulerJob(job.id)).enabled).toBe(true);
}));
test('scheduler ownership checks reject a foreign action, principal, multiple Exec and DTD',()=>fixture(async root=>{
  await trustWorkspace(root);const prepared=await prepareAutomationScheduler(root,entry),job=await loadSchedulerJob(prepared.id),xml=schedulerTaskXml(job);
  expect(()=>assertOwnedSchedulerTask(job,xml)).not.toThrow();
  for(const text of [xml.replace('<Command>','<Command>evil'),xml.replace('<RunLevel>LeastPrivilege','<RunLevel>HighestAvailable'),xml.replace('</Actions>','<Exec></Exec></Actions>'),xml.replace('</Actions>','<ComHandler><ClassId>foreign</ClassId></ComHandler></Actions>'),'<!DOCTYPE Task>'+xml,xml.replace('<UserId>','<UserId>foreign')])expect(()=>assertOwnedSchedulerTask(job,text)).toThrow();
  const sid='S-1-5-21-123-456-789-1001',sidXml=xml.replace(/<UserId>[^<]*<\/UserId>/,`<UserId>${sid}</UserId>`);
  expect(()=>assertOwnedSchedulerTask(job,sidXml,sid)).not.toThrow();expect(()=>assertOwnedSchedulerTask(job,sidXml,'S-1-5-18')).toThrow();
}));
test('malformed scheduler records are reported but never run',()=>fixture(async(root,home)=>{
  const id='scheduler_1111111111111111';await writeJson(join(home,'schedulers',id,'job.json'),{version:1,id,home,runtime:55});
  expect(await listAutomationSchedulers()).toEqual([{id,invalid:true,action:'Inspect this local job; it was not executed or repaired'}]);await expect(loadSchedulerJob(id)).rejects.toThrow('Invalid');
}));

test('20 concurrent notification writers retain all records and metadata-only events',()=>fixture(async root=>{
  const rows=await Promise.all(Array.from({length:20},(_,i)=>createProjectNotification(root,{title:`Task ${i}`,body:'PRIVATE-BODY'})));
  expect(new Set(rows.map(row=>row.id)).size).toBe(20);expect((await listProjectNotifications(root)).unread).toBe(20);
  const replay=await projectEventsAfter(root);expect(replay.events.filter(row=>row.topic==='notifications')).toHaveLength(20);expect(JSON.stringify(replay)).not.toContain('PRIVATE');
}));
test('notification idempotency and list are side-effect free',()=>fixture(async root=>{
  const first=await createProjectNotification(root,{title:'One',body:'Body',sourceKey:'delivery:one'}),before=await readFile(join(root,'.ccpt/notifications.json'),'utf8');
  const repeated=await createProjectNotification(root,{title:'Changed',body:'Body',sourceKey:'delivery:one'});expect(repeated.id).toBe(first.id);
  const page=await listProjectNotifications(root);expect(page.items[0]!.readAt).toBeUndefined();expect(await readFile(join(root,'.ccpt/notifications.json'),'utf8')).toBe(before);
}));
test('stale/multi-window notification acknowledgements cannot mark new arrivals or grant approvals',()=>fixture(async root=>{
  const one=await createProjectNotification(root,{title:'One',body:'Body'}),before=await listProjectNotifications(root);
  await createProjectNotification(root,{title:'Two',body:'Body'});
  await expect(markProjectNotificationsRead(root,[one.id],before.version)).rejects.toThrow('changed');
  const fresh=await listProjectNotifications(root),outcomes=await Promise.allSettled([markProjectNotificationsRead(root,[one.id],fresh.version),markProjectNotificationsRead(root,[one.id],fresh.version)]);
  expect(outcomes.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  expect((outcomes.find(row=>row.status==='fulfilled') as PromiseFulfilledResult<any>).value.grantsPermission).toBe(false);
  expect((await listProjectNotifications(root,{unreadOnly:true})).items.map(row=>row.title)).toEqual(['Two']);
}));
test('notification retention, pagination and strict bounds are enforced',()=>fixture(async root=>{
  const now=new Date().toISOString(),rows=Array.from({length:500},(_,i)=>({id:`notification_${i.toString(16).padStart(16,'0')}`,title:String(i),body:'',level:'info',createdAt:now}));
  await writeJson(join(root,'.ccpt/notifications.json'),rows);await createProjectNotification(root,{title:'Newest',body:''});
  const page=await listProjectNotifications(root,{limit:100});expect(page.total).toBe(500);expect(page.nextOffset).toBe(100);expect(page.items[0]!.title).toBe('Newest');
  expect((await listProjectNotifications(root,{offset:499})).items[0]!.title).toBe('1');
  await expect(listProjectNotifications(root,{limit:101})).rejects.toThrow('bounds');
  await expect(markProjectNotificationsRead(root,[],'0'.repeat(64))).rejects.toThrow('Select');
}));
test('notification loading rejects corruption and projects away unknown fields',()=>fixture(async root=>{
  const item=await createProjectNotification(root,{title:'Safe',body:''});await writeJson(join(root,'.ccpt/notifications.json'),[{...item,privateExtra:'DO-NOT-RETURN'}]);
  expect(JSON.stringify(await listProjectNotifications(root))).not.toContain('DO-NOT-RETURN');await writeFile(join(root,'.ccpt/notifications.json'),'{broken');await expect(listProjectNotifications(root)).rejects.toThrow();
}));

test('StopFailure only classifies structured provider errors and redacts diagnostics',()=>{
  expect(stopFailurePayload(new Error('429 tool text'))).toBeUndefined();expect(stopFailurePayload(new ContextLimitError('local limit','local'))).toBeUndefined();
  expect(stopFailurePayload(new ModelRequestError('401 Bearer PRIVATE_SECRET',401))?.error).toBe('authentication_failed');
  expect(JSON.stringify(stopFailurePayload(new ModelRequestError('401 Bearer PRIVATE_SECRET',401)))).not.toContain('PRIVATE_SECRET');
  expect(stopFailurePayload(new Error('wrapper',{cause:new ModelRequestError('bad model',404)}))?.error).toBe('model_not_found');
});
test('all StopFailure observers run despite exit 2/block output, without a retry verdict',()=>fixture(async root=>{
  const config=structuredClone(defaultConfig),log=join(root,'failure.jsonl');config.hooks=[{event:'StopFailure',matcher:'invalid_*',command:`node "${hook}" fail "${log}"`},{event:'StopFailure',matcher:'invalid_*',command:`node "${hook}" deny "${log}"`}];
  const result=await runHooks(config,'StopFailure',{error:'invalid_request',sessionId:'session_fixture'},root);expect(result).toEqual({additionalContext:[]});expect((await readFile(log,'utf8')).trim().split('\n')).toHaveLength(2);
}));

async function actualAgent(root:string,mode:string,error=false) {
  const requests:any[]=[],log=join(root,'lifecycle.jsonl'),server=Bun.serve({port:0,async fetch(request){requests.push(await request.json());return error?Response.json({error:{message:'Invalid tool schema',code:'invalid_schema'}},{status:400}):Response.json({choices:[{message:{content:'VERIFIED'},finish_reason:'stop'}]});}});
  const config=structuredClone(defaultConfig);config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/v1/chat/completions`;config.model.apiKeyEnv='';config.marketplaceEnabled=false;config.disableBundledSkills=true;config.policy.workspaceRoots=[root];config.agents.defaultIsolation='none';config.agents.maxTurns=12;
  config.hooks=error?[{event:'StopFailure',command:`node "${hook}" deny "${log}"`},{event:'Stop',command:`node "${hook}" deny "${log}"`}]:[{event:'Stop',command:`node "${hook}" ${mode} "${log}"`}];
  await writeJson(join(root,'.ccpt/settings.json'),config);
  try{return {agent:await spawnAgent({cwd:root,config,goal:'Explain the fixture architecture without tools.',background:false,isolation:'none'}),requests,log};}finally{server.stop(true);}
}
test('actual Agent Stop additionalContext continues the same session then accepts completion',()=>fixture(async root=>{
  const {agent,requests}=await actualAgent(root,'soft-first');expect(agent.status).toBe('completed');expect(requests).toHaveLength(2);expect(JSON.stringify(requests[1])).toContain('Stop hook feedback');expect(JSON.stringify((await loadSession(agent.sessionId)).messages)).toContain('MORE_VERIFICATION');
  expect((await listProjectNotifications(root)).items.map(row=>row.title)).toEqual(['Agent completed']);
}),20000);
test('repeated Stop feedback is bounded and preserves the waiting conversation',()=>fixture(async root=>{
  const {agent,requests}=await actualAgent(root,'soft-always');expect(agent.status).toBe('waiting_for_input');expect(requests).toHaveLength(8);expect((await loadSession(agent.sessionId)).messages.length).toBeGreaterThan(8);expect((await listProjectNotifications(root)).items.some(row=>row.title==='Agent completed')).toBe(false);
}),20000);
test('actual provider failure emits StopFailure, not Stop, and is never turned into a retry',()=>fixture(async root=>{
  const {agent,requests,log}=await actualAgent(root,'deny',true);expect(agent.status).toBe('failed');expect(requests).toHaveLength(1);expect(agent.error).toContain('invalid_schema');
  const rows=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({hook_event_name:'StopFailure',error:'invalid_request',session_id:agent.sessionId});
}));

test('global trust registry changes invalidate watched extension authority and revoke loading',()=>fixture(async(root,home)=>{
  const shared=join(root,'shared'),workspace=join(root,'workspace');await mkdir(shared);await mkdir(workspace);await setGlobalExtensionTrust(shared,'skill',true,true);await writeJson(join(home,'settings.json'),{skillsDirectories:[shared]});
  await loadConfig(workspace);let changes=0;const stop=watchLocalState(extensionAuthorityWatchPaths(workspace),()=>{changes++;},{intervalMs:100,initial:true});
  try{await until(()=>changes>0);const before=changes;await setGlobalExtensionTrust(shared,'skill',false,true);await until(()=>changes>before);await expect(loadConfig(workspace)).rejects.toThrow('not approved');}finally{stop();}
}));
test('mailbox read receipts and Team cleanup publish durable invalidations',()=>fixture(async(root,home)=>{
  const session=await createSession('team',root),now=new Date().toISOString();
  const owner:AgentRecord={id:createId('agent'),sessionId:session.id,cwd:root,role:'lead',goal:'Fixture',depth:0,status:'completed',createdAt:now,updatedAt:now};
  const member:AgentRecord={...owner,id:createId('agent'),parentId:owner.id,teamSessionId:session.id};
  await writeJson(join(home,'agents',`${owner.id}.json`),owner);await writeJson(join(home,'agents',`${member.id}.json`),member);
  const team=await createTeam('fixture',owner.id);await sendTeamMessage({teamSessionId:session.id,fromAgentId:owner.id,toAgentId:member.id,content:'PRIVATE-MESSAGE'});
  const before=await projectEventsAfter(root);await readTeamMailbox({teamSessionId:session.id,agentId:member.id});await deleteTeam(team.id);
  const after=await projectEventsAfter(root,before.cursor);expect(after.events.map(row=>row.topic)).toContain('inbox');expect(after.events.map(row=>row.topic)).toContain('teams');expect(JSON.stringify(after)).not.toContain('PRIVATE');
}));
test('Agent membership metadata changes invalidate views but repeated status saves do not duplicate notifications',()=>fixture(async root=>{
  const session=await createSession('agent',root),now=new Date().toISOString(),record:AgentRecord={id:createId('agent'),sessionId:session.id,cwd:root,role:'one',goal:'Fixture',depth:0,status:'completed',createdAt:now,updatedAt:now};
  await saveAgent(record);const before=await projectEventsAfter(root);record.role='two';await saveAgent(record);await saveAgent(record);
  expect((await projectEventsAfter(root,before.cursor)).events.filter(row=>row.topic==='agents')).toHaveLength(1);expect((await listProjectNotifications(root)).total).toBe(1);
}));
