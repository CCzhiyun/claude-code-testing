import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,unlink,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {defaultConfig,validateConfig} from '../src/config.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {writeJson,readJson} from '../src/storage.js';
import {prepareAutomationScheduler,loadSchedulerJob,tickAutomationScheduler} from '../src/automationScheduler.js';
import {previewSchedulerMigration,migrateLegacyScheduler} from '../src/schedulerMigration.js';
import {inspectAutomationScheduler} from '../src/schedulerManagement.js';
import {startHookFileWatch} from '../src/hookFileWatch.js';
import {reviewConflictResolution,resolveConflict} from '../src/conflictResolution.js';
import {indexSharedObject} from '../src/gitIndexSnapshot.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
async function fixture(action:(root:string,config:typeof defaultConfig)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-platform066-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');
 const config=structuredClone(defaultConfig);config.hooks=[];config.disableBundledSkills=true;config.marketplaceEnabled=false;config.policy.workspaceRoots=[root];
 try{await trustWorkspace(root);await action(root,config);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
async function legacy(root:string){const entry=join(root,'cli.mjs');await writeFile(entry,'throw new Error("must never execute this entry")');const prepared=await prepareAutomationScheduler(root,entry);const job=await loadSchedulerJob(prepared.id);delete job.entrySha256;await writeJson(join(process.env.CCPT_HOME!,'schedulers',job.id,'job.json'),job);return {entry,job,path:join(process.env.CCPT_HOME!,'schedulers',job.id)};}
test('legacy scheduler ticks/install require migration, reviewed replacement binds bytes without executing old entry or OS registration',()=>fixture(async root=>{
 const {entry,job,path}=await legacy(root);await expect(tickAutomationScheduler(job.id)).rejects.toThrow('unbound');expect((await inspectAutomationScheduler(job.id)).entryBound).toBe(false);
 const review=await previewSchedulerMigration(job.id,entry);expect((await loadSchedulerJob(job.id)).enabled).toBe(true);expect(review.retained).toBeNull();await expect(migrateLegacyScheduler(job.id,entry,review.expectedDigest,false)).rejects.toThrow('confirm');
 const result=await migrateLegacyScheduler(job.id,entry,review.expectedDigest,true);expect(result.osTaskRegistered).toBe(false);expect(result.wakeupsRebound).toBe(false);expect((await loadSchedulerJob(job.id)).enabled).toBe(false);expect((await loadSchedulerJob(result.replacement.id)).entrySha256).toHaveLength(64);expect(await readJson(join(path,'migration.json'),null)).toMatchObject({phase:'prepared',replacementId:result.replacement.id});expect((await tickAutomationScheduler(job.id)).disabled).toBe(true);
 await expect(migrateLegacyScheduler(job.id,entry,(await previewSchedulerMigration(job.id,entry)).expectedDigest,true)).rejects.toThrow('already started');
}),15000);
test('migration entry/config/CAS changes and unknown claims never silently prepare another replacement',()=>fixture(async root=>{
 const {entry,job,path}=await legacy(root),review=await previewSchedulerMigration(job.id,entry);await writeFile(entry,'changed');await expect(migrateLegacyScheduler(job.id,entry,review.expectedDigest,true)).rejects.toThrow('changed');expect((await loadSchedulerJob(job.id)).enabled).toBe(true);
 const fresh=await previewSchedulerMigration(job.id,entry);await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false});await expect(migrateLegacyScheduler(job.id,entry,fresh.expectedDigest,true)).rejects.toThrow('changed');
 const last=await previewSchedulerMigration(job.id,entry);await writeJson(join(path,'migration.json'),{format:1,phase:'preparing',reviewDigest:last.expectedDigest});await expect(migrateLegacyScheduler(job.id,entry,last.expectedDigest,true)).rejects.toThrow('already started');
}),15000);
test('migration concurrent approvals have one winner; paid legacy schedules require new approval',()=>fixture(async root=>{
 const {entry,job,path}=await legacy(root),review=await previewSchedulerMigration(job.id,entry);const results=await Promise.allSettled(Array.from({length:8},()=>migrateLegacyScheduler(job.id,entry,review.expectedDigest,true)));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 job.readOnly={maxRequests:1,maxTokens:4096,maxRuns:1,deploymentDigest:'a'.repeat(64)};await writeJson(join(path,'job.json'),job);await expect(previewSchedulerMigration(job.id,entry)).rejects.toThrow('fresh explicit prepare');
}),15000);
const until=async(check:()=>boolean|Promise<boolean>)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){if(await check())return;await Bun.sleep(30);}throw new Error('Timed out waiting for observer');};
async function watcher(root:string,config:typeof defaultConfig){const log=join(root,'events.jsonl'),script=join(root,'observer.cjs');await writeFile(script,`let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>require('fs').appendFileSync(${JSON.stringify(log)},s+'\\n'));`);config.hooks=[{event:'FileChanged',watchDirectories:[{path:'src',recursive:true,exclude:['ignored'],maxFiles:8}],command:`node "${script}"`}];const stop=startHookFileWatch(config,root,{}, {intervalMs:100});await until(()=>stop.status().phase==='watching');return {stop,log,rows:async()=>{try{return(await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}}};}
test('recursive metadata watcher sees add/change/delete, skips dependencies/state/exclusions and never captures contents',()=>fixture(async(root,config)=>{
 await mkdir(join(root,'src/nested'),{recursive:true});await writeFile(join(root,'src/nested/old.ts'),'old');const w=await watcher(root,config);
 try{await writeFile(join(root,'src/nested/old.ts'),'changed-secret-contents');await until(async()=>(await w.rows()).length===1);await writeFile(join(root,'src/nested/new.ts'),'new');await until(async()=>(await w.rows()).length===2);await unlink(join(root,'src/nested/old.ts'));await until(async()=>(await w.rows()).length===3);
 for(const name of ['ignored','node_modules','.git','.ccpt']){await mkdir(join(root,'src',name));await writeFile(join(root,'src',name,'hidden.ts'),'hidden');}await Bun.sleep(350);const rows=await w.rows();expect(rows.map(r=>r.change)).toEqual(['modified','created','deleted']);expect(JSON.stringify(rows)).not.toContain('secret-contents');expect(w.stop.status().files).toBe(1);
 }finally{w.stop();expect(w.stop.status().phase).toBe('stopped');}
}),15000);
test('overflow retains baseline, recovery does not invent deletion; authorized update resets baselines',()=>fixture(async(root,config)=>{
 await mkdir(join(root,'src'));await writeFile(join(root,'src/a.ts'),'a');const w=await watcher(root,config);
 try{for(let n=0;n<9;n++)await writeFile(join(root,`src/file${n}.ts`),'x');await until(()=>w.stop.status().phase==='blocked');expect(await w.rows()).toEqual([]);
 for(let n=0;n<9;n++)await unlink(join(root,`src/file${n}.ts`));await until(()=>w.stop.status().phase==='watching');expect(await w.rows()).toEqual([]);
 config.hooks[0]!.watchDirectories=[{path:'other',recursive:true}];await mkdir(join(root,'other'));w.stop.update(config);await until(()=>w.stop.status().phase==='watching');await writeFile(join(root,'src/a.ts'),'revoked');await writeFile(join(root,'other/b.ts'),'b');await until(async()=>(await w.rows()).length===1);expect((await w.rows())[0].relative_path).toBe('other/b.ts');
 config.hooks[0]!.watchDirectories=[{path:'../escape'}];expect(()=>w.stop.update(config)).toThrow();await writeFile(join(root,'other/c.ts'),'c');await Bun.sleep(250);expect(await w.rows()).toHaveLength(1);expect(w.stop.status().phase).toBe('blocked');
 }finally{w.stop();}
}),15000);
test('watch declaration validation and link/depth boundaries fail closed',()=>fixture(async(root,config)=>{
 config.hooks=[{event:'FileChanged',command:'node',watchDirectories:[{path:'src',maxFiles:513}]}];expect(()=>validateConfig(config)).toThrow('watchDirectories');
 config.hooks[0]!.watchDirectories=[{path:'src',maxDepth:-1}];expect(()=>startHookFileWatch(config,root)).toThrow();config.hooks[0]!.watchDirectories=[{path:'src',recursive:true,maxDepth:0}];await mkdir(join(root,'src/nested'),{recursive:true});await writeFile(join(root,'src/nested/deep'),'hidden');const stop=startHookFileWatch(config,root,{}, {intervalMs:100});try{await until(()=>stop.status().phase==='watching');expect(stop.status().files).toBe(0);}finally{stop();}
 const outside=join(root,'outside');await mkdir(outside);await symlink(outside,join(root,'src/link'),'junction');config.hooks[0]!.watchDirectories=[{path:'src/link',recursive:true}];expect(()=>startHookFileWatch(config,root)).toThrow('links');
}),15000);
async function conflict(root:string,format:'sha1'|'sha256'='sha1',version=2){const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();git('init',`--object-format=${format}`);git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');await writeFile(join(root,'file.dat'),Buffer.from([0,1]));await writeFile(join(root,'untouched.txt'),'keep');git('add','file.dat','untouched.txt');git('commit','-m','base');const branch=git('branch','--show-current');git('checkout','-b','other');await writeFile(join(root,'file.dat'),Buffer.from([0,2]));git('commit','-am','theirs');git('checkout',branch);await writeFile(join(root,'file.dat'),Buffer.from([0,3]));git('commit','-am','ours');try{git('merge','other');}catch{}git('update-index',`--index-version=${version}`);git('config','core.splitIndex','true');git('update-index','--split-index');return git;}
for(const choice of ['ours','theirs','delete'] as const)test(`split-index conflict ${choice} retains shared object and publishes full independent index`,()=>fixture(async(root,config)=>{
 const git=await conflict(root),head=git('rev-parse','HEAD'),shared=resolve(root,git('rev-parse','--shared-index-path')),original=await readFile(shared),before=await readFile(join(root,'.git/index')),review=await reviewConflictResolution(root,'file.dat',config);
 const result=await resolveConflict(root,'file.dat',choice,review.version,true,config);expect(git('ls-files','--unmerged')).toBe('');expect(indexSharedObject(await readFile(join(root,'.git/index')))).toBeUndefined();expect(git('config','--get','core.splitIndex')).toBe('true');expect(git('rev-parse','HEAD')).toBe(head);expect(await readFile(shared)).toEqual(original);expect(await readFile(join(result.backup,'index.original'))).toEqual(before);const receipt:any=await readJson(join(result.backup,'receipt.json'),null);expect(await readFile(join(result.backup,receipt.sharedIndex.name))).toEqual(original);expect(git('show',':untouched.txt')).toBe('keep');if(choice!=='delete')expect(await readFile(join(root,'file.dat'))).toEqual(Buffer.from([0,choice==='ours'?3:2]));
}),20000);
test('tampered shared-index bytes cannot replace working data or the real index',()=>fixture(async(root,config)=>{
 const git=await conflict(root),review=await reviewConflictResolution(root,'file.dat',config),working=await readFile(join(root,'file.dat')),index=await readFile(join(root,'.git/index')),shared=resolve(root,git('rev-parse','--shared-index-path'));const bytes=await readFile(shared);bytes[bytes.length-1]=bytes[bytes.length-1]!^1;await writeFile(shared,bytes);await expect(resolveConflict(root,'file.dat','ours',review.version,true,config)).rejects.toThrow();expect(await readFile(join(root,'file.dat'))).toEqual(working);expect(await readFile(join(root,'.git/index'))).toEqual(index);
}),20000);
for(const format of ['sha1','sha256'] as const)test(`real ${format} index v4 path compression and working choice materialize without losing other entries`,()=>fixture(async(root,config)=>{
 const git=await conflict(root,format,4);expect((await readFile(join(root,'.git/index'))).readUInt32BE(4)).toBe(4);await writeFile(join(root,'file.dat'),Buffer.from([0,99]));const review=await reviewConflictResolution(root,'file.dat',config),result=await resolveConflict(root,'file.dat','working',review.version,true,config);expect(git('ls-files','--unmerged')).toBe('');expect(await readFile(join(root,'file.dat'))).toEqual(Buffer.from([0,99]));expect(indexSharedObject(await readFile(join(root,'.git/index')))).toBeUndefined();expect((await readJson<any>(join(result.backup,'receipt.json'),null)).sharedIndex.name).toMatch(new RegExp(`^sharedindex.[a-f0-9]{${format==='sha1'?40:64}}$`));
}),20000);
test('index parser verifies checksum, entry bounds and extension lengths instead of scanning arbitrary link bytes',()=>{
 const index=(version:number,extensions=Buffer.alloc(0),count=0)=>{const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(version,4);header.writeUInt32BE(count,8);const body=Buffer.concat([header,extensions]);return Buffer.concat([body,createHash('sha1').update(body).digest()]);};
 expect(indexSharedObject(index(3))).toBeUndefined();const link=Buffer.alloc(28);link.write('link');link.writeUInt32BE(20,4);link.fill(1,8);expect(indexSharedObject(index(2,link))).toBe('01'.repeat(20));expect(()=>indexSharedObject(index(4,Buffer.alloc(0),10))).toThrow('entry');link.writeUInt32BE(1000,4);expect(()=>indexSharedObject(index(2,link))).toThrow('extension');const corrupt=index(2);corrupt[0]=0;expect(()=>indexSharedObject(corrupt)).toThrow('checksum');
});
