import { test, expect } from 'bun:test';
import { mkdtemp, readFile, mkdir, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeJson } from '../src/storage.js';
import { createTask, updateTask, loadTask } from '../src/tasks.js';
import { saveAgent, loadAgent } from '../src/agent.js';
import { createTeam, deleteTeam, listTeams } from '../src/teamStore.js';
import { readTeamMailbox, sendTeamMessage } from '../src/mailbox.js';
import { projectEventsAfter } from '../src/projectEvents.js';
import { recoverProjectOutboxes } from '../src/projectOutbox.js';
import { enqueueCommit } from '../src/commitOutbox.js';
import { commitRuntimeSnapshot, recoverRuntimeOutboxes } from '../src/runtimeOutbox.js';
import type { AgentRecord } from '../src/types.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
import { withEphemeralSession } from '../src/ephemeralSession.js';
import { defaultConfig } from '../src/config.js';
const session='session_1111111111111111',agent='agent_1111111111111111',member='agent_2222222222222222';
async function fixture(action:(root:string,home:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-runtime067-')),old=process.env.CCPT_HOME;const home=join(root,'home');process.env.CCPT_HOME=home;try{await writeJson(join(home,'sessions',session+'.json'),{id:session,cwd:root});await action(root,home);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
const journal=(root:string)=>join(root,'.ccpt/ide-events.json');
const corrupt=(root:string)=>writeJson(journal(root),{broken:true});
const repair=(root:string)=>writeJson(journal(root),{generation:'events_1111111111111111',sequence:0,events:[]});
const record=(root:string,id=agent):AgentRecord=>({id,sessionId:session,teamSessionId:session,cwd:root,role:'lead',goal:'PRIVATE',depth:0,status:'completed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});

test('task create/update commit despite event failure, reconnect publishes metadata exactly once and strips internal queues',()=>fixture(async(root,home)=>{
 await corrupt(root);const task=await createTask({teamSessionId:session,title:'PRIVATE TASK'});await updateTask(task.id,{status:'in_progress'});
 const path=join(home,'tasks',task.id+'.json'),snapshot=JSON.parse(await readFile(path,'utf8'));expect(snapshot._projectDelivery.targets[0].outbox.pending).toHaveLength(2);expect(await loadTask(task.id)).not.toHaveProperty('_projectDelivery');
 await repair(root);const events=await projectEventsAfter(root);expect(events.events.map(row=>row.topic)).toEqual(['tasks','tasks']);expect(JSON.stringify(events)).not.toContain('PRIVATE');expect(events.replayIsAuthorization).toBe(false);
 await writeJson(path,snapshot);await Promise.all([recoverRuntimeOutboxes(root),recoverRuntimeOutboxes(root)]);expect((await projectEventsAfter(root)).events).toHaveLength(2);
}));
test('concurrent task updates preserve every committed sequence under the same owner lock',()=>fixture(async(root,home)=>{
 await corrupt(root);const task=await createTask({teamSessionId:session,title:'parallel'});await Promise.all(Array.from({length:12},(_,i)=>updateTask(task.id,{result:String(i)})));
 const state=JSON.parse(await readFile(join(home,'tasks',task.id+'.json'),'utf8'));expect(state._projectDelivery.targets[0].outbox.sequence).toBe(13);await repair(root);expect((await projectEventsAfter(root)).events.filter(row=>row.topic==='tasks')).toHaveLength(13);
}));
test('Agent status delivery recovers without reconciling dead processes or replaying a worker',()=>fixture(async(root,home)=>{
 await corrupt(root);await saveAgent(record(root));const path=join(home,'agents',agent+'.json');expect(await loadAgent(agent)).not.toHaveProperty('_projectDelivery');
 const before=JSON.parse(await readFile(path,'utf8'));before.status='working';before.pid=2147483000;await writeJson(path,before);await repair(root);await recoverProjectOutboxes(root);expect((await loadAgent(agent)).status).toBe('working');expect((await projectEventsAfter(root)).events.some(row=>row.topic==='agents')).toBe(true);
}));
test('team deletion retains a hidden durable tombstone and recovers after journal outage',()=>fixture(async(root,home)=>{
 await saveAgent(record(root));await corrupt(root);const team=await createTeam('PRIVATE TEAM',agent);await deleteTeam(team.id);expect(await listTeams()).toEqual([]);const state=JSON.parse(await readFile(join(home,'teams',team.id+'.json'),'utf8'));expect(state._deletedAt).toBeString();expect(state._projectDelivery.targets[0].outbox.pending).toHaveLength(2);
 await repair(root);expect((await projectEventsAfter(root)).events.filter(row=>row.topic==='teams')).toHaveLength(2);expect(await listTeams()).toEqual([]);
}));
test('legacy mailbox migrates atomically, read-only remains write-free, unread acknowledgement has committed outbox',()=>fixture(async(root,home)=>{
 await saveAgent(record(root));await saveAgent({...record(root,member),parentId:agent});const path=join(home,'teams',session,'mailboxes',member+'.json');await writeJson(path,[]);await corrupt(root);
 await sendTeamMessage({teamSessionId:session,fromAgentId:agent,toAgentId:member,content:'PRIVATE MESSAGE'});const before=await readFile(path,'utf8');expect(await readTeamMailbox({teamSessionId:session,agentId:member,markRead:false})).toHaveLength(1);expect(await readFile(path,'utf8')).toBe(before);
 await readTeamMailbox({teamSessionId:session,agentId:member});const snapshot=JSON.parse(await readFile(path,'utf8'));expect(snapshot.messages[0].read).toBe(true);expect(snapshot._projectDelivery.targets[0].outbox.pending).toHaveLength(2);
 await repair(root);const replay=await projectEventsAfter(root);expect(replay.events.filter(row=>row.topic==='inbox')).toHaveLength(2);expect(JSON.stringify(replay)).not.toContain('PRIVATE MESSAGE');
}));
test('record queue saturation applies backpressure before changing task body',()=>fixture(async(root,home)=>{
 await corrupt(root);const task=await createTask({teamSessionId:session,title:'original'}),path=join(home,'tasks',task.id+'.json'),snapshot=JSON.parse(await readFile(path,'utf8'));const target=snapshot._projectDelivery.targets[0];while(target.outbox.pending.length<256)target.outbox=enqueueCommit(target.outbox);await writeJson(path,snapshot);const before=await readFile(path,'utf8');await expect(updateTask(task.id,{result:'must not commit'})).rejects.toThrow('full');expect(await readFile(path,'utf8')).toBe(before);
}));
test('dedup checkpoints survive visible ring eviction, and producer capacity never evicts old IDs',()=>fixture(async(root,home)=>{
 const task=await createTask({teamSessionId:session,title:'task'}),path=join(home,'tasks',task.id+'.json'),snapshot=JSON.parse(await readFile(path,'utf8'));const target=snapshot._projectDelivery.targets[0];target.outbox.acknowledged=0;target.outbox.pending=[{sequence:1,at:new Date().toISOString()}];await writeJson(path,snapshot);
 const state=JSON.parse(await readFile(journal(root),'utf8'));state.sequence=1100;state.events=[{sequence:1100,topic:'workspace',at:new Date().toISOString()}];await writeJson(journal(root),state);await recoverRuntimeOutboxes(root);expect(JSON.parse(await readFile(journal(root),'utf8')).sequence).toBe(1100);
 for(let i=0;i<4095;i++)state.committed[`tasks:task_${i.toString(16).padStart(16,'0')}`]={generation:'outbox_2222222222222222',sequence:1};await writeJson(journal(root),state);await updateTask(task.id,{result:'updated'});const next=await createTask({teamSessionId:session,title:'backpressure event only'});expect((await loadTask(next.id)).title).toBe('backpressure event only');expect((await recoverRuntimeOutboxes(root)).failed).toBeGreaterThan(0);
}));
test('malformed binding, directory junction and producer identity mismatch fail closed',()=>fixture(async(root,home)=>{
 const task=await createTask({teamSessionId:session,title:'task'}),path=join(home,'tasks',task.id+'.json'),state=JSON.parse(await readFile(path,'utf8'));state._projectDelivery.targets[0].cwd='relative';await writeJson(path,state);await expect(updateTask(task.id,{result:'bad'})).rejects.toThrow('workspace');
 await mkdir(join(root,'outside'));await symlink(join(root,'outside'),join(home,'agents'),'junction');await expect(recoverRuntimeOutboxes(root)).rejects.toThrow('links');
}));
test('runtime outbox workspace binding cannot silently switch to another project',()=>fixture(async(root,home)=>{
 const path=join(home,'tasks','task_3333333333333333.json');await commitRuntimeSnapshot(path,'tasks','task_3333333333333333',{title:'one'},[root]);await expect(commitRuntimeSnapshot(path,'tasks','task_3333333333333333',{title:'two'},[join(root,'elsewhere')])).rejects.toThrow('binding');expect(JSON.parse(await readFile(path,'utf8')).title).toBe('one');
}));
test('ephemeral setup and later runtime config never bind or publish persistent workspace events',()=>fixture(async(root)=>{
 await withEphemeralSession(structuredClone(defaultConfig),async config=>{
  const home=process.env.CCPT_HOME!;await writeJson(join(home,'sessions',session+'.json'),{id:session,cwd:root});
  const task=await createTask({teamSessionId:session,title:'EPHEMERAL'});const value=record(root);value.status='queued';await saveAgent(value);
  await writeJson(join(home,'agents-runtime',agent+'.json'),config);value.status='completed';await saveAgent(value);await updateTask(task.id,{status:'completed'});
  expect(JSON.parse(await readFile(join(home,'tasks',task.id+'.json'),'utf8'))).not.toHaveProperty('_projectDelivery');
  expect(JSON.parse(await readFile(join(home,'agents',agent+'.json'),'utf8'))).not.toHaveProperty('_projectDelivery');
 });
 await expect(access(journal(root))).rejects.toHaveProperty('code','ENOENT');
 await expect(access(join(root,'.ccpt/notifications.json'))).rejects.toHaveProperty('code','ENOENT');
}));
