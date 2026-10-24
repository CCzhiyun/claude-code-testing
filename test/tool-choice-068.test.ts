import {test,expect} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../src/config.js';
import {createMcpModelSampling} from '../src/mcpModelSampling.js';
import {handleMcpInteraction} from '../src/mcpInteraction.js';
import {callModel} from '../src/model.js';
import {withModelToolChoice} from '../src/modelToolChoice.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import {withExecutionSignal} from '../src/executionControl.js';
const tool={name:'lookup',inputSchema:{type:'object',properties:{q:{type:'string'}},required:['q'],additionalProperties:false}};
const req={messages:[{role:'user',content:{type:'text',text:'look up'}}],maxTokens:32,tools:[tool],toolChoice:{mode:'required'}};
const wireTool={name:tool.name,description:'fixture',input_schema:tool.inputSchema};
const chat=(name='lookup')=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'call_1',type:'function',function:{name,arguments:'{"q":"fixture"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:3}});
const native=(name='lookup')=>({id:'resp_1',status:'completed',output:[{type:'function_call',status:'completed',call_id:'call_1',name,arguments:'{"q":"fixture"}'}],usage:{input_tokens:10,output_tokens:3}});
async function fixture(protocol:'responses'|'chat-completions',action:(c:typeof defaultConfig,requests:any[],respond:(fn:(body:any)=>Response)=>void)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-choice068-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const requests:any[]=[];let response=(body:any)=>Response.json(protocol==='responses'?native():chat());
 const server=Bun.serve({port:0,async fetch(r){const b=await r.json();requests.push(b);return response(b)}});const c=structuredClone(defaultConfig);c.hooks=[];c.model.provider='compatible';c.model.apiProtocol=protocol;c.model.baseUrl=`http://127.0.0.1:${server.port}/v1`;c.model.apiKeyEnv='';c.model.thinkingEnabled=false;c.model.maxContextTokens=4096;c.model.maxOutputTokens=64;c.network={allowedHosts:['127.0.0.1'],rejectUnauthorized:true,timeoutMs:3000};
 try{await action(c,requests,fn=>{response=fn})}finally{server.stop(true);if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root)}
}
for(const protocol of ['responses','chat-completions'] as const)test(`${protocol}: required sampling crosses HTTP, returns call and needs separate share approval`,()=>fixture(protocol,async(c,requests)=>{
 const phases:string[]=[],runtime=createMcpModelSampling(c,{maxRequests:2,maxReservedTokens:10000,tools:true},async phase=>{phases.push(phase);return true},{tools:true});const result:any=await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,new AbortController().signal);
 expect(result.result.content[0].name).toBe('lookup');expect(requests[0].tool_choice).toBe('required');expect(phases).toEqual(['request','share']);expect(requests[0].tools[0][protocol==='responses'?'name':'function']).toEqual(protocol==='responses'?'lookup':{name:'lookup',description:'',parameters:tool.inputSchema});
}));
for(const protocol of ['responses','chat-completions'] as const)test(`${protocol}: required streaming can be cancelled without a partial tool result`,()=>fixture(protocol,async(c,requests,set)=>{
 let opened=false,closed=false;set(()=>new Response(new ReadableStream({start(controller){opened=true;controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));},cancel(){closed=true;}}),{headers:{'Content-Type':'text/event-stream'}}));
 const controller=new AbortController(),pending=withExecutionSignal(controller.signal,()=>withModelToolChoice('required',()=>callModel(c,'',[],[wireTool],{})));const until=Date.now()+2000;while(!opened&&Date.now()<until)await Bun.sleep(10);expect(opened).toBe(true);controller.abort();await expect(pending).rejects.toThrow();expect(requests).toHaveLength(1);void closed;
}));
test('Responses Chat bridge preserves required choice instead of silently dropping it',()=>fixture('chat-completions',async(c,requests)=>{
 c.model.apiProtocol='responses';c.model.responsesTransport='chat-completions';await withModelToolChoice('required',()=>callModel(c,'',[{role:'user',content:'fixture'}],[wireTool]));expect(requests[0].tool_choice).toBe('required');
}));
test('required result rejection and undeclared tools never reach share approval; no cross-call choice leakage',()=>fixture('responses',async(c,requests,set)=>{
 let shares=0;const runtime=createMcpModelSampling(c,{maxRequests:5,maxReservedTokens:30000,tools:true},async phase=>{if(phase==='share')shares++;return true},{tools:true});set(()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'ignored required'}]}],usage:{input_tokens:10,output_tokens:3}}));
 expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,new AbortController().signal)).toHaveProperty('error');expect(shares).toBe(0);set(()=>Response.json(native('not_declared')));expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,new AbortController().signal)).toHaveProperty('error');expect(shares).toBe(0);
 set(()=>Response.json(native()));await callModel(c,'',[],[wireTool]);expect(requests.at(-1).tool_choice).toBeUndefined();
}));
test('none rejects rogue calls, required empty tools and Messages mode fail before HTTP',()=>fixture('chat-completions',async(c,requests)=>{
 await expect(withModelToolChoice('none',()=>callModel(c,'',[],[wireTool]))).rejects.toThrow('tool_choice=none');expect(requests).toHaveLength(1);
 await expect(withModelToolChoice('required',()=>callModel(c,'',[],[]))).rejects.toThrow('at least one');c.model.apiProtocol='messages';await expect(withModelToolChoice('required',()=>callModel(c,'',[],[wireTool]))).rejects.toThrow('Responses or Chat');expect(requests).toHaveLength(1);
}));
for(const protocol of ['responses','chat-completions'] as const)test(`${protocol}: streaming required choice keeps wire field and completed call`,()=>fixture(protocol,async(c,requests,set)=>{
 set(()=>new Response(protocol==='responses'?`event: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:native()})}\n\n`:`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'lookup',arguments:'{"q":"fixture"}'}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}}));
 const response=await withModelToolChoice('required',()=>callModel(c,'',[],[wireTool],{}));expect(requests[0].stream).toBe(true);expect(requests[0].tool_choice).toBe('required');expect(response.content[0]!.name).toBe('lookup');
}));
