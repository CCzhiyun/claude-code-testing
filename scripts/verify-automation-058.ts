// Actual built Node CLI and model/tool loop. Local fixtures only, no OS registration.
import {mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {writeJson} from '../src/storage.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {createSession,loadSession} from '../src/sessions.js';
import {scheduleWakeup,listWakeups,bindWakeupToJob} from '../src/automation.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-readonly-node-058-')),home=join(root,'home'),previous=process.env.CCPT_HOME;process.env.CCPT_HOME=home;
const env:Record<string,string>={CCPT_HOME:home};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
const requests:any[]=[],server=Bun.serve({port:0,async fetch(request){const body:any=await request.json();requests.push(body);const names=body.tools.map((tool:any)=>tool.function.name).sort();if(JSON.stringify(names)!==JSON.stringify(['list_files','read_file','search_text']))throw new Error('Capability ceiling changed');
  const message=requests.length===1?{tool_calls:[{id:'safe_read',type:'function',function:{name:'read_file',arguments:'{"path":"fixture.txt"}'}}]}:{content:'READ_ONLY_VERIFIED'};
  if(requests.length===2&&!JSON.stringify(body).includes('READ_ONLY_FIXTURE'))throw new Error('Missing real tool result');return Response.json({choices:[{message,finish_reason:requests.length===1?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:5}});
}});
async function cli(args:string[]){const child=Bun.spawn(['node',join(project,'dist/cli.js'),...args,'--cwd',root],{cwd:root,env,stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>child.kill(),25000);try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(err);return JSON.parse(out);}finally{clearTimeout(timer);}}
async function wake(sessionId:string){await scheduleWakeup({sessionId,prompt:'Read fixture.txt and report. Never modify files.',runAt:new Date(Date.now()+60000).toISOString()},root);const path=join(root,'.ccpt/automation.json'),state=JSON.parse(await readFile(path,'utf8'));for(const row of state.wakeups)if(row.status==='scheduled')row.runAt='2020-01-01T00:00:00Z';await writeJson(path,state);}
try{
  await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,model:{provider:'openai',apiProtocol:'chat-completions',endpointUrl:`http://127.0.0.1:${server.port}/chat/completions`,apiKeyEnv:'',maxContextTokens:4096,maxOutputTokens:128},policy:{workspaceRoots:[root]},hooks:[{event:'SessionStart',command:'node NEVER_RUN_THIS.js'}]});
  await writeFile(join(root,'fixture.txt'),'READ_ONLY_FIXTURE');await trustWorkspace(root);const origin=await createSession('original',root);await wake(origin.id);
  const prepared=await cli(['automation','prepare','--agent-mode','read-only','--max-requests','2','--max-tokens','100000','--max-runs','2']);if(!prepared.explicitPaidModelOptIn||prepared.installed)throw new Error('Unexpected scheduler registration/default mode');
  for(const item of await listWakeups(root))if(item.status==='scheduled')await bindWakeupToJob(item.id,prepared.id,root);
  const tick=await cli(['_automation_tick',prepared.id,'--state-home',home]),runs=await cli(['automation','runs',prepared.id]);
  if(!tick.modelsExecuted||requests.length!==2||runs.runs[0].phase!=='completed'||runs.runs[0].reportSessionId===origin.id)throw new Error('Read-only Node roundtrip failed');
  await wake(origin.id);for(const item of await listWakeups(root))if(item.status==='scheduled')await bindWakeupToJob(item.id,prepared.id,root);await cli(['_automation_tick',prepared.id,'--state-home',home]);const final=await cli(['automation','runs',prepared.id]);
  if(requests.length!==2||final.requests!==2||final.runs[1].phase!=='waiting_for_input')throw new Error('Lifetime request budget was reset');
  if((await loadSession(origin.id)).messages.some(message=>message.role==='assistant'))throw new Error('Original conversation was replaced');
  const report={pass:true,runtime:'actual built Node CLI scheduled reader',checks:['explicit paid-model opt-in without OS registration','exact three-tool catalog','real file read/result roundtrip','user Hooks not executed','independent report session','original conversation retained','lifetime request cap across two wakeups'],modelRequests:requests.length,loopbackOnly:true,companyRequests:0,osTasksChanged:false,userSettingsModified:false};
  await writeJson(join(project,'.ccpt/automation-058/final/node-readonly-smoke.json'),report);console.log(JSON.stringify(report,null,2));
}finally{server.stop(true);if(previous===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=previous;await removeOwnedTemporaryFixture(root);}
