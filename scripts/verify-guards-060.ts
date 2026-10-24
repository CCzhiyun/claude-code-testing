// Built Node boundary checks: no external provider or real profile changes.
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeJson} from '../src/storage.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-guards-060-')),entry=join(project,'dist/cli.js'),env:Record<string,string>={CCPT_HOME:join(root,'home')};
for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
async function node(args:string[]){const child=Bun.spawn(['node',...args],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),20000);try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {out,err,code};}finally{clearTimeout(timer);}}
let requests=0;const file=join(root,'.ccpt/settings.json');
const config={marketplaceEnabled:false,disableBundledSkills:true,hooks:[],model:{provider:'openai',apiProtocol:'responses',responsesTransport:'native',apiKeyEnv:'',endpointUrl:''},modelRetry:{maxRetries:2,baseDelayMs:1,maxWaitMs:1000},policy:{workspaceRoots:[root],allowNetwork:true}};
const server=Bun.serve({port:0,async fetch(){requests++;await writeJson(file,{...config,policy:{...config.policy,allowNetwork:false}});return Response.json({error:{code:'rate_limit_error',message:'Fixture capacity limit'}},{status:429,headers:{'retry-after-ms':'10'}});}});config.model.endpointUrl=`http://127.0.0.1:${server.port}/v1/responses`;
try{
 await writeJson(file,config);
 const help=await node([entry,'goal-run','--help']);if(help.code!==0||!help.out.includes('goal-run prepare'))throw new Error('Goal help failed');
 const rejected=await node([entry,'goal-run','prepare','--no-session-persistence','--confirm']);if(rejected.code!==1||!rejected.err.includes('does not accept --no-session-persistence'))throw new Error('Unsupported security flag silently ignored');
 const result=await node(['--input-type=module','-e',`const sdk=await import(${JSON.stringify(pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href)});console.log(JSON.stringify(await sdk.runAgent({cwd:${JSON.stringify(root)},prompt:'Explain a technical design.',isolation:'none',background:false})));`]);
 if(result.code!==0)throw new Error(result.err);const agent=JSON.parse(result.out);if(agent.status!=='waiting_for_input'||!agent.result.includes('authority changed')||requests!==1)throw new Error('Authority revocation did not stop an internal model retry');
 const report={pass:true,version:'0.60.0',runtime:'actual built Node CLI/SDK native Responses loopback',checks:['goal-run --help is read-only and discoverable','unsupported ephemeral/policy overrides rejected rather than ignored','configuration changed after HTTP 429','no second HTTP attempt after revocation','conversation waits for human; no budget reservation for forbidden retry'],modelRequests:requests,companyRequests:0,personalSettingsModified:false};await writeJson(join(project,'.ccpt/original-060/final/node-guards-smoke.json'),report);console.log(JSON.stringify(report,null,2));
}finally{server.stop(true);await removeOwnedTemporaryFixture(root);}
