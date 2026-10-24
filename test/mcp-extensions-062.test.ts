import {test,expect} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleMcpInteraction,mcpInteractionCapabilities,mcpInteractionProtocol,negotiatedMcpHandlers,type McpInteractionHandlers} from '../src/mcpInteraction.js';
import {callMcpServer} from '../src/mcp.js';
import {defaultConfig} from '../src/config.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
async function fixture(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-mcp062-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');try{await action(root);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
const urlRequest={mode:'url',url:'https://secure.example/review?elicitationId=fixture',elicitationId:'fixture',message:'Review the external authorization on its own site'};
test('downgrade mask retains live approval revocation while never enabling newly installed unsupported callbacks',async()=>{
 const handlers:McpInteractionHandlers={confirmSampling:async()=>true,sample:async()=>({role:'assistant',model:'fixture',content:{type:'text',text:'MUST_NOT_SHARE'}}),confirmSamplingResult:async()=>true};const masked=negotiatedMcpHandlers(handlers,'2025-06-18')!;
 handlers.confirmSampling=async()=>false;handlers.elicitUrl=async()=>({action:'accept'});handlers.urlOrigins=['https://secure.example'];
 expect(masked.elicitUrl).toBeUndefined();expect(masked.urlOrigins).toBeUndefined();const result=await handleMcpInteraction('sampling/createMessage',{messages:[{role:'user',content:{type:'text',text:'test'}}],maxTokens:10},masked,new AbortController().signal);expect(result).toHaveProperty('error');expect(JSON.stringify(result)).not.toContain('MUST_NOT_SHARE');
 expect(negotiatedMcpHandlers(Object.freeze(handlers),'2025-06-18')!.elicitUrl).toBeUndefined();
});
test('URL elicitation uses pinned HTTPS origins, explicit consent and no content/credential result',()=>fixture(async()=>{
 let calls=0;const handlers:McpInteractionHandlers={urlOrigins:['https://secure.example'],elicitUrl:async req=>{calls++;expect(req.elicitationId).toBe('fixture');return {action:'accept'};}};const signal=new AbortController().signal;
 expect(mcpInteractionProtocol(handlers)).toBe('2025-11-25');expect(mcpInteractionCapabilities(handlers)).toEqual({elicitation:{url:{}}});expect(await handleMcpInteraction('elicitation/create',urlRequest,handlers,signal)).toEqual({result:{action:'accept'}});
 for(const url of ['http://secure.example/x','https://other.example/x','https://user:password@secure.example/x','https://secure.example/x#secret','file:///tmp/private']){expect(await handleMcpInteraction('elicitation/create',{...urlRequest,url},handlers,signal)).toHaveProperty('error');}expect(calls).toBe(1);
 expect(await handleMcpInteraction('elicitation/create',urlRequest,{...handlers,elicitUrl:async()=>({action:'accept',content:{secret:'never'}} as never)},signal)).toHaveProperty('error');
 expect(negotiatedMcpHandlers(handlers,'2025-06-18')!.elicitUrl).toBeUndefined();
}));
test('URL decline, cancellation and timeout never imply out-of-band completion',()=>fixture(async()=>{
 for(const action of ['decline','cancel'] as const){const result=await handleMcpInteraction('elicitation/create',urlRequest,{urlOrigins:['https://secure.example'],elicitUrl:async()=>({action})},new AbortController().signal);expect(result).toEqual({result:{action}});}
 const controller=new AbortController();let aborted=false;const handlers:McpInteractionHandlers={timeoutMs:30,urlOrigins:['https://secure.example'],elicitUrl:async(_req,signal)=>{signal.addEventListener('abort',()=>{aborted=true;},{once:true});return new Promise(()=>{});}};expect(await handleMcpInteraction('elicitation/create',urlRequest,handlers,controller.signal)).toHaveProperty('error');expect(aborted).toBe(true);
}));
test('multimodal SDK sampling has independent pre-model and pre-share approval; no implicit provider conversion',()=>fixture(async()=>{
 const params={messages:[{role:'user',content:{type:'image',mimeType:'image/png',data:Buffer.from('fixture-media').toString('base64')}}],maxTokens:20};let samples=0;
 const handlers:McpInteractionHandlers={confirmMultimodalSampling:async()=>true,sampleMultimodal:async req=>{samples++;expect(req.messages[0]!.content.type).toBe('image');return {role:'assistant',model:'fixture',content:{type:'text',text:'PRIVATE_SAMPLE'}};},confirmMultimodalSamplingResult:async()=>false};
 const denied=await handleMcpInteraction('sampling/createMessage',params,handlers,new AbortController().signal);expect(denied).toHaveProperty('error');expect(JSON.stringify(denied)).not.toContain('PRIVATE_SAMPLE');expect(samples).toBe(1);
 handlers.confirmMultimodalSamplingResult=async()=>true;expect(await handleMcpInteraction('sampling/createMessage',params,handlers,new AbortController().signal)).toHaveProperty('result');handlers.confirmMultimodalSampling=async()=>false;await handleMcpInteraction('sampling/createMessage',params,handlers,new AbortController().signal);expect(samples).toBe(2);
 expect(await handleMcpInteraction('sampling/createMessage',{...params,messages:[{role:'user',content:{type:'image',mimeType:'text/html',data:'???'}}]},handlers,new AbortController().signal)).toHaveProperty('error');expect(negotiatedMcpHandlers(handlers,'2025-06-18')!.sampleMultimodal).toBeUndefined();
}));
for(const version of ['2025-11-25','2025-06-18'])test(`actual Streamable HTTP URL capability negotiation ${version} preserves downgrade denial`,()=>fixture(async root=>{
 let initialize:any,toolId=0,reply:any,controller:ReadableStreamDefaultController<Uint8Array>,consents=0;const encoder=new TextEncoder();const server=Bun.serve({port:0,async fetch(req){if(req.method==='DELETE')return new Response(null,{status:204});const body:any=await req.json();if(body.method==='initialize'){initialize=body.params;return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:version,capabilities:{}}},{headers:{'mcp-session-id':'fixture062'}});}if(body.method==='notifications/initialized')return new Response(null,{status:202});if(body.method==='tools/call'){toolId=body.id;return new Response(new ReadableStream({start(value){controller=value;value.enqueue(encoder.encode(`data: ${JSON.stringify({jsonrpc:'2.0',id:'review',method:'elicitation/create',params:urlRequest})}\n\n`));}}),{headers:{'content-type':'text/event-stream'}});}reply=body;controller!.enqueue(encoder.encode(`data: ${JSON.stringify({jsonrpc:'2.0',id:toolId,result:{done:true}})}\n\n`));controller!.close();return new Response(null,{status:202});}});
 const config=structuredClone(defaultConfig);config.hooks=[];config.policy.workspaceRoots=[root];const handlers:McpInteractionHandlers={urlOrigins:['https://secure.example'],elicitUrl:async()=>{consents++;return {action:'accept'};}};
 try{expect(await callMcpServer('fixture',{transport:'http',httpMode:'streamable',url:`http://127.0.0.1:${server.port}`},'fixture',{},true,undefined,config,handlers)).toEqual({done:true});expect(initialize.protocolVersion).toBe('2025-11-25');expect(initialize.capabilities).toEqual({elicitation:{url:{}}});expect(consents).toBe(version==='2025-11-25'?1:0);expect(reply).toHaveProperty(version==='2025-11-25'?'result':'error');}finally{server.stop(true);}
}));
