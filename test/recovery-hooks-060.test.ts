import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {defaultConfig} from '../src/config.js';
import {createSession,saveSession,loadSession} from '../src/sessions.js';
import {executeTool} from '../src/tooling.js';
import {beginToolOperation,finishToolOperation,listOperations,resolveOperation,queryOperation,compensateOperation} from '../src/operationRecovery.js';
import {modelBoundaryFailure,ModelBoundaryError,formatErrorDiagnostic} from '../src/modelErrors.js';
import {stopFailurePayload} from '../src/hookFailure.js';
import {startHookFileWatch} from '../src/hookFileWatch.js';
import {displayAssistantMessage} from '../src/messageDisplay.js';
import {nativeSchedulerDefinitions,nativeRecoveryPreview} from '../src/nativeSchedulers.js';
import {spawnAgent} from '../src/agent.js';
import {writeJson} from '../src/storage.js';
import {runtimeHistory,queueRuntimeHistory,flushRuntimeHistory} from '../src/runtimeHistory.js';
import {publishRuntimeEvent} from '../src/runtimeEvents.js';
import {sessionHistory} from '../src/sessionHistoryView.js';
import {validateOperationRecovery} from '../src/operationRecoveryConfig.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import type {ToolContext} from '../src/types.js';

async function fixture(action:(root:string,config:typeof defaultConfig,ctx:ToolContext)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-recovery-060-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const config=structuredClone(defaultConfig);config.marketplaceEnabled=false;config.disableBundledSkills=true;config.hooks=[];config.policy.workspaceRoots=[root];const s=await createSession('operation',root),ctx:ToolContext={cwd:root,config,sessionId:s.id,agentId:'agent_1111111111111111',operationId:'stable_call',depth:0};
 try{await action(root,config,ctx);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
const hook=join(import.meta.dir,'lifecycle-057-fixture.cjs');
test('write-ahead operation claims reject duplicate/incompatible calls and require CAS manual reconciliation',()=>fixture(async(root,config,ctx)=>{
 const op=await beginToolOperation(ctx,'git_push',{remote:'origin'});expect(op!.phase).toBe('claimed');await expect(beginToolOperation(ctx,'git_push',{remote:'origin'})).rejects.toThrow('do not replay');await expect(beginToolOperation(ctx,'git_push',{remote:'other'})).rejects.toThrow('different arguments');
 await expect(resolveOperation(root,op!.id,2,'not_applied','Verified no remote update')).rejects.toThrow('changed');await resolveOperation(root,op!.id,1,'not_applied','Verified no remote update');const retry=await beginToolOperation(ctx,'git_push',{remote:'origin'});expect(retry!.phase).toBe('claimed');await finishToolOperation(ctx,retry,'safe result',true);expect((await listOperations(root))[0]!.phase).toBe('completed');await expect(beginToolOperation(ctx,'git_push',{remote:'origin'})).rejects.toThrow('completed');expect(JSON.stringify(await listOperations(root))).not.toContain('safe result');
}));
test('real MCP connector receives one bound idempotency key, supports status query and explicit single compensation',()=>fixture(async(root,config,ctx)=>{
 const counter=join(root,'counter.json');config.mcpServers.billing={transport:'stdio',command:'node',args:[join(import.meta.dir,'operation-060-fixture.cjs'),counter],operationRecovery:{charge:{idempotencyArgument:'request_id',statusTool:'status',compensateTool:'refund'}}};
 await executeTool('mcp_call',{server:'billing',tool:'charge',arguments:{amount:10}},ctx,async()=> '');let state=JSON.parse(await readFile(counter,'utf8'));expect(state.charges).toBe(1);const [op]=await listOperations(root);expect(state.keys).toEqual([op!.id]);
 await expect(executeTool('mcp_call',{server:'billing',tool:'charge',arguments:{amount:10}},ctx,async()=> '')).rejects.toThrow('do not replay');expect(JSON.parse(await readFile(counter,'utf8')).charges).toBe(1);
 const query=await queryOperation(root,op!.id,config);expect(JSON.stringify(query)).toContain('charges');expect(query.automaticResolution).toBe(false);const done=await compensateOperation(root,op!.id,op!.version,'Human authorized reversing this fixture charge',config,true);expect(done.phase).toBe('compensated');expect(JSON.parse(await readFile(counter,'utf8')).refunds).toBe(1);await expect(compensateOperation(root,op!.id,done.version,'Again',config,true)).rejects.toThrow('completed');
 config.mcpServers.billing.args=[...config.mcpServers.billing.args!,'changed'];await expect(queryOperation(root,op!.id,config)).rejects.toThrow('deployment changed');expect(JSON.parse(await readFile(counter,'utf8')).refunds).toBe(1);
}),20000);
test('actual Git commit recovery queries its receipt and uses a clean exact-HEAD revert, never reset/force-push',()=>fixture(async(root,config,ctx)=>{
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(root,'.gitignore'),'.ccpt/\nhome/\n');await writeFile(join(root,'base.txt'),'before');git('add','.');git('commit','-m','initial');await writeFile(join(root,'base.txt'),'after');
 await executeTool('git_commit',{files:['base.txt'],message:'Operation fixture'},ctx,async()=> '');const [op]=await listOperations(root);expect(op!.gitCommit).toBe(git('rev-parse','HEAD'));expect((await queryOperation(root,op!.id,config)).automaticResolution).toBe(false);
 await writeFile(join(root,'dirty.txt'),'must preserve');await expect(compensateOperation(root,op!.id,op!.version,'Revert exact fixture commit',config,true)).rejects.toThrow('clean worktree');await rm(join(root,'dirty.txt'));
 const undone=await compensateOperation(root,op!.id,op!.version,'Revert exact fixture commit',config,true);expect(undone.phase).toBe('compensated');expect(await readFile(join(root,'base.txt'),'utf8')).toBe('before');expect(git('rev-parse','HEAD')).not.toBe(op!.gitCommit);
}),15000);
test('only model-boundary typed credential/transport errors trigger failure hooks; arbitrary tool text never does',()=>{
 expect(stopFailurePayload(new Error('ECONNRESET from an arbitrary tool'))).toBeUndefined();
 for(const [code,expected] of [['ECONNRESET','network_error'],['CERT_HAS_EXPIRED','tls_error'],['ETIMEDOUT','timeout']]){const error=Object.assign(new Error('Bearer fixture-private-token'),{code});const failure=stopFailurePayload(modelBoundaryFailure(error,'transport'));expect(failure!.error).toBe(expected);expect(failure!.error_details).not.toContain('fixture-private-token');}
 expect(stopFailurePayload(modelBoundaryFailure(new Error('credential unavailable'),'credential'))!.error).toBe('authentication_failed');expect(stopFailurePayload(new ModelBoundaryError('cancelled','cancelled'))).toBeUndefined();
 const diagnostic=new Error('invalid_schema param=tools request-id=fixture-060');diagnostic.stack='Error\n    at runtimeFixture';expect(formatErrorDiagnostic(diagnostic)).toContain('invalid_schema param=tools request-id=fixture-060');
});

test('recovery protocol config rejects missing/unsafe fields before contacting a connector',()=>{
 for(const value of [null,[],{charge:{}},{charge:{idempotencyArgument:'request_id'}},{charge:{idempotencyArgument:'__proto__',statusTool:'status'}},{charge:{idempotencyArgument:'request_id',statusTool:'status',shell:'untrusted'}}])expect(()=>validateOperationRecovery(value)).toThrow('Invalid MCP');
 expect(()=>validateOperationRecovery({charge:{idempotencyArgument:'request_id',statusTool:'status',compensateTool:'refund'}})).not.toThrow();
});

test('FileChanged literal filename alternatives match actual built-in writes with reference payload aliases',()=>fixture(async(root,config,ctx)=>{
 const log=join(root,'filename-events.jsonl');config.hooks=[{event:'FileChanged',matcher:'target.txt|other.txt',command:`node "${hook}" ok "${log}"`}];await executeTool('write_file',{path:'target.txt',content:'not in hook payload'},ctx,async()=> '');const row=JSON.parse((await readFile(log,'utf8')).trim());expect(row.file_path).toBe(join(root,'target.txt'));expect(row.event).toBe('add');expect(JSON.stringify(row)).not.toContain('not in hook payload');
}));
test('MessageDisplay can replace only surface text and cannot block or modify canonical text',()=>fixture(async(root,config,ctx)=>{
 const script=join(root,'display.cjs');await writeFile(script,'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({continue:false,hookSpecificOutput:{displayContent:"SURFACE_ONLY"}})));');config.hooks=[{event:'MessageDisplay',matcher:'does-not-match',command:`node "${script}"`}];
 const session=await loadSession(ctx.sessionId);session.messages=[{role:'assistant',content:'CANONICAL_TEXT'}];await saveSession(session);expect(await displayAssistantMessage(config,root,ctx.sessionId,ctx.agentId,'CANONICAL_TEXT')).toBe('SURFACE_ONLY');expect((await loadSession(ctx.sessionId)).messages[0]!.content).toBe('CANONICAL_TEXT');config.hooks=[{event:'MessageDisplay',command:`node "${hook}" fail "${join(root,'display-errors.jsonl')}"`}];expect(await displayAssistantMessage(config,root,ctx.sessionId,ctx.agentId,'CANONICAL_TEXT')).toBe('CANONICAL_TEXT');
}));
test('filesystem FileChanged watches external writes without reading contents and reports add/change/unlink',()=>fixture(async(root,config,ctx)=>{
 const log=join(root,'file-events.jsonl');config.hooks=[{event:'FileChanged',matcher:'watched.txt',command:`node "${hook}" ok "${log}"`}];const stop=startHookFileWatch(config,root,{sessionId:ctx.sessionId},{intervalMs:100});
 const until=async(count:number)=>{const end=Date.now()+5000;while(Date.now()<end){try{if((await readFile(log,'utf8')).trim().split('\n').length>=count)return;}catch{}await Bun.sleep(30);}throw new Error('File hook deadline');};
 try{await Bun.sleep(150);await writeFile(join(root,'watched.txt'),'PRIVATE_CONTENT');await until(1);await writeFile(join(root,'watched.txt'),'PRIVATE_CONTENT_CHANGED');await until(2);await rm(join(root,'watched.txt'));await until(3);const text=await readFile(log,'utf8'),rows=text.trim().split('\n').map(line=>JSON.parse(line));expect(rows.map(row=>row.event)).toEqual(['add','change','unlink']);expect(rows.every(row=>row.source==='filesystem-watch')).toBe(true);expect(text).not.toContain('PRIVATE_CONTENT');}finally{stop();}
}),15000);
test('change_directory updates only this Agent, triggers CwdChanged and preserves the original workspace/session',()=>fixture(async(root,config,ctx)=>{
 const sub=join(root,'sub');await mkdir(sub);await writeFile(join(sub,'fixture.txt'),'SUBDIRECTORY_RESULT');const log=join(root,'cwd.jsonl'),requests:any[]=[],server=Bun.serve({port:0,async fetch(req){requests.push(await req.json());const call=requests.length===1?{name:'change_directory',arguments:'{"path":"sub"}'}:requests.length===2?{name:'read_file',arguments:'{"path":"fixture.txt"}'}:undefined;return Response.json({choices:[{message:call?{tool_calls:[{id:`call_${requests.length}`,type:'function',function:call}]}:{content:'DONE'},finish_reason:call?'tool_calls':'stop'}]});}});
 config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/chat/completions`;config.model.apiKeyEnv='';config.hooks=[{event:'CwdChanged',command:`node "${hook}" ok "${log}"`}];await writeJson(join(root,'.ccpt/settings.json'),config);
 try{const agent=await spawnAgent({cwd:root,config,goal:'Change to sub and read fixture.txt',background:false,isolation:'none',allowedTools:['change_directory','read_file']});expect(agent.status).toBe('completed');expect(agent.cwd).toBe(root);expect(agent.runtimeCwd).toBe(sub);expect(JSON.stringify(requests[2])).toContain('SUBDIRECTORY_RESULT');const row=JSON.parse((await readFile(log,'utf8')).trim());expect(row.old_cwd).toBe(root);expect(row.new_cwd).toBe(sub);expect((await loadSession(agent.sessionId)).cwd).toBe(root);}finally{server.stop(true);}
}),20000);
test('nonce-bound native recovery accepts partial owned definitions and rejects changed/legacy/foreign files',()=>{
 const job={version:1 as const,id:'scheduler_1111111111111111',cwd:'/home/fixture/project',home:'/home/fixture/state',runtime:'/usr/bin/node',entry:'/home/fixture/cli.js',minutes:5,repairCorrupt:false,enabled:true,platform:'linux' as const},nonce='1'.repeat(32),defs=nativeSchedulerDefinitions(job,'linux'),files=Object.fromEntries(Object.entries(defs).map(([name,text],i)=>[name,i===0?`# CCPT transaction ${nonce}\n${text}`:null]));
 const receipt={format:2,nonce,phase:'interrupted',platform:'linux'},preview=nativeRecoveryPreview(job,receipt,files);expect(preview.existing).toHaveLength(1);expect(preview.missing).toHaveLength(1);expect(preview.automaticReplay).toBe(false);expect(()=>nativeRecoveryPreview(job,{phase:'interrupted'},files)).toThrow('ownership');const changed={...files,[preview.existing[0]!]:defs[preview.existing[0]!]!};expect(()=>nativeRecoveryPreview(job,receipt,changed)).toThrow('foreign or changed');
});

test('runtime text requires explicit capture and explicit read; redaction happens before persistence and excludes reasoning',()=>fixture(async(root,config,ctx)=>{
 const context={agentId:ctx.agentId,sessionId:ctx.sessionId},secret='literal-credential-fixture-060';
 queueRuntimeHistory(publishRuntimeEvent({...context,type:'tool_started',turn:0,name:'read_file',input:{path:'DEFAULT_PRIVATE'}}));
 queueRuntimeHistory(publishRuntimeEvent({...context,type:'assistant_message',turn:0,text:`line one\nline two ${secret} Bearer should-never-persist`}),{mode:'redacted',secrets:[secret],maxTextChars:1000});
 queueRuntimeHistory(publishRuntimeEvent({...context,type:'thinking_delta',turn:0,delta:'NEVER_STORE_THINKING'}),{mode:'redacted'});
 queueRuntimeHistory(publishRuntimeEvent({...context,type:'tool_completed',turn:0,name:'read_file',output:'x'.repeat(200),isError:false,durationMs:2}),{mode:'redacted',maxTextChars:20});
 await flushRuntimeHistory();const metadata=await runtimeHistory(root,ctx.sessionId),rich=await runtimeHistory(root,ctx.sessionId,undefined,100,{includeText:true});expect(metadata.metadataOnly).toBe(true);expect(JSON.stringify(metadata)).not.toContain('line one');expect(rich.items[1]!.text).toContain('line one\nline two');expect(rich.items[2]!.text).toHaveLength(20);expect(rich.items[2]!.truncated).toBe(true);
 const bytes=await readFile(join(process.env.CCPT_HOME!,'runtime-history',ctx.sessionId+'.json'),'utf8');for(const value of [secret,'should-never-persist','DEFAULT_PRIVATE','NEVER_STORE_THINKING'])expect(bytes).not.toContain(value);
 const session=await loadSession(ctx.sessionId);session.messages=[{role:'assistant',content:'```ts\n'+ 'x'.repeat(3000)+'\n```'}];await saveSession(session);const preview=await sessionHistory(root,ctx.sessionId,{includeText:true,textLimit:64000});expect(preview.items[0]!.truncated).toBe(false);expect(preview.items[0]!.text).toContain('```ts\n');await expect(sessionHistory(root,ctx.sessionId,{textLimit:64001})).rejects.toThrow('textLimit');
}));

test('authority changes during a model request stop every subsequent tool/model action and preserve the conversation',()=>fixture(async(root,config,ctx)=>{
 let requests=0;const file=join(root,'.ccpt/settings.json'),server=Bun.serve({port:0,async fetch(){requests++;await writeJson(file,{...config,policy:{...config.policy,allowNetwork:false}});return Response.json({choices:[{message:{tool_calls:[{id:'blocked_call',type:'function',function:{name:'write_file',arguments:'{"path":"must-not-exist.txt","content":"no"}'}}]},finish_reason:'tool_calls'}]});}});
 config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/chat/completions`;config.model.apiKeyEnv='';await writeJson(file,config);
 try{const agent=await spawnAgent({cwd:root,config,goal:'Write the requested implementation.',isolation:'none',background:false,allowedTools:['write_file']});expect(agent.status).toBe('waiting_for_input');expect(agent.result).toContain('authority changed');expect(requests).toBe(1);await expect(readFile(join(root,'must-not-exist.txt'))).rejects.toThrow();expect((await loadSession(agent.sessionId)).messages.length).toBeGreaterThanOrEqual(3);}finally{server.stop(true);}
}),20000);

test('actual Agent MessageDisplay replacement changes surface result but not its canonical model/session result',()=>fixture(async(root,config)=>{
 const script=join(root,'display-agent.cjs');await writeFile(script,'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({hookSpecificOutput:{displayContent:"DISPLAYED_RESULT"}})));');
 const server=Bun.serve({port:0,fetch(){return Response.json({choices:[{message:{content:'CANONICAL_RESULT'},finish_reason:'stop'}]});}});
 config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/chat/completions`;config.model.apiKeyEnv='';config.hooks=[{event:'MessageDisplay',command:`node "${script}"`}];config.runtimeHistory={mode:'redacted'};await writeJson(join(root,'.ccpt/settings.json'),config);
 try{const events:any[]=[],agent=await spawnAgent({cwd:root,config,goal:'Explain a technical concept.',isolation:'none',background:false,onEvent:event=>events.push(event)});expect(agent.status).toBe('completed');expect(agent.result).toBe('CANONICAL_RESULT');expect(agent.displayResult).toBe('DISPLAYED_RESULT');expect(JSON.stringify((await loadSession(agent.sessionId)).messages)).toContain('CANONICAL_RESULT');expect(JSON.stringify((await loadSession(agent.sessionId)).messages)).not.toContain('DISPLAYED_RESULT');expect(events.some(event=>event.type==='display_message'&&event.text==='DISPLAYED_RESULT')).toBe(true);const history=await runtimeHistory(root,agent.sessionId,undefined,100,{includeText:true});expect(history.items.some(row=>row.type==='assistant_message'&&row.text==='CANONICAL_RESULT')).toBe(true);}finally{server.stop(true);}
}),20000);
