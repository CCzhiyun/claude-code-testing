import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../src/config.js';
import {repositoryContext} from '../src/context.js';
import {engineeringRuleContext} from '../src/scopedRules.js';
import {spawnAgent} from '../src/agent.js';
import {writeJson} from '../src/storage.js';
import type {InstructionSource} from '../src/instructionSources.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
async function fixture(action:(root:string,config:typeof defaultConfig)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-instructions064-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const config=structuredClone(defaultConfig);config.hooks=[];config.policy.workspaceRoots=[root];config.marketplaceEnabled=false;config.disableBundledSkills=true;config.skillsDirectories=[join(root,'.ccpt/skills')];config.agentsDirectories=[join(root,'.ccpt/agents')];try{await mkdir(process.env.CCPT_HOME!);await action(root,config);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
test('repository observer identifies only actually included documents and rules, without sharing their body',()=>fixture(async(root,config)=>{
 await writeFile(join(process.env.CCPT_HOME!,'CLAUDE.md'),'PRIVATE_USER_INSTRUCTIONS');await writeFile(join(root,'CCPT.md'),'PRIVATE_PROJECT_INSTRUCTIONS');await mkdir(join(root,'docs'));await writeFile(join(root,'docs/architecture.md'),'PRIVATE_ARCHITECTURE');await mkdir(join(root,'.ccpt/rules'),{recursive:true});await writeFile(join(root,'.ccpt/rules/base.md'),'PRIVATE_GLOBAL_RULE');await writeFile(join(root,'.ccpt/rules/lazy.md'),'---\npaths: ["src/**"]\n---\nPRIVATE_LAZY_RULE');
 const events:InstructionSource[]=[];const text=await repositoryContext(root,config,80000,async row=>{events.push(row);});expect(text).toContain('PRIVATE_PROJECT_INSTRUCTIONS');expect(text).not.toContain('PRIVATE_LAZY_RULE');expect(events.map(row=>row.source)).toEqual(['user-instructions','engineering-rule:project','project-instructions','architecture-document']);expect(JSON.stringify(events)).not.toContain('PRIVATE_');expect(events.every(row=>/^[a-f0-9]{64}$/.test(row.included_text_digest)&&row.included_characters>0)).toBe(true);
 const tiny:InstructionSource[]=[];await repositoryContext(root,config,1,async row=>{tiny.push(row);});expect(tiny).toHaveLength(1);expect(tiny[0]!.included_characters).toBe(1);
}));
test('file-scoped instruction observations occur once per included rule and exclude skipped/oversized rules',()=>fixture(async(root,config)=>{
 await mkdir(join(root,'.ccpt/rules'),{recursive:true});await writeFile(join(root,'.ccpt/rules/lazy.md'),'---\npaths: ["src/**"]\n---\nLOCAL_LAZY_INSTRUCTION');const loaded=new Set<string>(),events:InstructionSource[]=[];
 const opts={files:['src/example.ts'],loaded,onLoaded:async(row:InstructionSource)=>{events.push(row);}};expect(await engineeringRuleContext(root,config,{...opts,limit:1})).toBe('');expect(events).toHaveLength(0);expect(await engineeringRuleContext(root,config,opts)).toContain('LOCAL_LAZY_INSTRUCTION');expect(events).toHaveLength(1);expect(await engineeringRuleContext(root,config,opts)).toBe('');expect(events).toHaveLength(1);expect(events[0]!.source).toBe('engineering-rule:project');
}));
test('actual Agent emits included sources, observer failure is nonblocking, and greeting does not load instructions',()=>fixture(async(root,config)=>{
 await writeFile(join(root,'CCPT.md'),'PROJECT_SYSTEM_MARKER');const log=join(root,'loaded.jsonl'),hook=join(import.meta.dir,'lifecycle-057-fixture.cjs');
 const bodies:any[]=[];const server=Bun.serve({port:0,async fetch(req){bodies.push(await req.json());return Response.json({choices:[{message:{content:'DONE'},finish_reason:'stop'}]});}});config.model.apiProtocol='chat-completions';config.model.endpointUrl=`http://127.0.0.1:${server.port}/chat/completions`;config.model.apiKeyEnv='';config.hooks=[{event:'InstructionsLoaded',matcher:'project-instructions',command:`node "${hook}" fail "${log}"`}];await writeJson(join(root,'.ccpt/settings.json'),config);
 try{const agent=await spawnAgent({cwd:root,config,goal:'Explain this repository architecture without using tools.',instructions:'APPLICATION_SYSTEM_MARKER',allowedTools:[],background:false,isolation:'none'});expect(agent.status).toBe('completed');expect(JSON.stringify(bodies[0])).toContain('PROJECT_SYSTEM_MARKER');const rows=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(rows).toHaveLength(1);expect(rows[0].source).toBe('project-instructions');expect(rows[0].included_characters).toBe('PROJECT_SYSTEM_MARKER'.length);expect(JSON.stringify(rows)).not.toContain('PROJECT_SYSTEM_MARKER');
 const before=await readFile(log,'utf8');const greeting=await spawnAgent({cwd:root,config,goal:'Hello 你好',allowedTools:[],background:false,isolation:'none'});expect(greeting.status).toBe('completed');expect(await readFile(log,'utf8')).toBe(before);expect(JSON.stringify(bodies[1])).not.toContain('PROJECT_SYSTEM_MARKER');
 }finally{server.stop(true);}
}),20000);
