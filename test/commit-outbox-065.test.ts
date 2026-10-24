import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectPlan, transitionProjectPlan, loadProjectPlan } from '../src/plans.js';
import { createProjectNotification, listProjectNotifications, markProjectNotificationsRead } from '../src/notifications.js';
import { recoverProjectOutboxes } from '../src/projectOutbox.js';
import { projectEventsAfter } from '../src/projectEvents.js';
import { enqueueCommit } from '../src/commitOutbox.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
async function fixture(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-outbox065-'));try{await action(root);}finally{await removeOwnedTemporaryFixture(root);}}
const statePath=(root:string)=>join(root,'.ccpt/plans/index.json');
const journalPath=(root:string)=>join(root,'.ccpt/ide-events.json');
test('committed Plan succeeds during journal failure and reconnect recovers exact metadata once',()=>fixture(async root=>{
 await writeJson(journalPath(root),{broken:true});
 const plan=await createProjectPlan({cwd:root,request:'PRIVATE request',content:'# PRIVATE body'});
 const state=JSON.parse(await readFile(statePath(root),'utf8'));expect(state.outbox.pending).toHaveLength(1);expect((await loadProjectPlan(root,plan.id)).version).toBe(1);
 expect((await recoverProjectOutboxes(root))[0]!.ok).toBe(false);
 await writeJson(journalPath(root),{generation:'events_1111111111111111',sequence:0,events:[]});
 const replay=await projectEventsAfter(root);expect(replay.events.map(e=>e.topic)).toEqual(['plans']);expect(JSON.stringify(replay)).not.toContain('PRIVATE');expect(replay.replayIsAuthorization).toBe(false);
 expect(JSON.parse(await readFile(statePath(root),'utf8')).outbox.pending).toEqual([]);
 // Simulate kill after publish but before snapshot checkpoint acknowledgement.
 await writeJson(statePath(root),state);await recoverProjectOutboxes(root);expect((await projectEventsAfter(root)).events).toHaveLength(1);
}));
test('failed CAS emits no commit and concurrent approval has a single winner',()=>fixture(async root=>{
 const plan=await createProjectPlan({cwd:root,request:'r',content:'# Plan'}),before=await readFile(statePath(root),'utf8');
 await expect(transitionProjectPlan(root,plan.id,'approved',{expectedVersion:999})).rejects.toThrow('changed');expect(await readFile(statePath(root),'utf8')).toBe(before);
 const decisions=await Promise.allSettled([transitionProjectPlan(root,plan.id,'approved',{expectedVersion:1}),transitionProjectPlan(root,plan.id,'rejected',{expectedVersion:1})]);
 expect(decisions.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await projectEventsAfter(root)).events).toHaveLength(2);
}));
test('full outbox backpressures before Plan file writes; malformed queues fail closed',()=>fixture(async root=>{
 await createProjectPlan({cwd:root,request:'r',content:'# Plan'});const state=JSON.parse(await readFile(statePath(root),'utf8'));
 for(let i=0;i<256;i++)state.outbox=enqueueCommit(state.outbox);
 await writeJson(statePath(root),state);const before=await readdir(join(root,'.ccpt/plans'));
 await expect(createProjectPlan({cwd:root,request:'r',content:'# Another'})).rejects.toThrow('full');expect(await readdir(join(root,'.ccpt/plans'))).toEqual(before);
 state.outbox.pending[0].sequence=99;await writeJson(statePath(root),state);await expect(loadProjectPlan(root,state.plans[0].id)).rejects.toThrow('outbox');
}));
test('notification legacy migration, source dedup, CAS and committed recovery preserve body privacy',()=>fixture(async root=>{
 const path=join(root,'.ccpt/notifications.json');await writeJson(path,[]);await writeFile(journalPath(root),'{broken');
 const first=await createProjectNotification(root,{title:'PRIVATE',body:'PRIVATE body',sourceKey:'one'});
 expect((await createProjectNotification(root,{title:'unused',body:'',sourceKey:'one'})).id).toBe(first.id);
 const page=await listProjectNotifications(root);await markProjectNotificationsRead(root,[first.id],page.version);
 const stored=JSON.parse(await readFile(path,'utf8'));expect(stored.format).toBe(1);expect(stored.outbox.pending).toHaveLength(2);
 await writeJson(journalPath(root),{generation:'events_2222222222222222',sequence:0,events:[]});
 const replay=await projectEventsAfter(root);expect(replay.events).toHaveLength(2);expect(JSON.stringify(replay)).not.toContain('PRIVATE');expect((await listProjectNotifications(root)).unread).toBe(0);
 await writeJson(path,stored);await Promise.all([recoverProjectOutboxes(root),recoverProjectOutboxes(root)]);expect((await projectEventsAfter(root)).events).toHaveLength(2);
}));
test('restored producer generation mismatch is diagnosed without replaying business state',()=>fixture(async root=>{
 await createProjectPlan({cwd:root,request:'r',content:'# Plan'});const state=JSON.parse(await readFile(statePath(root),'utf8'));
 state.outbox={generation:'outbox_3333333333333333',sequence:1,acknowledged:0,pending:[{sequence:1,at:new Date().toISOString()}]};await writeJson(statePath(root),state);
 expect((await recoverProjectOutboxes(root))[0]!.ok).toBe(false);expect((await projectEventsAfter(root)).events).toHaveLength(1);expect((await readFile(statePath(root),'utf8'))).toContain('outbox_3333333333333333');
}));
test('producer dedup checkpoint survives event-ring eviction and does not replay old approval',()=>fixture(async root=>{
 await createProjectPlan({cwd:root,request:'r',content:'# Plan'});const state=JSON.parse(await readFile(statePath(root),'utf8')),journal=JSON.parse(await readFile(journalPath(root),'utf8'));
 state.outbox.acknowledged=0;state.outbox.pending=[{sequence:1,at:new Date().toISOString()}];
 journal.sequence=1026;journal.events=Array.from({length:1024},(_,i)=>({sequence:i+3,topic:'workspace',at:new Date().toISOString()}));await writeJson(journalPath(root),journal);await writeJson(statePath(root),state);
 await recoverProjectOutboxes(root);const final=JSON.parse(await readFile(journalPath(root),'utf8'));expect(final.sequence).toBe(1026);expect(final.committed.plans.sequence).toBe(1);expect(JSON.parse(await readFile(statePath(root),'utf8')).outbox.pending).toEqual([]);
}));
