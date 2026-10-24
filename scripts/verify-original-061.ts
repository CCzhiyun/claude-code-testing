// Real built Node CLI + detached Node workers, native Responses loopback. No
// company request, personal settings, OS registration or global npm mutation.
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {writeJson} from '../src/storage.js';
import {defaultConfig} from '../src/config.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {createSession,saveSession} from '../src/sessions.js';
import {setSessionGoal} from '../src/automation.js';
import {createProjectPlan,transitionProjectPlan} from '../src/plans.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-original-060-')),home=join(root,'home'),entry=join(project,'dist/cli.js'),old=process.env.CCPT_HOME;
process.env.CCPT_HOME=home;
const env:Record<string,string>={CCPT_HOME:home,CCPT_CLI_ENTRY:entry};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
const requests:any[]=[],server=Bun.serve({port:0,async fetch(req){const body:any=await req.json();requests.push(body);if(!Array.isArray(body.input)||body.messages)throw new Error('Not native Responses');
 const done=JSON.stringify(body).includes('Wrote implementation.txt'),output=done?[{type:'message',id:'msg_done',role:'assistant',status:'completed',content:[{type:'output_text',text:'CANONICAL_NODE_DONE',annotations:[]}]}]:[{type:'function_call',id:`fc_${requests.length}`,call_id:`call_${requests.length}`,name:'write_file',arguments:'{"path":"implementation.txt","content":"NODE_NATIVE_IMPLEMENTATION"}'}];
 return Response.json({id:`resp_${requests.length}`,object:'response',status:'completed',output,usage:{input_tokens:50,output_tokens:20,total_tokens:70}});
}});
async function cli(args:string[]){const child=Bun.spawn(['node',entry,...args,'--cwd',root],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),30000);try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(err||out);return JSON.parse(out);}finally{clearTimeout(timer);}}
async function terminal(id:string){const end=Date.now()+30000;while(Date.now()<end){const value=await cli(['goal-run','show',id]);if(value.phase!=='ready'&&value.phase!=='running')return value;await Bun.sleep(100);}throw new Error('Detached Goal deadline');}
try{
 const hook=join(root,'display.cjs');await writeFile(hook,'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({hookSpecificOutput:{displayContent:"DISPLAY_NODE_DONE"}})));');
 const config=structuredClone(defaultConfig);config.marketplaceEnabled=false;config.disableBundledSkills=true;config.model={...config.model,provider:'openai',apiProtocol:'responses',responsesTransport:'native',apiKeyEnv:'',endpointUrl:`http://127.0.0.1:${server.port}/v1/responses`,maxContextTokens:16000,maxOutputTokens:512};config.agents.defaultIsolation='none';config.policy.workspaceRoots=[root];config.policy.permissionRules={allow:[],deny:[],ask:['write_file']};config.hooks=[{event:'MessageDisplay',command:`node "${hook}"`}];config.runtimeHistory={mode:'redacted',maxTextChars:16000};await writeJson(join(root,'.ccpt/settings.json'),config);await trustWorkspace(root);
 const session=await createSession('original Node session',root);session.messages=[{role:'user',content:'ORIGINAL_NODE_ARCHITECTURE'}];await saveSession(session);const goal=await setSessionGoal({sessionId:session.id,objective:'Implement approved Node fixture'},root),plan=await createProjectPlan({cwd:root,sessionId:session.id,request:'Implement fixture',content:'# Approved\n- [ ] Write implementation.txt\n- [ ] Verify output'}),approved=await transitionProjectPlan(root,plan.id,'approved',{expectedVersion:plan.version});
 const run=await cli(['goal-run','prepare','--goal-id',goal.id,'--plan-id',plan.id,'--expected-plan-version',String(approved.version),'--tools','write_file,read_file','--max-requests','4','--max-tokens','500000','--confirm']);
 const launch=await cli(['goal-run','start',run.id,'--expected-version',String(run.version),'--confirm']);if(!launch.launched)throw new Error('Not detached');const waiting=await terminal(run.id);if(waiting.phase!=='waiting'||!waiting.pendingRequestId||requests.length!==1)throw new Error('Missing exact approval boundary');
 const ready=await cli(['goal-run','resume',run.id,'--expected-version',String(waiting.version),'--approve-request',waiting.pendingRequestId,'--confirm']);await cli(['goal-run','start',run.id,'--expected-version',String(ready.version),'--confirm']);const done=await terminal(run.id);
 if(done.phase!=='completed'||done.agentId!==waiting.agentId||done.requests!==3||requests.length!==3)throw new Error('Goal/Agent/budget continuation failed');if(await readFile(join(root,'implementation.txt'),'utf8')!=='NODE_NATIVE_IMPLEMENTATION'||!JSON.stringify(requests[0]).includes('ORIGINAL_NODE_ARCHITECTURE'))throw new Error('Coding/context inheritance failed');
 const record=JSON.parse(await readFile(join(home,'agents',done.agentId+'.json'),'utf8'));if(record.result!=='CANONICAL_NODE_DONE'||record.displayResult!=='DISPLAY_NODE_DONE')throw new Error('Display contaminated canonical result');
 const activity=await cli(['sessions','activity',session.id,'--include-text']);if(!activity.items.some((row:any)=>row.type==='assistant_message'&&row.text==='CANONICAL_NODE_DONE'))throw new Error('Opt-in history was not persisted by Node worker');
 const preview=await cli(['sessions','preview',session.id,'--include-text','--text-limit','16000']);if(JSON.stringify(preview).includes('DISPLAY_NODE_DONE'))throw new Error('Display contaminated original conversation');
 const report={pass:true,version:'0.61.0',runtime:'actual built Node CLI + detached Goal launcher + detached Node Agent + native Responses loopback',checks:['explicit prepare and detached start','exact human permission boundary','same Agent/session continuation','cumulative budget across attempts','original session inherited','actual file write and result return','MessageDisplay surface-only replacement','opt-in durable redacted activity','formatted history preview; no replay'],modelRequests:requests.length,companyRequests:0,personalSettingsModified:false,osTasksRegistered:false};await writeJson(join(project,'.ccpt/implementation-061/node/node-goal-smoke.json'),report);console.log(JSON.stringify(report,null,2));
}finally{await Bun.sleep(600);server.stop(true);if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
