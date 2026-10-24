// Real CLI input and two bridge processes, owned fixtures only. No paid model calls.
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {writeJson} from '../src/storage.js';
import {defaultConfig} from '../src/config.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {createSession} from '../src/sessions.js';
import {setSessionGoal} from '../src/automation.js';
import {createProjectPlan,transitionProjectPlan} from '../src/plans.js';
import {listGoalWorkflows} from '../src/goalManagement.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),source=process.argv.includes('--source'),runtime=source?process.execPath:'node',entry=join(project,source?'src/cli.ts':'dist/cli.js');
const root=await mkdtemp(join(tmpdir(),'ccpt-goal-surfaces-062-')),home=join(root,'home'),old=process.env.CCPT_HOME;
process.env.CCPT_HOME=home;
const env:Record<string,string>={CCPT_HOME:home,CCPT_CLI_ENTRY:entry,NO_COLOR:'1'};
for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
let modelRequests=0;
const server=Bun.serve({port:0,fetch(){modelRequests++;return new Response('Unexpected model request',{status:500});}});
const children:Bun.Subprocess[]=[],pumps:Promise<unknown>[]=[];
function spawn(args:string[]){const child=Bun.spawn([runtime,...args],{cwd:root,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});children.push(child);return child;}
async function waitFor(check:()=>boolean,message:string){const deadline=Date.now()+18000;while(Date.now()<deadline){if(check())return;await Bun.sleep(30);}throw new Error(message);}
async function pump(stream:ReadableStream<Uint8Array>,accept:(chunk:string)=>void){const reader=stream.getReader(),decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;accept(decoder.decode(value,{stream:true}));}}finally{reader.releaseLock();}}
function bridge(){
 const child=spawn([entry,'ide','serve','--cwd',root]);let buffer='',seq=0,errors='';const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 pumps.push(pump(child.stderr as ReadableStream<Uint8Array>,chunk=>{errors+=chunk;}));
 pumps.push(pump(child.stdout as ReadableStream<Uint8Array>,chunk=>{buffer+=chunk;for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let reply:any;try{reply=JSON.parse(line);}catch{continue;}const request=pending.get(reply.id);if(!request)continue;pending.delete(reply.id);clearTimeout(request.timer);if(reply.error)request.reject(new Error(JSON.stringify(reply.error)));else request.resolve(reply.result);}}));
 const request=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Bridge deadline ${method}: ${errors.slice(-800)}`));},12000);pending.set(id,{resolve,reject,timer});(child.stdin as Bun.FileSink).write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 return {request,child};
}
try{
 const config=structuredClone(defaultConfig);config.marketplaceEnabled=false;config.disableBundledSkills=true;config.hooks=[];config.model={...config.model,provider:'openai',apiProtocol:'responses',responsesTransport:'native',apiKeyEnv:'',endpointUrl:`http://127.0.0.1:${server.port}/v1/responses`};config.policy.workspaceRoots=[root];await writeJson(join(root,'.ccpt/settings.json'),config);await trustWorkspace(root);
 const session=await createSession('Original goal surface session',root);await setSessionGoal({sessionId:session.id,objective:'Explicit approved workflow'},root);const plan=await createProjectPlan({cwd:root,sessionId:session.id,request:'Goal surface fixture',content:'# Approved fixture'});await transitionProjectPlan(root,plan.id,'approved',{expectedVersion:plan.version});
 const code=`import {pathToFileURL} from 'node:url';Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});Object.defineProperty(process.stdout,'columns',{value:120});Object.defineProperty(process.stdout,'rows',{value:42});process.stdin.setRawMode=()=>process.stdin;process.argv=['node',${JSON.stringify(entry)}];await import(pathToFileURL(${JSON.stringify(entry)}).href);`;
 const tui=spawn(source?['--eval',code]:['--input-type=module','--eval',code]);let text='',stderr='';pumps.push(pump(tui.stdout as ReadableStream<Uint8Array>,chunk=>{text+=chunk;}));pumps.push(pump(tui.stderr as ReadableStream<Uint8Array>,chunk=>{stderr+=chunk;}));
 const marker=async (value:string)=>{await waitFor(()=>text.includes(value),`Missing terminal marker ${value}; ${stderr.slice(-500)}; ${text.slice(-2000)}`);text='';};
 const send=async (value:string)=>{(tui.stdin as Bun.FileSink).write(value);await Bun.sleep(60);};
 await marker('/model to change');await send('/goal-run prepare');await send('\r');await marker('Choose an already approved Plan');await send('\r');await marker('Lifetime paid-model request budget');await send('3');await send('\r');await marker('Lifetime total token budget');await send('50000');await send('\r');await marker('Allowed tools, comma-separated');await send('read_file');await send('\r');await marker('Prepare only; no model request now.');await send('\x1b[B');await send('\r');await marker('fullOriginalSession');
 const run=(await listGoalWorkflows(root)).items[0];if(!run||run.phase!=='ready'||run.sessionId!==session.id)throw new Error('Terminal wizard lost original session');
 await send(`/goal-run cancel ${run.id}`);await send('\r');await marker('Cancel this run?');await send('\x1b[B');await send('\r');await marker('"phase": "cancelled"');await send('/exit');await send('\r');await waitFor(()=>tui.exitCode!==null,'Terminal did not exit');if(tui.exitCode!==0)throw new Error(stderr);
 const first=bridge(),second=bridge();const candidates=await first.request('goal-run/candidates');if(candidates.length!==1)throw new Error('Missing approved candidate');
 const input={...candidates[0],maxRequests:3,maxTokens:50000,allowedTools:['read_file']};let denied=false;try{await first.request('goal-run/prepare',{...input,confirm:false});}catch{denied=true;}if(!denied)throw new Error('Unconfirmed IDE preparation accepted');
 const ready=await first.request('goal-run/prepare',{...input,confirm:true});const reviewed=await second.request('goal-run/show',{id:ready.id});if(reviewed.sessionId!==session.id||reviewed.version!==ready.version)throw new Error('IDE review mismatch');
 const outcomes=await Promise.allSettled(Array.from({length:16},(_,i)=>(i%2?first:second).request('goal-run/decide',{id:ready.id,action:'cancel',expectedVersion:ready.version,confirm:true})));
 if(outcomes.filter(o=>o.status==='fulfilled').length!==1)throw new Error('Concurrent stale approvals were not CAS rejected');if(modelRequests!==0)throw new Error('Human wizard made model requests');
 const report={pass:true,version:'0.62.0',runtime:source?'actual source CLI processes':'actual built Node CLI processes',checks:['terminal Plan/budget/tool wizard','explicit prepare without start or model call','original session binding retained','terminal exact-version cancel','two IDE processes review and confirmation','16 concurrent decisions: one accepted, 15 rejected'],modelRequests,companyRequests:0,physicalTerminalOrRemoteIdeMatrix:false,personalSettingsModified:false};await writeJson(join(project,'.ccpt/implementation-062/surfaces',source?'source.json':'node.json'),report);console.log(JSON.stringify(report,null,2));
}finally{
 for(const child of children){try{(child.stdin as Bun.FileSink).end();}catch{}if(child.exitCode===null)child.kill();}
 await Promise.allSettled(children.map(child=>child.exited));await Promise.allSettled(pumps);server.stop(true);if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);
}
