import { test, expect } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, validateConfig } from '../src/config.js';
import { createMcpModelSampling } from '../src/mcpModelSampling.js';
import { handleMcpInteraction, mcpInteractionCapabilities, negotiatedMcpHandlers } from '../src/mcpInteraction.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
import { withSpendScope, withModelBudget } from '../src/spending.js';
const req={messages:[{role:'user',content:{type:'text',text:'PRIVATE PROMPT'}}],maxTokens:32};
const tool={name:'server_lookup',inputSchema:{type:'object',properties:{q:{type:'string'}},required:['q']}};
async function fixture(action:(config:typeof defaultConfig,requests:any[],root:string)=>Promise<void>,respond?:(body:any,index:number)=>Response|Promise<Response>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-sampling067-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const requests:any[]=[];
 const server=Bun.serve({port:0,async fetch(request){const body=await request.json();requests.push(body);return respond?respond(body,requests.length):Response.json({choices:[{message:{content:'fixture answer'}}],usage:{prompt_tokens:20,completion_tokens:5}});}});
 const config=structuredClone(defaultConfig);config.model.provider='compatible';config.model.apiProtocol='chat-completions';config.model.baseUrl=`http://127.0.0.1:${server.port}/v1`;delete config.model.apiKeyEnv;config.model.maxContextTokens=4096;config.model.maxOutputTokens=64;config.model.thinkingEnabled=false;config.network={allowedHosts:['127.0.0.1'],rejectUnauthorized:true,timeoutMs:3000};config.hooks=[];
 try{await action(config,requests,root);}finally{server.stop(true);if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
const signal=()=>new AbortController().signal;
test('real shared model adapter handles text sampling with two approvals and request budget',()=>fixture(async(config,requests)=>{
 const phases:string[]=[],runtime=createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:5000},async phase=>{phases.push(phase);return true;});
 expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal())).toHaveProperty('result');expect(phases).toEqual(['request','share']);expect(requests).toHaveLength(1);expect(requests[0].tools).toBeUndefined();expect(requests[0].messages.some((m:any)=>JSON.stringify(m).includes('PRIVATE PROMPT'))).toBe(true);
 expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal())).toHaveProperty('error');expect(requests).toHaveLength(1);expect((await runtime.status()).requests).toBe(1);
}));
test('declined request uses no model; declined share never returns generated text',()=>fixture(async(config,requests)=>{
 let share=false;const denied=createMcpModelSampling(config,{maxRequests:2,maxReservedTokens:10000},async()=>false);expect(await handleMcpInteraction('sampling/createMessage',req,denied.handlers,signal())).toHaveProperty('error');expect(requests).toHaveLength(0);
 const runtime=createMcpModelSampling(config,{maxRequests:2,maxReservedTokens:10000},async phase=>{if(phase==='share')share=true;return phase==='request';});const outcome=await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal());expect(outcome).toHaveProperty('error');expect(JSON.stringify(outcome)).not.toContain('fixture answer');expect(share).toBe(true);expect(requests).toHaveLength(1);
}));
test('tool sampling returns server-defined calls, accepts tool-result continuation, never executes local tool names',()=>fixture(async(config,requests)=>{
 const runtime=createMcpModelSampling(config,{maxRequests:3,maxReservedTokens:15000,tools:true},async()=>true,{tools:true});expect(mcpInteractionCapabilities(runtime.handlers)).toEqual({sampling:{tools:{}}});
 const first:any=await handleMcpInteraction('sampling/createMessage',{...req,tools:[tool]},runtime.handlers,signal());expect(first.result.stopReason).toBe('toolUse');expect(first.result.content[0].name).toBe('server_lookup');expect(requests[0].tools[0].function.name).toBe('server_lookup');
 const continuation={...req,tools:[tool],messages:[...req.messages,{role:'assistant',content:first.result.content},{role:'user',content:[{type:'tool_result',toolUseId:'call_fixture',content:[{type:'text',text:'server-owned result'}]}]}]};
 expect(await handleMcpInteraction('sampling/createMessage',continuation,runtime.handlers,signal())).toHaveProperty('result');expect(requests[1].messages.some((m:any)=>m.role==='tool'&&m.content==='server-owned result')).toBe(true);
 const old=negotiatedMcpHandlers(runtime.handlers,'2025-06-18');expect(mcpInteractionCapabilities(old)).toEqual({sampling:{}});expect(await handleMcpInteraction('sampling/createMessage',{...req,tools:[tool]},old,signal())).toHaveProperty('error');expect(requests).toHaveLength(2);
},(_body,index)=>Response.json({choices:[{message:index===1?{tool_calls:[{id:'call_fixture',type:'function',function:{name:'server_lookup',arguments:'{"q":"test"}'}}]}:{content:'continued'}}],usage:{prompt_tokens:20,completion_tokens:5}})));
test('tools require both persistent capability ceiling and invocation opt-in',()=>fixture(async(config,requests)=>{
 expect(()=>createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:5000},async()=>true,{tools:true})).toThrow('explicit');const runtime=createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:5000,tools:true},async()=>true);expect(await handleMcpInteraction('sampling/createMessage',{...req,tools:[tool]},runtime.handlers,signal())).toHaveProperty('error');expect(requests).toHaveLength(0);
}));
test('nested sampling inherits the Agent ledger and cannot silently switch budget scopes',()=>fixture(async(config,requests)=>{
 const runtime=createMcpModelSampling(config,{maxRequests:2,maxReservedTokens:15000},async()=>true);
 await withSpendScope('parent-agent',async()=>{
  await withModelBudget({...config,spending:{maxRequests:5,maxTokens:20000}},async()=>({content:[],usage:{inputTokens:20,outputTokens:5}}));
  expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal())).toHaveProperty('result');
  expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal())).toHaveProperty('error');
 });
 expect((await runtime.status()).scope).toBe('parent-agent');expect((await runtime.status()).requests).toBe(2);expect(requests).toHaveLength(1);
 expect(await handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal())).toHaveProperty('error');expect(requests).toHaveLength(1);
}));
test('concurrent approvals cannot overspend request limit and token ceiling blocks before HTTP',()=>fixture(async(config,requests)=>{
 const runtime=createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:5000},async()=>true);const outcomes=await Promise.all(Array.from({length:8},()=>handleMcpInteraction('sampling/createMessage',req,runtime.handlers,signal())));expect(outcomes.filter(row=>'result'in row)).toHaveLength(1);expect(requests).toHaveLength(1);
 const blocked=createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:10},async()=>true);expect(await handleMcpInteraction('sampling/createMessage',req,blocked.handlers,signal())).toHaveProperty('error');expect(requests).toHaveLength(1);
}));
test('cancellation during actual HTTP keeps unknown reservation and shares no content',()=>fixture(async(config,requests)=>{
 const controller=new AbortController(),runtime=createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:5000},async()=>true);const pending=handleMcpInteraction('sampling/createMessage',req,runtime.handlers,controller.signal);const deadline=Date.now()+2000;while(!requests.length&&Date.now()<deadline)await Bun.sleep(10);controller.abort();expect(await pending).toHaveProperty('error');const status=await runtime.status();expect(status.requests).toBe(1);expect(Object.keys(status.reservations)).toHaveLength(1);
},async()=>{await Bun.sleep(500);return Response.json({choices:[{message:{content:'too late'}}]});}));
test('strict mode, unsupported audio/empty required choice and invalid settings do not reach the provider',()=>fixture(async(config,requests)=>{
 config.policy.mode='restricted';expect(()=>createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:5000},async()=>true)).toThrow('restricted');config.policy.mode='normal';
 const runtime=createMcpModelSampling(config,{maxRequests:2,maxReservedTokens:10000,tools:true},async()=>true,{tools:true});expect(await handleMcpInteraction('sampling/createMessage',{...req,toolChoice:{mode:'required'}},runtime.handlers,signal())).toHaveProperty('error');expect(await handleMcpInteraction('sampling/createMessage',{...req,messages:[{role:'user',content:{type:'audio',mimeType:'audio/wav',data:Buffer.from('test').toString('base64')}}]},runtime.handlers,signal())).toHaveProperty('error');expect(requests).toHaveLength(0);
 config.mcpServers={test:{transport:'http',url:'https://example.invalid',samplingBudget:{maxRequests:0,maxReservedTokens:100}}};expect(()=>validateConfig(config)).toThrow('samplingBudget');
}));
