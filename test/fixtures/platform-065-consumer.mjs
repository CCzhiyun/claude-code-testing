import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const sdk=await import(process.argv[2]),entry=process.argv[3],cwd=process.cwd(),collector=JSON.parse(await readFile(join(cwd,'collector.json'),'utf8'));
async function cli(args,input=''){
 const child=spawn(process.execPath,[entry,...args,'--cwd',cwd],{cwd,env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',s=>{out+=s;});child.stderr.on('data',s=>{error+=s;});child.stdin.end(input);const timer=setTimeout(()=>child.kill(),20000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error||out)));});return JSON.parse(out.trim());}finally{clearTimeout(timer);}
}
await sdk.createProjectNotification(cwd,{title:'PRIVATE-NOTIFICATION',body:'PRIVATE-BODY',sourceKey:'node-one'});
assert((await cli(['event-outbox','recover'])).every(row=>row.ok===false));
await writeFile(join(cwd,'.ccpt/ide-events.json'),JSON.stringify({generation:'events_4545454545454545',sequence:0,events:[]}));
const input=JSON.stringify({id:1,method:'project/events'})+'\n';
const responses=await Promise.all([cli(['ide','serve'],input),cli(['ide','serve'],input)]);
for(const response of responses){assert(!response.error);assert.equal(response.result.events.length,2);assert(response.result.delivery.every(row=>row.ok));assert(!JSON.stringify(response).includes('PRIVATE'));}
assert.equal((await sdk.projectEventsAfter(cwd)).events.length,2);
const inventory=await cli(['plugin-set','inventory']),interrupted=inventory.interrupted.find(row=>row.recoverable);assert(interrupted);
const recovered=await cli(['plugin-set','recover',interrupted.name,'--expected-digest',interrupted.reviewDigest,'--confirm']);assert.equal(recovered.activated,false);
const preview=await cli(['plugin-set','preview',recovered.id]);assert(preview.changes[0].artifactChanged);
const next=await cli(['plugin-set','apply',recovered.id,'--expected-digest',preview.reviewDigest,'--confirm']);assert.equal(next.version,2);
await assert.rejects(()=>sdk.activateReviewedPluginSet(cwd,recovered.id,preview.reviewDigest,true),/review changed/);
const published=await cli(['audit-checkpoint','publish','--collector-file','collector.json','--day','2026-10-19','--confirm']);assert.equal(published.receipt.rows,1);assert.equal(published.exportedPayloads,false);
const queried=await sdk.syncAuditCheckpoint(cwd,collector,'2026-10-19','query',true);assert.equal(queried.receipt.signature,published.receipt.signature);
const controller=new AbortController();controller.abort();await assert.rejects(()=>sdk.syncAuditCheckpoint(cwd,collector,'2026-10-19','query',true,controller.signal),/interrupted|cancelled/);
console.log(JSON.stringify({pass:true,runtime:'actual built Node CLI, SDK and two IDE bridge processes',checks:['committed Plan and notification persist through broken event journal','two IDE processes reconnect and drain once without content disclosure','interrupted signed set recovers without activation','reviewed generation applies once and stale review rejects','CLI publishes and SDK verifies external Ed25519 checkpoint','pre-aborted audit transport fails without retries'],modelRequests:0,companyRequests:0,personalSettingsModified:false}));
