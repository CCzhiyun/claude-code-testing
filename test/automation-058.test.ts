import {expect,test} from 'bun:test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {defaultConfig} from '../src/config.js';
import {writeJson} from '../src/storage.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {createSession,loadSession} from '../src/sessions.js';
import {scheduleWakeup,listWakeups,bindWakeupToJob} from '../src/automation.js';
import {prepareReadOnlyAutomation,inspectReadOnlyRuns} from '../src/scheduledAgent.js';
import {automationDeploymentDigest,readOnlyAutomationConfig} from '../src/readOnlyAutomation.js';
import {tickAutomationScheduler as tickBoundScheduler,loadSchedulerJob,installAutomationScheduler} from '../src/automationScheduler.js';
import {nativeSchedulerDefinitions} from '../src/nativeSchedulers.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';

async function fixture(action:(f:{root:string;home:string;requests:any[];config:typeof defaultConfig;persist:()=>Promise<void>})=>Promise<void>,malicious:boolean|'read'=false){
 const root=await mkdtemp(join(tmpdir(),'ccpt-automation-058-')),home=join(root,'home'),previous=process.env.CCPT_HOME;process.env.CCPT_HOME=home;const requests:any[]=[];
 const server=Bun.serve({port:0,async fetch(request){const body=await request.json();requests.push(body);const message=malicious&&requests.length===1?{tool_calls:[{id:'call_fixture',type:'function',function:{name:malicious==='read'?'read_file':'run_command',arguments:JSON.stringify(malicious==='read'?{path:'fixture.txt'}:{command:'node',args:['-e','throw new Error("NEVER EXECUTE")']})}}]}:{content:'READ_ONLY_REPORT'};return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:5}});}});
 const config=structuredClone(defaultConfig);config.marketplaceEnabled=false;config.disableBundledSkills=true;config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/v1/chat/completions`;config.model.apiKeyEnv='';config.model.maxContextTokens=4096;config.model.maxOutputTokens=128;config.policy.workspaceRoots=[root];config.hooks=[];
 const persist=()=>writeJson(join(root,'.ccpt/settings.json'),config);await persist();await trustWorkspace(root);
 try{await action({root,home,requests,config,persist});}finally{server.stop(true);if(previous===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=previous;await removeOwnedTemporaryFixture(root);}
}
const entry=join(import.meta.dir,'../src/cli.ts'),limits={maxRequests:4,maxTokens:100000,maxRuns:3};
// 0.59 migration is explicit: paid readers no longer consume unbound wakeups.
async function tickAutomationScheduler(id:string){const job=await loadSchedulerJob(id);for(const wakeup of await listWakeups(job.cwd))if(wakeup.status==='scheduled'&&!wakeup.jobId)await bindWakeupToJob(wakeup.id,id,job.cwd);return tickBoundScheduler(id);}
async function wake(root:string,sessionId:string){const item=await scheduleWakeup({sessionId,prompt:'Analyze this fixture without editing files',runAt:new Date(Date.now()+60000).toISOString()},root);const file=join(root,'.ccpt/automation.json'),state=JSON.parse(await readFile(file,'utf8'));state.wakeups.find((row:any)=>row.id===item.id).runAt='2020-01-01T00:00:00Z';await writeJson(file,state);return item;}
test('explicit scheduled read-only Agent makes a bounded report without replacing the original conversation',()=>fixture(async f=>{
 const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,limits);
 const result=await tickAutomationScheduler(job.id),runs=await inspectReadOnlyRuns(job.id);expect(result.modelsExecuted).toBe(true);expect(f.requests).toHaveLength(1);expect(runs.runs[0]!.phase).toBe('completed');expect(runs.runs[0]!.reportSessionId).not.toBe(origin.id);
 expect(f.requests[0].tools.map((tool:any)=>tool.function.name).sort()).toEqual(['list_files','read_file','search_text']);
 expect((await loadSession(origin.id)).messages).toHaveLength(1);expect((await loadSession(runs.runs[0]!.reportSessionId!)).messages.some(message=>message.role==='assistant')).toBe(true);
 expect((await tickAutomationScheduler(job.id)).modelsExecuted).toBe(false);expect(f.requests).toHaveLength(1);
}),15000);
test('a forbidden model tool call is rejected rather than exposing a shell',()=>fixture(async f=>{
 const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,limits);await tickAutomationScheduler(job.id);
 expect(f.requests).toHaveLength(2);expect(JSON.stringify(f.requests[1])).toContain('not enabled');expect((await inspectReadOnlyRuns(job.id)).runs[0]!.phase).toBe('completed');
},true),15000);
test('scheduled reader performs a real permitted file read and returns its tool result',()=>fixture(async f=>{
 await writeFile(join(f.root,'fixture.txt'),'READ_ONLY_CONTENT');const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,limits);await tickAutomationScheduler(job.id);
 expect(f.requests).toHaveLength(2);expect(JSON.stringify(f.requests[1])).toContain('READ_ONLY_CONTENT');expect((await inspectReadOnlyRuns(job.id)).runs[0]!.phase).toBe('completed');
},'read'),15000);
test('scheduled lifetime request budget survives different wakeups and report sessions',()=>fixture(async f=>{
 const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,{...limits,maxRequests:1});await tickAutomationScheduler(job.id);await wake(f.root,origin.id);await tickAutomationScheduler(job.id);
 const runs=await inspectReadOnlyRuns(job.id);expect(runs.requests).toBe(1);expect(f.requests).toHaveLength(1);expect(runs.runs.map(row=>row.phase)).toEqual(['completed','waiting_for_input']);
}),15000);
test('insufficient token reservation blocks the model before any request',()=>fixture(async f=>{
 const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,{...limits,maxTokens:1024});await tickAutomationScheduler(job.id);expect(f.requests).toHaveLength(0);expect((await inspectReadOnlyRuns(job.id)).runs[0]!.phase).toBe('waiting_for_input');
}));
test('maximum scheduled runs leaves further context available to the original user',()=>fixture(async f=>{
 const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,{...limits,maxRuns:1});await tickAutomationScheduler(job.id);await wake(f.root,origin.id);expect((await tickAutomationScheduler(job.id)).budgetExhausted).toBe(true);expect(f.requests).toHaveLength(1);expect((await listWakeups(f.root)).some(row=>row.status==='scheduled')).toBe(true);
}),15000);
test('an uncertain write-ahead claim is never automatically replayed or refunded',()=>fixture(async f=>{
 const origin=await createSession('original',f.root),item=await wake(f.root,origin.id),job=await prepareReadOnlyAutomation(f.root,entry,limits),id=createHash('sha256').update(JSON.stringify([item.id])).digest('hex');
 await writeJson(join(f.home,'schedulers',job.id,'read-only-runs.json'),[{id,originSessionId:origin.id,phase:'claimed',at:new Date().toISOString()}]);
 expect((await tickAutomationScheduler(job.id)).unknownOutcomeRetained).toBe(true);expect(f.requests).toHaveLength(0);expect((await listWakeups(f.root))[0]!.status).toBe('scheduled');
}));
test('deployment changes fail before claiming or delivering a paid scheduled request',()=>fixture(async f=>{
 const origin=await createSession('original',f.root);await wake(f.root,origin.id);const job=await prepareReadOnlyAutomation(f.root,entry,limits);f.config.model.name='changed-deployment';await f.persist();
 await expect(tickAutomationScheduler(job.id)).rejects.toThrow('deployment changed');expect(f.requests).toHaveLength(0);expect((await loadSession(origin.id)).messages).toHaveLength(0);
}));
test('read-only capability config strips executable extensions, network tools and recursion',()=>fixture(async f=>{
 f.config.hooks=[{event:'SessionStart',command:'node unsafe.js'}];f.config.agentDefinitions={lead:{description:'unsafe',instructions:'unsafe',tools:['run_command']}} as any;f.config.skillsDirectories=['outside'];f.config.pluginDirectories=['outside'];f.config.mcpServers={unsafe:{transport:'stdio',command:'node'}};
 const config=readOnlyAutomationConfig(f.config,f.root,{...limits,deploymentDigest:automationDeploymentDigest(f.config)});expect(config.policy.mode).toBe('restricted');expect(config.hooks).toEqual([]);expect(config.pluginDirectories).toEqual([]);expect(config.mcpServers).toEqual({});expect(config.agents.maxDepth).toBe(0);
}));
test('unbounded or malformed read-only scheduler settings are rejected without registration',()=>fixture(async f=>{
 for(const patch of [{maxRequests:0},{maxRequests:101},{maxTokens:0},{maxRuns:21}])await expect(prepareReadOnlyAutomation(f.root,entry,{...limits,...patch})).rejects.toThrow('bounded');expect(f.requests).toHaveLength(0);
}));

const nativeJob={version:1 as const,id:'scheduler_1111111111111111',cwd:'/home/reader/project space',home:'/home/reader/.ccpt',runtime:'/usr/bin/node',entry:'/home/reader/app/cli.js',minutes:7,repairCorrupt:false,enabled:true};
test('Linux timer/service definitions use a user oneshot without shell interpolation',()=>{
 const files=nativeSchedulerDefinitions({...nativeJob,entry:'/home/reader/%h/$TOKEN/"cli".js'},'linux'),service=files['ccpt-scheduler_1111111111111111.service']!;expect(service).toContain('Type=oneshot');expect(service).toContain('NoNewPrivileges=true');expect(service).toContain('%%h/$$TOKEN/\\"cli\\".js');expect(service).not.toContain('/bin/sh');expect(files['ccpt-scheduler_1111111111111111.timer']).toContain('OnUnitActiveSec=7min');
});
test('macOS plist uses a literal argument array and no KeepAlive restart loop',()=>{
 const plist=Object.values(nativeSchedulerDefinitions({...nativeJob,entry:'/home/reader/a&b.js'},'darwin'))[0]!;expect(plist).toContain('<key>ProgramArguments</key><array>');expect(plist).toContain('a&amp;b.js');expect(plist).toContain('<integer>420</integer>');expect(plist).toContain('<key>KeepAlive</key><false/>');expect(plist).not.toContain('sudo');
});
test('native generators reject argument control characters and invalid intervals',()=>{
 expect(()=>nativeSchedulerDefinitions({...nativeJob,entry:'bad\nargument'},'linux')).toThrow('argument');expect(()=>nativeSchedulerDefinitions({...nativeJob,minutes:0},'darwin')).toThrow('interval');
});
test('actual OS registration always requires an explicit confirmation',()=>fixture(async f=>{
 const job=await prepareReadOnlyAutomation(f.root,entry,limits);expect((await loadSchedulerJob(job.id)).platform).toBe(process.platform as any);await expect(installAutomationScheduler(job.id,false)).rejects.toThrow('confirm');
}));
