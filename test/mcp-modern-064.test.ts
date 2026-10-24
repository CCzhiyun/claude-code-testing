import {test,expect} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {handleMcpInteraction,mcpInteractionCapabilities,mcpInteractionProtocol,negotiatedMcpHandlers,McpInteractionSession,type McpInteractionHandlers} from '../src/mcpInteraction.js';
import {parseModernSampling,parseModernSamplingResult} from '../src/mcpSamplingModern.js';
import {McpProtocolError} from '../src/mcpErrors.js';
import {callMcpServer,StdioMcpClient,watchMcpServer} from '../src/mcp.js';
import {defaultConfig} from '../src/config.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';

async function fixture(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-mcp064-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');try{await action(root);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
const tool={name:'lookup',inputSchema:{type:'object',properties:{q:{type:'string'}},required:['q']}};
const request={messages:[{role:'user',content:[{type:'text',text:'Find a record'}]}],tools:[tool],toolChoice:{mode:'auto'},maxTokens:50};
const output={role:'assistant' as const,model:'fixture',stopReason:'toolUse' as const,content:[{type:'tool_use' as const,id:'call_1',name:'lookup',input:{q:'fixture'}}]};
test('modern sampling declares tools only for a full explicit callback triplet, and downgrade never exposes them',()=>{
 const handlers:McpInteractionHandlers={samplingTools:true,confirmModernSampling:async()=>true,sampleModern:async()=>output,confirmModernSamplingResult:async()=>true};
 expect(mcpInteractionProtocol(handlers)).toBe('2025-11-25');expect(mcpInteractionCapabilities(handlers)).toEqual({sampling:{tools:{}}});expect(mcpInteractionCapabilities({...handlers,sampleModern:undefined} as never)).toEqual({});
 const older=negotiatedMcpHandlers(handlers,'2025-06-18')!;expect(older.sampleModern).toBeUndefined();expect(mcpInteractionCapabilities(older)).toEqual({});
});
test('tool sampling needs both approvals, validates results, and never runs a server tool',()=>fixture(async()=>{
 let calls=0,shared=0;const handlers:McpInteractionHandlers={samplingTools:true,confirmModernSampling:async()=>true,sampleModern:async req=>{calls++;expect(req.tools![0]!.name).toBe('lookup');return output;},confirmModernSamplingResult:async()=>{shared++;return false;}};
 const signal=new AbortController().signal;expect(await handleMcpInteraction('sampling/createMessage',request,handlers,signal)).toHaveProperty('error');expect(calls).toBe(1);expect(shared).toBe(1);
 handlers.confirmModernSamplingResult=async()=>true;expect(await handleMcpInteraction('sampling/createMessage',request,handlers,signal)).toEqual({result:output});
 handlers.confirmModernSampling=async()=>false;expect(await handleMcpInteraction('sampling/createMessage',request,handlers,signal)).toHaveProperty('error');expect(calls).toBe(2);
 handlers.confirmModernSampling=async()=>true;handlers.sampleModern=async()=>({...output,content:[{...output.content[0]!,name:'not_registered'}]});expect(await handleMcpInteraction('sampling/createMessage',request,handlers,signal)).toHaveProperty('error');
}));
test('balanced tool histories, content arrays and no-tool choice enforce protocol invariants',()=>{
 const valid={...request,messages:[...request.messages,{role:'assistant',content:output.content},{role:'user',content:[{type:'tool_result',toolUseId:'call_1',content:[{type:'text',text:'result'}]}]}]};expect(parseModernSampling(valid,true).messages).toHaveLength(3);
 for(const messages of [[...valid.messages.slice(0,2)], [...valid.messages.slice(0,2),{role:'user',content:[{type:'tool_result',toolUseId:'call_1',content:[]},{type:'text',text:'mixed'}]}], [...valid.messages.slice(0,2),{role:'user',content:{type:'tool_result',toolUseId:'wrong',content:[]}}]])expect(()=>parseModernSampling({...request,messages},true)).toThrow();
 expect(()=>parseModernSampling(request,false)).toThrow();expect(()=>parseModernSampling({...request,tools:[{name:'bad',inputSchema:{type:'object',properties:{array:{type:'array'}}}}]},true)).toThrow('items');
 expect(()=>parseModernSamplingResult(output,{...parseModernSampling(request,true),toolChoice:{mode:'none'}})).toThrow();
 expect(()=>parseModernSamplingResult({...output,content:[output.content[0]!,output.content[0]!] },parseModernSampling(request,true))).toThrow();
 expect(()=>parseModernSamplingResult({...output,stopReason:'endTurn'},parseModernSampling(request,true))).toThrow();
 expect(()=>parseModernSamplingResult(output,parseModernSampling(valid,true))).toThrow();
});
test('modern content arrays carry bounded media and cancellation aborts the approval callback',()=>fixture(async()=>{
 const media={type:'image',mimeType:'image/png',data:Buffer.from('fixture').toString('base64')};const req={messages:[{role:'user',content:[{type:'text',text:'image'},media]}],maxTokens:20};expect(parseModernSampling(req,false).messages).toHaveLength(1);
 expect(()=>parseModernSampling({...req,messages:[{role:'user',content:[{...media,data:'?'}]}]},false)).toThrow();let stopped=false;
 const handlers:McpInteractionHandlers={timeoutMs:20,confirmModernSampling:async(_req,signal)=>{signal.addEventListener('abort',()=>{stopped=true;},{once:true});return new Promise(()=>{});},sampleModern:async()=>{throw new Error('Must not execute');},confirmModernSamplingResult:async()=>true};
 expect(await handleMcpInteraction('sampling/createMessage',req,handlers,new AbortController().signal)).toHaveProperty('error');expect(stopped).toBe(true);
}));

test('actual Node stdio negotiates modern tool sampling, isolates mutable approvals and rejects stale callback authority',()=>fixture(async()=>{
 const handlers:McpInteractionHandlers={samplingTools:true,confirmModernSampling:async req=>{req.tools![0]!.name='mutated';return true;},sampleModern:async req=>{expect(req.tools![0]!.name).toBe('lookup');return output;},confirmModernSamplingResult:async result=>{result.content={type:'text',text:'mutated'};return true;}};
 const client=new StdioMcpClient();try{await client.connect({transport:'stdio',command:'node',args:[join(import.meta.dir,'mcp-interaction-fixture.cjs'),'--modern']},undefined,undefined,handlers);
 const result:any=await client.request('tools/call',{name:'fixture',arguments:{reverse:{method:'sampling/createMessage',params:request}}});expect(result.capabilities).toEqual({sampling:{tools:{}}});expect(result.reverse.result).toEqual(output);
 handlers.confirmModernSampling=async()=>false;const rejected:any=await client.request('tools/call',{name:'fixture',arguments:{reverse:{method:'sampling/createMessage',params:request}}});expect(rejected.reverse.error.code).toBe(-1);
 }finally{await client.close();}
}));

test('actual POST/SSE modern sampling and URL completion use the original endpoint/session without tool replay',()=>fixture(async root=>{
 let stream:ReadableStreamDefaultController<Uint8Array>,toolId=0,toolPosts=0,completed=0;const replies:any[]=[],notifications:unknown[]=[],encoder=new TextEncoder();
 const emit=(value:unknown)=>stream.enqueue(encoder.encode(`data: ${JSON.stringify({jsonrpc:'2.0',...value as object})}\n\n`));
 const server=Bun.serve({port:0,async fetch(req){if(req.method==='DELETE')return new Response(null,{status:204});const body:any=await req.json();if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-11-25',capabilities:{}}},{headers:{'mcp-session-id':'post064'}});if(body.method==='notifications/initialized')return new Response(null,{status:202});
 expect(req.headers.get('mcp-session-id')).toBe('post064');expect(req.headers.get('mcp-protocol-version')).toBe('2025-11-25');
 if(body.method==='tools/call'){toolPosts++;toolId=body.id;return new Response(new ReadableStream({start(controller){stream=controller;emit({id:'sample',method:'sampling/createMessage',params:request});}}),{headers:{'content-type':'text/event-stream'}});}
 replies.push(body);if(body.id==='sample')emit({id:'url',method:'elicitation/create',params:{mode:'url',url:'https://secure.example/review',elicitationId:'one',message:'Review'}});
 else {for(const elicitationId of ['unknown','one','one'])emit({method:'notifications/elicitation/complete',params:{elicitationId}});emit({id:toolId,result:{done:true}});stream.close();}return new Response(null,{status:202});}});
 const config=structuredClone(defaultConfig);config.hooks=[];config.policy.workspaceRoots=[root];const handlers:McpInteractionHandlers={samplingTools:true,confirmModernSampling:async()=>true,sampleModern:async()=>output,confirmModernSamplingResult:async()=>true,urlOrigins:['https://secure.example'],elicitUrl:async()=>({action:'accept'}),onUrlElicitationComplete:()=>{completed++;}};
 try{const result=await callMcpServer('fixture',{transport:'http',httpMode:'streamable',url:`http://127.0.0.1:${server.port}`},'fixture',{},true,value=>{notifications.push(value);},config,handlers);expect(result).toEqual({done:true});expect(replies[0].result).toEqual(output);expect(replies[1].result).toEqual({action:'accept'});expect(completed).toBe(1);expect(notifications).toHaveLength(1);expect(toolPosts).toBe(1);}finally{server.stop(true);}
}));

test('actual independent GET modern interactions survive cursor reconnect, deduplicate completion and cancel pending review',()=>fixture(async root=>{
 const encoder=new TextEncoder(),posts:any[]=[],gets:Request[]=[];let approvals=0,samples=0,shares=0,completed=0,cancelling=false,reviewAborted=false;const cancel=new AbortController();
 const event=(id:string,value:object)=>`id: ${id}\ndata: ${JSON.stringify({jsonrpc:'2.0',...value})}\n\n`;
 const server=Bun.serve({port:0,async fetch(req){if(req.method==='DELETE')return new Response(null,{status:204});if(req.method==='GET'){gets.push(new Request(req.url,{headers:new Headers(req.headers)}));const text=cancelling?event('pending',{id:'pending',method:'sampling/createMessage',params:request}):gets.length===1?event('s',{id:'sample',method:'sampling/createMessage',params:request})+event('u',{id:'url',method:'elicitation/create',params:{mode:'url',url:'https://secure.example/review',elicitationId:'one',message:'Review'}})+event('n1',{method:'notifications/message',params:{data:'first'}}):event('s',{id:'sample',method:'sampling/createMessage',params:request})+event('unknown',{method:'notifications/elicitation/complete',params:{elicitationId:'unknown'}})+event('complete',{method:'notifications/elicitation/complete',params:{elicitationId:'one'}})+event('duplicate',{method:'notifications/elicitation/complete',params:{elicitationId:'one'}});return new Response(cancelling?new ReadableStream({start(controller){controller.enqueue(encoder.encode(text));}}):text,{headers:{'content-type':'text/event-stream'}});}
 const body:any=await req.json();posts.push(body);if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-11-25',capabilities:{}}},{headers:{'mcp-session-id':'get064'}});return new Response(null,{status:202});}});
 const config=structuredClone(defaultConfig);config.hooks=[];config.policy.workspaceRoots=[root];config.mcpServers={fixture:{transport:'http',httpMode:'streamable',url:`http://127.0.0.1:${server.port}`}};
 const handlers:McpInteractionHandlers={samplingTools:true,confirmModernSampling:async(_req,signal)=>{approvals++;if(cancelling){signal.addEventListener('abort',()=>{reviewAborted=true;},{once:true});cancel.abort();return new Promise(()=>{});}return true;},sampleModern:async()=>{samples++;return output;},confirmModernSamplingResult:async()=>{shares++;return true;},urlOrigins:['https://secure.example'],elicitUrl:async()=>({action:'accept'}),onUrlElicitationComplete:()=>{completed++;}};
 try{const result=await watchMcpServer('fixture',config,{durationMs:3000,maxEvents:2,reconnectDelayMs:10,interactions:handlers});expect(result.reason).toBe('event-limit');expect([approvals,samples,shares,completed]).toEqual([1,1,1,1]);expect(gets[1]!.headers.get('last-event-id')).toBe('n1');expect(posts.filter(p=>p.id==='sample')).toHaveLength(1);expect(posts.some(p=>p.method==='tools/call')).toBe(false);
 cancelling=true;const cancelled=await watchMcpServer('fixture',config,{durationMs:3000,signal:cancel.signal,interactions:handlers});expect(cancelled.reason).toBe('cancelled');expect(reviewAborted).toBe(true);expect(samples).toBe(1);expect(posts.some(p=>p.id==='pending')).toBe(false);
 }finally{cancel.abort();server.stop(true);}
}));
test('URL completion is session-bound, accepted only once and never inferred from consent',()=>fixture(async()=>{
 const session=new McpInteractionSession(),other=new McpInteractionSession();let completed=0;const handlers:McpInteractionHandlers={urlOrigins:['https://secure.example'],elicitUrl:async()=>({action:'accept'}),onUrlElicitationComplete:()=>{completed++;}};
 const params={mode:'url',url:'https://secure.example/review',elicitationId:'one',message:'External review'};
 expect(session.notification('notifications/elicitation/complete',{elicitationId:'one'},handlers)).toBe(false);
 expect(await handleMcpInteraction('elicitation/create',params,handlers,new AbortController().signal,session)).toEqual({result:{action:'accept'}});expect(completed).toBe(0);
 expect(other.notification('notifications/elicitation/complete',{elicitationId:'one'},handlers)).toBe(false);expect(session.notification('notifications/elicitation/complete',{elicitationId:'one'},handlers)).toBe(true);expect(session.notification('notifications/elicitation/complete',{elicitationId:'one'},handlers)).toBe(false);expect(completed).toBe(1);
 expect(await handleMcpInteraction('elicitation/create',params,handlers,new AbortController().signal,session)).toHaveProperty('error');
}));
test('URL required errors retain structured code and pinned URLs but redact printable diagnostics',()=>{
 const raw={code:-32042,message:'Authorization: Bearer private-value https://secure.example/review?token=secret',data:{elicitations:[{mode:'url',url:'https://secure.example/review?state=one',message:'Review external service',elicitationId:'one'}]}};
 const error=new McpProtocolError(raw,{urlOrigins:['https://secure.example']});expect(error.code).toBe(-32042);expect(error.elicitations![0]!.elicitationId).toBe('one');expect(error.message).not.toContain('private-value');expect(error.message).not.toContain('?token=');expect(JSON.stringify(error)).not.toContain('?state=');
 const blocked=new McpProtocolError(raw,{urlOrigins:['https://other.example']});expect(blocked.urlElicitationBlocked).toBe(true);expect(blocked.code).toBe(-32042);expect(blocked.elicitations).toBeUndefined();expect(()=>new McpProtocolError({...raw,data:{elicitations:[]}},{})).toThrow();
});
test('actual HTTP tools request exposes structured URL error without automatic replay or opening URLs',()=>fixture(async root=>{
 let posts=0;const server=Bun.serve({port:0,async fetch(req){if(req.method==='DELETE')return new Response(null,{status:204});const body:any=await req.json();if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-11-25',capabilities:{}}},{headers:{'mcp-session-id':'session064'}});if(body.method==='notifications/initialized')return new Response(null,{status:202});posts++;return Response.json({jsonrpc:'2.0',id:body.id,error:{code:-32042,message:'External review required',data:{elicitations:[{mode:'url',url:'https://secure.example/review',elicitationId:'one',message:'Review external service'}]}}});}});
 const config=structuredClone(defaultConfig);config.hooks=[];config.policy.workspaceRoots=[root];try{let error:unknown;try{await callMcpServer('fixture',{transport:'http',httpMode:'streamable',url:`http://127.0.0.1:${server.port}`},'write',{},true,undefined,config,{urlOrigins:['https://secure.example'],elicitUrl:async()=>{throw new Error('No auto consent');}});}catch(value){error=value;}expect(error).toBeInstanceOf(McpProtocolError);expect((error as McpProtocolError).code).toBe(-32042);expect(posts).toBe(1);}finally{server.stop(true);}
}));
