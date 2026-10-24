import {test,expect} from 'bun:test';
import {mkdtemp,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaultConfig} from '../src/config.js';
import {runEnterpriseAcceptance} from '../src/enterpriseAcceptance.js';
import {benchmarkTextContext} from '../src/contextBenchmark.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import {evaluatePermission} from '../src/utils/permissions/permissions.js';
import {writeJson} from '../src/storage.js';
async function fixture(protocol:'responses'|'chat-completions',action:(root:string,c:typeof defaultConfig,requests:any[])=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-company069-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const requests:any[]=[];
 const server=Bun.serve({port:0,async fetch(request){const body:any=await request.json();requests.push(body);const index=requests.length,marker=JSON.stringify(body).match(/CCPT_[a-f0-9]{32}/)?.[0]??'CCPT_OK';
  const delta=protocol==='responses'?{type:'response.output_text.delta',delta:index===7?'CANCEL':marker}:{choices:[{delta:{content:index===7?'CANCEL':marker}}]};if(index===7)return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\n`))}}),{headers:{'content-type':'text/event-stream'}});
  let text=marker,name='ccpt_probe_echo',args={value:'CCPT_OK'} as Record<string,string>;
  if(index===8){const prompt=(body.input??body.messages).find((m:any)=>m.role==='user').content as string;const match=/Use read_file to read exactly ("[^"]+")/.exec(prompt);if(!match)throw new Error('Missing exact fixture path');name='read_file';args={path:JSON.parse(match[1]!)};}
  if(index===9)text=protocol==='responses'?body.input.find((i:any)=>i.type==='function_call_output').output:body.messages.find((i:any)=>i.role==='tool').content;
  const call=index===4||index===8,response=protocol==='responses'?{id:`resp_${index}`,status:'completed',output:call?[{type:'function_call',call_id:'probe-call',name,arguments:JSON.stringify(args)}]:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:5}}:{choices:[{message:call?{role:'assistant',tool_calls:[{id:'probe-call',type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:text},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}};
  if(index===6)return new Response(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(protocol==='responses'?{type:'response.completed',response}:response)}\n\n${protocol==='responses'?'':'data: [DONE]\n\n'}`,{headers:{'content-type':'text/event-stream'}});return Response.json(response);
 }});const c=structuredClone(defaultConfig);c.hooks=[];c.model.apiProtocol=protocol;c.model.endpointUrl=`http://127.0.0.1:${server.port}/${protocol==='responses'?'responses':'chat/completions'}`;c.model.apiKeyEnv='';c.model.maxContextTokens=4096;c.model.maxOutputTokens=64;c.model.thinkingEnabled=false;c.network={allowedHosts:['127.0.0.1'],rejectUnauthorized:true,timeoutMs:3000};c.policy.workspaceRoots=[root];
 try{await action(root,c,requests)}finally{server.stop(true);if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root)}}
for(const protocol of ['responses','chat-completions'] as const)test(`${protocol}: full paid-opt-in deployment suite includes actual dispatcher/file/result continuation`,()=>fixture(protocol,async(root,c,requests)=>{
 const report=await runEnterpriseAcceptance(root,c,{confirmed:true,maxRequests:12,maxTokens:100000,timeoutMs:3000});expect(report.ok,JSON.stringify(report)).toBe(true);expect(requests).toHaveLength(9);expect(report.workspaceFilesRead).toBe(1);expect(report.budget!.requests).toBe(9);expect(report.checks).toHaveLength(6);expect((await readdir(root)).some(n=>n.startsWith('.ccpt-acceptance-'))).toBe(false);expect(c.model.responsesStore).toBe(defaultConfig.model.responsesStore);expect(JSON.stringify(report)).not.toContain('ACCEPTANCE_');
}),15000);
test('enterprise suite has zero calls before explicit bounded confirmation and respects its shared request ceiling',()=>fixture('responses',async(root,c,requests)=>{
 await expect(runEnterpriseAcceptance(root,c,{confirmed:false,maxRequests:12,maxTokens:100000})).rejects.toThrow('--confirm');expect(requests).toHaveLength(0);const result=await runEnterpriseAcceptance(root,c,{confirmed:true,maxRequests:1,maxTokens:100000});expect(result.ok).toBe(false);expect(requests).toHaveLength(1);expect(result.budget!.requests).toBe(1);
}));
for(const rule of ['read_file(*)','Read(*)'])test(`actual read stage preserves deployment deny rule ${rule}`,()=>fixture('responses',async(root,c,requests)=>{
 c.policy.permissionRules.deny=[rule];const result=await runEnterpriseAcceptance(root,c,{confirmed:true,maxRequests:12,maxTokens:100000,timeoutMs:3000});expect(result.ok).toBe(false);expect(requests).toHaveLength(8);expect(result.workspaceFilesRead).toBe(0);expect(JSON.stringify(result)).not.toContain('ACCEPTANCE_');
}),15000);
test('local BPE benchmark measures counts, never pretends to verify model quality',()=>{
 const result=benchmarkTextContext(1000);expect(result.ok).toBe(true);expect(result.measuredTokens).toBe(1000);expect(result.modelRequests).toBe(0);expect(result.scope).toContain('not repository');expect(()=>benchmarkTextContext(1000001)).toThrow();
});
test('legacy deny/ask aliases cover native tool variants, but legacy allows are not broadened',()=>{
 const c=structuredClone(defaultConfig);c.policy.permissionRules={allow:[],ask:['Read(*)'],deny:['Bash(*)']};expect(evaluatePermission('read_file',{path:'file'},c)?.behavior).toBe('ask');expect(evaluatePermission('notebook_read',{notebook_path:'x'},c)?.behavior).toBe('ask');expect(evaluatePermission('shell_start',{command:'git'},c)?.behavior).toBe('deny');expect(evaluatePermission('run_command',{command:'git'},c)?.behavior).toBe('deny');c.policy.permissionRules={allow:['Read(*)'],ask:[],deny:[]};expect(evaluatePermission('read_file',{path:'file'},c)).toBeUndefined();
});
test('path-sensitive legacy edit/read denial uses native paths; multi-file patch denial is conservative',()=>{
 const c=structuredClone(defaultConfig);c.policy.permissionRules={allow:[],ask:[],deny:['Edit(secret.txt)','Read(private.ipynb)']};expect(evaluatePermission('edit_file',{path:'secret.txt',before:'a',after:'b'},c)?.behavior).toBe('deny');expect(evaluatePermission('notebook_read',{notebook_path:'private.ipynb'},c)?.behavior).toBe('deny');expect(evaluatePermission('apply_patch',{patch:'multi-file input'},c)?.behavior).toBe('deny');
});
test('actual built Node enterprise acceptance CLI honors explicit request/token flags',()=>fixture('responses',async(root,c,requests)=>{
 c.network.proxyUrl='';await writeJson(join(root,'.ccpt/settings.json'),c);const child=Bun.spawn(['node',join(import.meta.dir,'../dist/cli.js'),'model','enterprise-acceptance','--confirm','--max-requests','12','--max-tokens','100000','--timeout','3000','--cwd',root],{cwd:root,env:{...process.env},stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>child.kill(),20000);try{const[out,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(code,error+out).toBe(0);const report=JSON.parse(out);expect(report.ok).toBe(true);expect(report.budget.requests).toBe(9);expect(requests).toHaveLength(9);}finally{clearTimeout(timer);}
}),25000);
