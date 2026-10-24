import { test, expect } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendIntegrityAudit, integrityAuditAnchors } from '../src/auditIntegrity.js';
import { acceptAuditCheckpoint, readCollectorCheckpoint, syncAuditCheckpoint, verifyAuditCheckpoint, type AuditCollectorConfig } from '../src/auditCheckpoint.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
const day='2026-10-19';
async function fixture(action:(f:{root:string;collector:AuditCollectorConfig;privateKey:string;store:string;requests:string[];fail:(kind:'none'|'drop'|'wait'|'tamper'|'wrong-stream')=>void})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-auditcheckpoint065-')),saved={home:process.env.CCPT_HOME,key:process.env.CCPT_AUDIT_HMAC_KEY,token:process.env.CCPT_CHECKPOINT_TEST_TOKEN};
 process.env.CCPT_HOME=join(root,'home');process.env.CCPT_AUDIT_HMAC_KEY='67'.repeat(32);process.env.CCPT_CHECKPOINT_TEST_TOKEN='local-only-test-secret';
 const keys=generateKeyPairSync('ed25519'),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString(),store=join(root,'separate-collector'),requests:string[]=[];let fault='none';
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  try{if(req.headers.get('Authorization')!=='Bearer local-only-test-secret')return new Response('denied',{status:401});const url=new URL(req.url);requests.push(req.method);let receipt;
   if(req.method==='POST'){const input=await req.json() as any;expect(JSON.stringify(input)).not.toContain('PRIVATE-PAYLOAD');receipt=await acceptAuditCheckpoint(store,input,privateKey,'collector');if(fault==='drop')return new Response('unknown after commit',{status:503});if(fault==='wait')await Bun.sleep(250);}
   else receipt=await readCollectorCheckpoint(store,url.searchParams.get('stream')!,url.searchParams.get('day')!,publicKey,'collector');
   if(!receipt)return new Response('not found',{status:404});if(fault==='tamper')receipt={...receipt,tail:'f'.repeat(64)};if(fault==='wrong-stream')receipt=await acceptAuditCheckpoint(store,{format:1,stream:'other',day,anchors:[]},privateKey,'collector');return Response.json(receipt);
  }catch{return new Response('conflict',{status:409});}
 }});
 try{await writeJson(join(root,'.ccpt/settings.json'),{policy:{workspaceRoots:[root],allowNetwork:true}});await trustWorkspace(root);const collector={url:`http://127.0.0.1:${server.port}/audit`,stream:'test-stream',keyId:'collector',publicKey,tokenEnv:'CCPT_CHECKPOINT_TEST_TOKEN',allowLoopbackHttp:true};await action({root,collector,privateKey,store,requests,fail:kind=>{fault=kind;}});}
 finally{server.stop(true);for(const [name,value]of [['CCPT_HOME',saved.home],['CCPT_AUDIT_HMAC_KEY',saved.key],['CCPT_CHECKPOINT_TEST_TOKEN',saved.token]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;await removeOwnedTemporaryFixture(root);}
}
test('signed external checkpoint exports only MACs, is idempotent and accepts append-only history',()=>fixture(async f=>{
 await appendIntegrityAudit({text:'PRIVATE-PAYLOAD'},day);const first=await syncAuditCheckpoint(f.root,f.collector,day,'publish',true);expect(first.anchored).toBe(true);expect(first.exportedPayloads).toBe(false);expect(first.centralImmutableStorageVerified).toBe(false);
 const again=await syncAuditCheckpoint(f.root,f.collector,day,'publish',true);expect(again.receipt!.signature).toBe(first.receipt!.signature);
 await appendIntegrityAudit({text:'more'},day);const query=await syncAuditCheckpoint(f.root,f.collector,day,'query',true);expect(query.receipt!.rows).toBe(1);
 expect((await syncAuditCheckpoint(f.root,f.collector,day,'publish',true)).receipt!.rows).toBe(2);
}));
test('unknown POST result is queried, never automatically replayed',()=>fixture(async f=>{
 await appendIntegrityAudit({event:'one'},day);f.fail('drop');await expect(syncAuditCheckpoint(f.root,f.collector,day,'publish',true)).rejects.toThrow('503');expect(f.requests).toEqual(['POST']);f.fail('none');
 expect((await syncAuditCheckpoint(f.root,f.collector,day,'query',true)).receipt!.rows).toBe(1);expect(f.requests).toEqual(['POST','GET']);
}));
test('local truncation and divergent history are detected against the separately retained collector',()=>fixture(async f=>{
 await appendIntegrityAudit({event:'one'},day);const path=join(f.root,'home/audit',day+'.chain.jsonl'),one=await readFile(path,'utf8');await appendIntegrityAudit({event:'two'},day);await syncAuditCheckpoint(f.root,f.collector,day,'publish',true);
 await writeFile(path,one);await expect(syncAuditCheckpoint(f.root,f.collector,day,'query',true)).rejects.toThrow('rollback');await expect(acceptAuditCheckpoint(f.store,{format:1,stream:f.collector.stream,day,anchors:await integrityAuditAnchors(day)},f.privateKey,'collector')).rejects.toThrow('rollback');
}));
test('receipt tampering, wrong stream and substituted signing identity are rejected',()=>fixture(async f=>{
 await appendIntegrityAudit({},day);const first=await syncAuditCheckpoint(f.root,f.collector,day,'publish',true);
 expect(()=>verifyAuditCheckpoint({...first.receipt!,rows:0},f.collector.publicKey,'collector')).toThrow('signature');
 f.fail('tamper');await expect(syncAuditCheckpoint(f.root,f.collector,day,'query',true)).rejects.toThrow('untrusted');f.fail('wrong-stream');await expect(syncAuditCheckpoint(f.root,f.collector,day,'query',true)).rejects.toThrow('rollback');
 const wrong=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();f.fail('none');await expect(syncAuditCheckpoint(f.root,{...f.collector,publicKey:wrong},day,'query',true)).rejects.toThrow('untrusted');
}));
test('network consent, TLS and credential boundaries fail before contacting collector',()=>fixture(async f=>{
 await expect(syncAuditCheckpoint(f.root,f.collector,day,'publish',false)).rejects.toThrow('confirm');
 await expect(syncAuditCheckpoint(f.root,{...f.collector,url:'http://enterprise.example/audit'},day,'publish',true)).rejects.toThrow('HTTPS');
 await expect(syncAuditCheckpoint(f.root,{...f.collector,url:'https://name:secret@example.test'},day,'publish',true)).rejects.toThrow('HTTPS');
 await expect(syncAuditCheckpoint(f.root,{...f.collector,tokenEnv:'MISSING_CHECKPOINT_TOKEN'},day,'query',true)).rejects.toThrow('credential');
 await writeJson(join(f.root,'.ccpt/settings.json'),{policy:{workspaceRoots:[f.root],mode:'restricted'}});await expect(syncAuditCheckpoint(f.root,f.collector,day,'query',true)).rejects.toThrow('trust');expect(f.requests).toEqual([]);
}));
test('in-flight cancellation preserves unknown result and a separate query resolves it without POST replay',()=>fixture(async f=>{
 await appendIntegrityAudit({event:'cancel'},day);f.fail('wait');const controller=new AbortController();
 const publishing=syncAuditCheckpoint(f.root,f.collector,day,'publish',true,controller.signal);
 const until=Date.now()+3000;while(!f.requests.length&&Date.now()<until)await Bun.sleep(5);expect(f.requests).toEqual(['POST']);
 controller.abort();await expect(publishing).rejects.toThrow('unknown');await Bun.sleep(300);f.fail('none');expect((await syncAuditCheckpoint(f.root,f.collector,day,'query',true)).receipt!.rows).toBe(1);expect(f.requests).toEqual(['POST','GET']);
}));
test('collector lock serializes concurrent duplicate requests into one signed receipt',()=>fixture(async f=>{
 await appendIntegrityAudit({event:'one'},day);const anchors=await integrityAuditAnchors(day),input={format:1 as const,stream:f.collector.stream,day,anchors};
 const receipts=await Promise.all(Array.from({length:8},()=>acceptAuditCheckpoint(f.store,input,f.privateKey,'collector')));expect(new Set(receipts.map(row=>row.signature)).size).toBe(1);
 const latest=await readCollectorCheckpoint(f.store,f.collector.stream,day,f.collector.publicKey,'collector');expect(latest!.operationId).toBe(receipts[0]!.operationId);
}));
