// Owned fixtures, actual built Node CLI/SDK/IDE. No company/model requests.
import {mkdtemp,mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {generateKeyPairSync} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeJson} from '../src/storage.js';
import {signPlugin} from '../src/pluginSignatures.js';
import {stagePluginSet,activatePluginSet} from '../src/pluginSets.js';
import {createProjectPlan} from '../src/plans.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {appendIntegrityAudit} from '../src/auditIntegrity.js';
import {acceptAuditCheckpoint,readCollectorCheckpoint} from '../src/auditCheckpoint.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-platform065-')),oldHome=process.env.CCPT_HOME,oldKey=process.env.CCPT_AUDIT_HMAC_KEY;
process.env.CCPT_HOME=join(root,'home');process.env.CCPT_AUDIT_HMAC_KEY='78'.repeat(32);
const pair=generateKeyPairSync('ed25519'),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString(),store=join(root,'collector-store');let requests=0;
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){try{if(req.headers.get('authorization')!=='Bearer fixture-only-collector-token')return new Response(null,{status:401});requests++;const url=new URL(req.url);const result=req.method==='POST'?await acceptAuditCheckpoint(store,await req.json() as never,privateKey,'collector'):await readCollectorCheckpoint(store,url.searchParams.get('stream')!,url.searchParams.get('day')!,publicKey,'collector');return result?Response.json(result):new Response(null,{status:404});}catch{return new Response(null,{status:409});}}});
try{
 const key=join(root,'publisher.pem');await writeFile(key,privateKey);await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,requirePluginSignatures:true,pluginTrustKeys:{publisher:publicKey},policy:{workspaceRoots:[root],allowNetwork:true}});await trustWorkspace(root);
 const source=join(root,'source');await mkdir(source);let next:string|undefined;
 for(const version of ['1.0.0','2.0.0']){await writeJson(join(source,'plugin.json'),{name:'sample',version});await signPlugin(source,key,'publisher');const staged=await stagePluginSet(root,[source],true);if(version==='1.0.0')await activatePluginSet(root,staged.id,0,true);else next=staged.id;}
 await rename(join(root,'.ccpt/plugin-sets',next!),join(root,'.ccpt/plugin-sets/.pending-NODE065'));
 await writeJson(join(root,'.ccpt/ide-events.json'),{broken:true});await createProjectPlan({cwd:root,request:'PRIVATE-REQUEST',content:'# PRIVATE-PLAN'});
 await appendIntegrityAudit({event:'fixture',outcome:'success'},'2026-10-19');
 await writeJson(join(root,'collector.json'),{url:`http://127.0.0.1:${server.port}/audit`,stream:'node-fixture',keyId:'collector',publicKey,tokenEnv:'COLLECTOR_FIXTURE_TOKEN',allowLoopbackHttp:true});
 const env:Record<string,string>={CCPT_HOME:join(root,'home'),CCPT_AUDIT_HMAC_KEY:process.env.CCPT_AUDIT_HMAC_KEY!,COLLECTOR_FIXTURE_TOKEN:'fixture-only-collector-token',NO_COLOR:'1'};
 for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
 const child=Bun.spawn(['node',join(project,'test/fixtures/platform-065-consumer.mjs'),pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href,join(project,'dist/cli.js')],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),90000);
 try{const[out,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(error+'\n'+out);const report={...JSON.parse(out),loopbackCollectorRequests:requests};await writeJson(join(project,'.ccpt/implementation-065/surfaces/platform-node.json'),report);console.log(JSON.stringify(report,null,2));}finally{clearTimeout(timer);}
}finally{server.stop(true);if(oldHome===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=oldHome;if(oldKey===undefined)delete process.env.CCPT_AUDIT_HMAC_KEY;else process.env.CCPT_AUDIT_HMAC_KEY=oldKey;await removeOwnedTemporaryFixture(root);}
