import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {defaultConfig} from '../src/config.js';
import {writeJson} from '../src/storage.js';
import {signPlugin} from '../src/pluginSignatures.js';
import {computePluginDigest,discoverPlugins} from '../src/plugins.js';
import {signPluginOverlay} from '../src/pluginOverlays.js';
import {audit,readAudit} from '../src/audit.js';
import {verifyIntegrityAudit} from '../src/auditIntegrity.js';
import {requestStreamableMcp} from '../src/mcpHttpRequest.js';
import {isolatedCommand} from '../src/osSandbox.js';
import {withExecutionSignal} from '../src/executionControl.js';
import {reviewBinaryConflict,stageReviewedBinaryConflict} from '../src/worktree.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';

async function fixture(action:(root:string,config:typeof defaultConfig)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-integration-061-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const config=structuredClone(defaultConfig);config.hooks=[];config.marketplaceEnabled=false;config.disableBundledSkills=true;config.policy.workspaceRoots=[root];
 try{await action(root,config);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
test('independently signed overlay augments a separately verified artifact without changing its bytes',()=>fixture(async(root,config)=>{
 const base=join(root,'plugins'),plugin=join(base,'fixture');await mkdir(plugin,{recursive:true});await writeJson(join(plugin,'plugin.json'),{name:'fixture',version:'1.0.0',contributes:{commands:[{name:'base',description:'Base',prompt:'Base prompt'}]}});
 const artifact=generateKeyPairSync('ed25519'),overlay=generateKeyPairSync('ed25519'),artifactKey=join(root,'artifact.pem'),overlayKey=join(root,'overlay.pem');await writeFile(artifactKey,artifact.privateKey.export({format:'pem',type:'pkcs8'}));await writeFile(overlayKey,overlay.privateKey.export({format:'pem',type:'pkcs8'}));await signPlugin(plugin,artifactKey,'artifact');
 const envelope=await signPluginOverlay(plugin,{commands:[{name:'review',description:'Review',prompt:'Only review'}]},overlayKey,'overlay'),before=await computePluginDigest(plugin);
 config.pluginDirectories=[base];config.requirePluginSignatures=true;config.pluginTrustKeys={artifact:artifact.publicKey.export({format:'pem',type:'spki'}).toString(),overlay:overlay.publicKey.export({format:'pem',type:'spki'}).toString()};config.pluginOverlays={fixture:envelope};
 const loaded=await discoverPlugins(config);expect(loaded.diagnostics).toEqual([]);expect(loaded.plugins[0]!.overlayKeyId).toBe('overlay');expect(loaded.plugins[0]!.contributions.commands!.map(v=>v.name)).toEqual(['base','review']);expect(await computePluginDigest(plugin)).toBe(before);
 config.pluginOverlays.fixture!.contributes.commands![0]!.prompt='Tampered';expect((await discoverPlugins(config)).plugins).toHaveLength(0);config.pluginOverlays.fixture=envelope;envelope.contributes.commands![0]!.prompt='Only review';config.revokedPluginKeys=['overlay'];expect((await discoverPlugins(config)).plugins).toHaveLength(0);
}));
test('overlay signature cannot be borrowed from the artifact or rebound to another plugin/version',()=>fixture(async(root,config)=>{
 const plugin=join(root,'plugins/fixture');await mkdir(plugin,{recursive:true});await writeJson(join(plugin,'plugin.json'),{name:'fixture',version:'1.0.0'});const keys=generateKeyPairSync('ed25519'),key=join(root,'key.pem');await writeFile(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));await signPlugin(plugin,key,'publisher');config.pluginDirectories=[join(root,'plugins')];config.pluginTrustKeys={publisher:keys.publicKey.export({type:'spki',format:'pem'}).toString()};config.requirePluginSignatures=true;
 const row=await signPluginOverlay(plugin,{commands:[]},key,'publisher');config.pluginOverlays={fixture:{...row,version:'2.0.0'}};expect((await discoverPlugins(config)).plugins).toHaveLength(0);
 const manifest=JSON.parse(await readFile(join(plugin,'plugin.json'),'utf8'));config.pluginOverlays.fixture={...row,signature:manifest.integrity.signature};expect((await discoverPlugins(config)).plugins).toHaveLength(0);
}));
test('integrity audit serializes concurrent writers, detects mutation and external-anchor truncation, and redacts before signing',()=>fixture(async(root)=>{
 const old=process.env.CCPT_AUDIT_HMAC_KEY;process.env.CCPT_AUDIT_HMAC_KEY='ab'.repeat(32);const day=new Date().toISOString().slice(0,10);
 try{await Promise.all(Array.from({length:10},(_,i)=>audit({event:'fixture',actor:String(i),outcome:'success',details:{authorization:'Bearer PRIVATE_FIXTURE'}})));const checked=await verifyIntegrityAudit(day);expect(checked.rows).toBe(10);expect(checked.truncationProtected).toBe(false);const path=join(root,'home/audit',day+'.chain.jsonl'),bytes=await readFile(path,'utf8');expect(bytes).not.toContain('PRIVATE_FIXTURE');
  const changed=bytes.split('\n');const row=JSON.parse(changed[0]!);row.payload.actor='tampered';changed[0]=JSON.stringify(row);await writeFile(path,changed.join('\n'));await expect(verifyIntegrityAudit(day)).rejects.toThrow('integrity');await expect(audit({event:'append',outcome:'success'})).rejects.toThrow('integrity');
  await writeFile(path,bytes.split('\n').slice(0,9).join('\n')+'\n');await expect(verifyIntegrityAudit(day,checked.tail)).rejects.toThrow('anchor');await writeFile(path,bytes);expect((await verifyIntegrityAudit(day,checked.tail)).truncationProtected).toBe(true);
 }finally{if(old===undefined)delete process.env.CCPT_AUDIT_HMAC_KEY;else process.env.CCPT_AUDIT_HMAC_KEY=old;}
}));
test('required integrity without a key fails closed and audit date cannot traverse paths',()=>fixture(async()=>{
 const old=process.env.CCPT_AUDIT_INTEGRITY,key=process.env.CCPT_AUDIT_HMAC_KEY;process.env.CCPT_AUDIT_INTEGRITY='required';delete process.env.CCPT_AUDIT_HMAC_KEY;
 try{await expect(audit({event:'fixture',outcome:'success'})).rejects.toThrow('32–64');await expect(readAudit('../../private')).rejects.toThrow('YYYY-MM-DD');}finally{if(old===undefined)delete process.env.CCPT_AUDIT_INTEGRITY;else process.env.CCPT_AUDIT_INTEGRITY=old;if(key!==undefined)process.env.CCPT_AUDIT_HMAC_KEY=key;}
}));
for(const resume of [false,true])test(`POST SSE cursor continuation opt-in=${resume} never repeats the original POST`,()=>fixture(async(_root,config)=>{
 let posts=0,gets=0;const server=Bun.serve({port:0,async fetch(req){if(req.method==='POST'){posts++;return new Response('id: cursor-a\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n',{headers:{'content-type':'text/event-stream'}});}gets++;expect(req.headers.get('last-event-id')).toBe('cursor-a');expect(req.headers.get('mcp-session-id')).toBe('bound-session');return new Response('id: cursor-b\ndata: {"jsonrpc":"2.0","id":9,"result":{"done":true}}\n\n',{headers:{'content-type':'text/event-stream'}});}});
 try{const request=requestStreamableMcp({endpoint:`http://127.0.0.1:${server.port}/mcp`,headers:{'content-type':'application/json','mcp-session-id':'bound-session'},id:9,method:'tools/call',params:{name:'fixture'},config,budget:{requests:0,ids:new Set()},resumeSse:resume});if(resume)expect(await request).toEqual({done:true});else await expect(request).rejects.toThrow('requested ID');expect(posts).toBe(1);expect(gets).toBe(resume?1:0);}finally{server.stop(true);}
}));
test('expired continuation fails without session reinitialization or POST tool replay',()=>fixture(async(_root,config)=>{
 let posts=0,gets=0;const server=Bun.serve({port:0,fetch(req){if(req.method==='GET'){gets++;return new Response(null,{status:404});}posts++;return new Response('id: primed\ndata:\n\n',{headers:{'content-type':'text/event-stream'}});}});
 try{await expect(requestStreamableMcp({endpoint:`http://127.0.0.1:${server.port}`,headers:{},id:1,method:'tools/call',params:{},config,budget:{requests:0,ids:new Set()},resumeSse:true})).rejects.toThrow('continuation rejected');expect([posts,gets]).toEqual([1,1]);}finally{server.stop(true);}
}));

for(const cancel of [false,true])test(`resumed POST approval is revoked by the originating ${cancel?'cancellation':'deadline'} without sharing content or replaying`,()=>fixture(async(_root,config)=>{
 let posts=0,gets=0,sampled=0,callbackAborted=false,cancellations=0;const controller=new AbortController();config.network.timeoutMs=200;
 const server=Bun.serve({port:0,async fetch(req){const body=req.method==='POST'?await req.json():null;if(body?.method==='notifications/cancelled'){cancellations++;return new Response(null,{status:202});}if(req.method==='POST'){posts++;return new Response('id: start\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n',{headers:{'content-type':'text/event-stream'}});}gets++;return new Response('id: approval\ndata: '+JSON.stringify({jsonrpc:'2.0',id:'review',method:'sampling/createMessage',params:{messages:[{role:'user',content:{type:'text',text:'fixture'}}],maxTokens:5}})+'\n\n',{headers:{'content-type':'text/event-stream'}});}});
 try{const started=Date.now();await expect(withExecutionSignal(controller.signal,()=>requestStreamableMcp({endpoint:`http://127.0.0.1:${server.port}`,headers:{},id:1,method:'tools/call',params:{},config,budget:{requests:0,ids:new Set()},resumeSse:true,interactions:{timeoutMs:10000,confirmSampling:async(_request,signal)=>{signal.addEventListener('abort',()=>{callbackAborted=true;},{once:true});if(cancel)setTimeout(()=>controller.abort(),10);return new Promise(()=>{});},sample:async()=>{sampled++;return {role:'assistant',model:'fixture',content:{type:'text',text:'never-shared'}};},confirmSamplingResult:async()=>true}}))).rejects.toThrow();expect(Date.now()-started).toBeLessThan(1800);expect(posts).toBe(1);expect(gets).toBe(1);expect(sampled).toBe(0);expect(callbackAborted).toBe(true);expect(cancellations).toBe(1);}finally{server.stop(true);}
}));
test.skipIf(process.platform==='linux')('OS sandbox selection on another OS never launches an unisolated command',()=>fixture(async(root,config)=>{config.policy.osSandbox='linux-bubblewrap';await expect(isolatedCommand('node',['--version'],root,config)).rejects.toThrow('no unsandboxed fallback');}));

async function gitConflict(root:string,deletion=false){
 const repo=join(root,'repo');await mkdir(repo);const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(repo,'.gitignore'),'.ccpt/\n');await writeFile(join(repo,'data.bin'),Buffer.from([0,1,2]));git('add','.');git('commit','-m','base');const main=git('branch','--show-current');git('checkout','-b','other');await writeFile(join(repo,'data.bin'),Buffer.from([0,3,4]));git('commit','-am','other');git('checkout',main);if(deletion)git('rm','data.bin');else await writeFile(join(repo,'data.bin'),Buffer.from([0,5,6]));git('commit','-am','ours');try{git('merge','other');}catch{}return {repo,git};
}
test('reviewed binary conflict stages exact user bytes and refuses stale or unconfirmed decisions',()=>fixture(async(root,config)=>{
 const {repo,git}=await gitConflict(root);await writeFile(join(repo,'data.bin'),Buffer.from([0,7,8]));let review=await reviewBinaryConflict(repo,'data.bin',config);expect(review.working.binary).toBe(true);await expect(stageReviewedBinaryConflict(repo,'data.bin',review.version,false,config)).rejects.toThrow('confirm');await writeFile(join(repo,'data.bin'),Buffer.from([0,9,10]));await expect(stageReviewedBinaryConflict(repo,'data.bin',review.version,true,config)).rejects.toThrow('changed');review=await reviewBinaryConflict(repo,'data.bin',config);expect((await stageReviewedBinaryConflict(repo,'data.bin',review.version,true,config)).staged).toBe(true);expect(git('ls-files','--unmerged')).toBe('');expect(await readFile(join(repo,'data.bin'))).toEqual(Buffer.from([0,9,10]));
}),15000);
test('reviewed deletion is distinct from an empty blob and can resolve delete/modify without commit or push',()=>fixture(async(root,config)=>{
 const {repo,git}=await gitConflict(root,true),head=git('rev-parse','HEAD');await rm(join(repo,'data.bin'));const review=await reviewBinaryConflict(repo,'data.bin',config);expect(review.working.present).toBe(false);expect(review.action).toBe('stage-reviewed-deletion');expect((await stageReviewedBinaryConflict(repo,'data.bin',review.version,true,config)).deleted).toBe(true);expect(git('ls-files','--unmerged')).toBe('');expect(git('rev-parse','HEAD')).toBe(head);
}),15000);
