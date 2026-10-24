import {test,expect} from 'bun:test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaultConfig} from '../src/config.js';
import {normalizeUsage} from '../src/tokenUsage.js';
import {countModelText,countTextTokens,estimateModelOutput} from '../src/textTokenizer.js';
import {createRequire} from 'node:module';
import {summarizeUsage,formatUsageSummary,type UsageRecord} from '../src/usage.js';
import {QueryEngine} from '../src/QueryEngine.js';
import {countProviderInput,withPreparedInputCount} from '../src/inputTokenCounting.js';
import {queryWithContextRecovery} from '../src/contextRecovery.js';
import {measureContext,formatContextSnapshot,contextPressure} from '../src/contextBudget.js';
import {compactSession,fullSessionMessages} from '../src/sessions.js';
import {modelRequestError,ModelRequestError,withModelDiagnosticSecrets} from '../src/modelErrors.js';
import {listModelErrors,recordModelError,modelErrorLogPath} from '../src/modelErrorLog.js';
import {callModel} from '../src/model.js';
import {withModelRetry} from '../src/modelRetry.js';
import {diagnosticBundle} from '../src/diagnosticBundle.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import type {SessionRecord} from '../src/types.js';

async function fixture(action:(root:string,c:typeof defaultConfig)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-071-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'state');
 const c=structuredClone(defaultConfig);c.hooks=[];c.model.apiProtocol='responses';c.model.responsesTransport='native';c.model.apiKeyEnv='';c.model.thinkingEnabled=false;c.model.maxContextTokens=4000;c.model.maxOutputTokens=200;c.modelRetry={maxRetries:0};c.network={allowedHosts:['127.0.0.1'],rejectUnauthorized:true,timeoutMs:3000};
 try{await action(root,c);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
function session(root:string):SessionRecord{return{id:'session_1111111111111111',cwd:root,title:'test',createdAt:'',updatedAt:'',messages:[{role:'user',content:'界'.repeat(6000)}]};}
test('Responses and Chat reasoning is a reported output subset, zero stays known and invalid subset is ignored',()=>{
 for(const [protocol,raw] of [['responses',{input_tokens:100,output_tokens:50,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:30}}],['compatible',{prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:80},completion_tokens_details:{reasoning_tokens:30}}]] as const){
  expect(normalizeUsage(raw,protocol)).toEqual({inputTokens:100,outputTokens:50,cacheReadTokens:80,reasoningTokens:30});
 }
 expect(normalizeUsage({output_tokens:0,output_tokens_details:{reasoning_tokens:0}},'responses')).toEqual({outputTokens:0,reasoningTokens:0});
 expect(normalizeUsage({output_tokens:1,output_tokens_details:{reasoning_tokens:2}},'responses')).toEqual({outputTokens:1});
 const record:UsageRecord={id:'a',sessionId:'s',agentId:'a',model:'m',createdAt:'',inputTokens:100,outputTokens:50,reasoningTokens:30,cacheReadTokens:80,cacheWriteTokens:0,costUsd:0,durationMs:0,toolCalls:0};
 const summary=summarizeUsage([record]);expect(summary.inputTokens+summary.outputTokens).toBe(150);expect(summary.reasoningTokens).toBe(30);expect(formatUsageSummary(summary)).toContain('already in output');expect(formatUsageSummary(summarizeUsage([]))).toContain('unavailable');
});
test('missing usage estimates generated text with configured BPE, not IDs/signatures or opaque metadata',()=>fixture(async(_root,c)=>{
 c.model.tokenizer='o200k_base';const blocks=[{type:'text' as const,text:'Hello 你好',id:'PRIVATE_ID'.repeat(100),signature:'OPAQUE'.repeat(100)}];
 expect(estimateModelOutput(c.model,blocks)).toBe(countModelText(c.model,'Hello 你好'));
 const q=new QueryEngine(c,{now:Date.now,callModel:async()=>({content:blocks})});await q.query('',[],[]);expect(q.metrics.outputTokens).toBe(countModelText(c.model,'Hello 你好'));
}));
test('provider count overrides local overestimate through the actual QueryEngine, while changed inputs cannot reuse it',()=>fixture(async(root,c)=>{
 const server=Bun.serve({port:0,fetch(){return Response.json({object:'response.input_tokens',input_tokens:100});}});
 try{c.model.endpointUrl=`http://127.0.0.1:${server.port}/responses`;c.model.inputTokenCounting={mode:'responses'};let generations=0;
  const q=new QueryEngine(c,{now:Date.now,callModel:async()=>{generations++;return{content:[{type:'text',text:'OK'}]};}}),s=session(root);
  await queryWithContextRecovery({config:c,session:s,system:'sys',tools:[],onPressure:async()=>{},onRecovery:async()=>{},query:stream=>q.query('sys',s.messages,[],stream)});
  expect(generations).toBe(1);expect(q.metrics.estimatedInputTokens).toBe(100);expect(s.archivedMessages).toBeUndefined();
  await expect(q.query('sys',s.messages,[])).rejects.toThrow('input budget');
  const count=await countProviderInput(c,'sys',s.messages,[]);expect(count!.source).toBe('provider');
  if(count?.source==='provider'){
   await expect(withPreparedInputCount(count,()=>q.query('DIFFERENT_SYSTEM',s.messages,[]))).rejects.toThrow('input budget');
   c.model.endpointUrl=`http://127.0.0.1:${server.port}/different/responses`;await expect(withPreparedInputCount(count,()=>q.query('sys',s.messages,[]))).rejects.toThrow('input budget');c.model.endpointUrl=`http://127.0.0.1:${server.port}/responses`;
   c.modelRetry={tokensPerMinute:1000,maxRetries:0};let scheduled=0;
   await withPreparedInputCount(count,()=>withModelRetry(c,'sys',s.messages,[],undefined,async()=>{scheduled++;return{content:[]};}));expect(scheduled).toBe(1);
  }
  expect(generations).toBe(1);
 }finally{server.stop(true);}
}));
test('dense built-in BPE uses the same exact encoding in a bounded subprocess',()=>{
 const require=createRequire(import.meta.url),{Tiktoken}=require('js-tiktoken/lite'),ranks=require('js-tiktoken/ranks/o200k_base'),text='a'.repeat(1100);
 expect(countTextTokens(text,'o200k_base')).toBe(new Tiktoken(ranks).encode(text,[],[]).length);
});
test('Chat greeting succeeds without tools; tools+reasoning fails explicitly and none restores the same route',()=>fixture(async(_root,c)=>{
 const bodies:any[]=[];const server=Bun.serve({port:0,async fetch(r){const body:any=await r.json();bodies.push(body);if(body.tools?.length&&body.reasoning_effort!=='none')return Response.json({error:{message:'Function tools with reasoning_effort are not supported',param:'reasoning_effort'}},{status:400});return Response.json({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:100,completion_tokens:20,completion_tokens_details:{reasoning_tokens:0}}});}});
 try{c.model.apiProtocol='chat-completions';c.model.endpointUrl=`http://127.0.0.1:${server.port}/v1/chat/completions`;c.model.thinkingEnabled=true;c.model.reasoningEffort='high';
  expect((await callModel(c,'',[{role:'user',content:'你好'}],[])).content[0]!.text).toBe('OK');
  const tools=[{name:'echo',description:'',input_schema:{type:'object',properties:{}}}];await expect(callModel(c,'',[],tools,{})).rejects.toThrow('chatToolReasoning="none"');
  c.model.chatToolReasoning='none';expect((await callModel(c,'',[],tools,{})).usage!.reasoningTokens).toBe(0);expect(bodies.at(-1).tools).toHaveLength(1);expect(bodies.at(-1).reasoning_effort).toBe('none');expect(c.model.endpointUrl).toContain('/v1/chat/completions');
 }finally{server.stop(true);}
}));
test('90% warning and >95% compaction include reserves, preserve exact archive/current turn; display identifies counted total',()=>fixture(async(root,c)=>{
 const snapshot=measureContext(c.model,'',[],[]);snapshot.inputSource='provider';snapshot.estimatedInput=3200;expect(contextPressure(snapshot)).toMatchObject({percent:90,warn:true,compact:false});snapshot.estimatedInput=3400;expect(contextPressure(snapshot).compact).toBe(false);snapshot.estimatedInput=3401;expect(contextPressure(snapshot).compact).toBe(true);expect(formatContextSnapshot(snapshot)).toContain('Provider-counted input total: 3401');expect(formatContextSnapshot(snapshot)).toContain('reserves are capacity');
 c.model.tokenizer='o200k_base';const s=session(root);s.messages=[];for(let i=0;i<10;i++)s.messages.push({role:'user',content:'你好约束测试'.repeat(40)},{role:'assistant',content:'done'});s.messages.push({role:'user',content:'CURRENT_TURN'});const original=structuredClone(s.messages);compactSession(s,600,{force:true,model:c.model});expect(s.archivedMessages!.length).toBeGreaterThan(0);expect(fullSessionMessages(s)).toEqual(original);expect(s.messages.at(-1)!.content).toBe('CURRENT_TURN');
}));
test('nested/string gateway errors retain sanitized code/param/message/request-id and actionable compatibility hint',()=>{
 const error=withModelDiagnosticSecrets(['PRIVATE_CREDENTIAL'],()=>modelRequestError(400,{error:JSON.stringify({error:{message:'Function tools with reasoning_effort are not supported. PRIVATE_CREDENTIAL',code:'invalid_request_error',param:'reasoning_effort'}})},{'APIM-Request-ID':'req-071'})) as ModelRequestError;
 expect(error.diagnostics).toMatchObject({code:'invalid_request_error',param:'reasoning_effort',requestId:'req-071'});expect(error.message).toContain('chatToolReasoning="none"');expect(error.message).not.toContain('PRIVATE_CREDENTIAL');
 expect((modelRequestError(500,{detail:'gateway detail'}) as ModelRequestError).diagnostics!.message).toBe('gateway detail');
});
test('final transport failure writes one bounded redacted diagnostic; export includes it, ephemeral mode writes nothing',()=>fixture(async(_root,c)=>{
 let calls=0;const server=Bun.serve({port:0,fetch(){calls++;return Response.json({error:{message:'Function tools with reasoning_effort are not supported Bearer private-value',param:'reasoning_effort',code:'invalid_request_error'}},{status:400,headers:{'x-request-id':'req-one'}});}});
 try{c.model.endpointUrl=`http://127.0.0.1:${server.port}/responses?api-version=test`;await expect(callModel(c,'NEVER_PERSIST_PROMPT',[],[])).rejects.toThrow('doctor errors');expect(calls).toBe(1);
  const records=await listModelErrors();expect(records).toHaveLength(1);expect(records[0]!.requestId).toBe('req-one');expect(records[0]!.status).toBe(400);expect(records[0]!.endpoint).not.toContain('?');
  const bytes=await readFile(modelErrorLogPath(),'utf8');expect(bytes).not.toContain('NEVER_PERSIST_PROMPT');expect(bytes).not.toContain('private-value');expect(JSON.stringify(await diagnosticBundle(c,'test'))).toContain('req-one');
  c.ephemeralSession=true;await expect(callModel(c,'',[],[])).rejects.toThrow('400');expect(await listModelErrors()).toHaveLength(1);
  c.ephemeralSession=false;await writeFile(modelErrorLogPath(),'corrupt-original');await expect(callModel(c,'',[],[])).rejects.toThrow('400');expect(await readFile(modelErrorLogPath(),'utf8')).toBe('corrupt-original');
 }finally{server.stop(true);}
}));
test('error log keeps at most 100 entries, preserves final error identity, and validates limits',()=>fixture(async(_root,c)=>{
 c.model.endpointUrl='http://127.0.0.1/responses';for(let i=0;i<102;i++)await recordModelError(c,3,modelRequestError(500,{error:`failure ${i}`}));
 const entries=await listModelErrors(100);expect(entries).toHaveLength(100);expect(entries[0]!.message).toContain('failure 101');expect(entries.at(-1)!.message).toContain('failure 2');await expect(listModelErrors(101)).rejects.toThrow('1–100');
}));
