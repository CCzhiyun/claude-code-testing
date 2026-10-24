import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {defaultConfig,validateConfig} from '../src/config.js';
import {countPinnedTextTokens,countTextTokens,countModelText} from '../src/textTokenizer.js';
import {estimateContextInput,conversationBudget,contextPressure,measureContext} from '../src/contextBudget.js';
import {displayAssistantMessage} from '../src/messageDisplay.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
const require=createRequire(import.meta.url);
async function fixture(action:(root:string,c:typeof defaultConfig)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-display068-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const c=structuredClone(defaultConfig);c.hooks=[];c.policy.workspaceRoots=[root];try{await action(root,c);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
test('line display preserves CRLF and stable message identity; canonical text remains unchanged',()=>fixture(async(root,c)=>{
 const script=join(root,'hook.cjs'),log=join(root,'log');await writeFile(script,`let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const p=JSON.parse(s);require('fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(p)+'\\n');console.log(JSON.stringify({hookSpecificOutput:{displayContent:p.delta.toUpperCase()}}))})`);
 c.hooks=[{event:'MessageDisplay',command:`node "${script}"`}];c.messageDisplay={mode:'lines',linesPerBatch:1,maxBatches:4};const canonical='a\r\nb\nc';expect(await displayAssistantMessage(c,root,'session','agent',canonical)).toBe('A\r\nB\nC');expect(canonical).toBe('a\r\nb\nc');
 const rows=(await readFile(log,'utf8')).trim().split('\n').map((line):any=>JSON.parse(line));expect(rows.map(r=>r.index)).toEqual([0,1,2]);expect(rows.map(r=>r.final)).toEqual([false,false,true]);expect(new Set(rows.map(r=>r.message_id)).size).toBe(1);expect(rows.map(r=>r.delta)).toEqual(['a\r\n','b\n','c']);
}),15000);
test('batch failure rolls back entire display; exceeding cap invokes no hooks',()=>fixture(async(root,c)=>{
 const script=join(root,'fail.cjs'),log=join(root,'log');await writeFile(script,`let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{let p=JSON.parse(s);require('fs').appendFileSync(${JSON.stringify(log)},'x');if(p.index===1)process.exit(2);console.log(JSON.stringify({hookSpecificOutput:{displayContent:'REPLACED'}}))})`);
 c.hooks=[{event:'MessageDisplay',command:`node "${script}"`}];c.messageDisplay={mode:'lines',maxBatches:3};expect(await displayAssistantMessage(c,root,'s','a','a\nb\nc')).toBe('a\nb\nc');expect(await readFile(log,'utf8')).toBe('xx');c.messageDisplay.maxBatches=1;expect(await displayAssistantMessage(c,root,'s','a','a\nb')).toBe('a\nb');expect(await readFile(log,'utf8')).toBe('xx');c.messageDisplay.linesPerBatch=0;expect(()=>validateConfig(c)).toThrow('messageDisplay');
}),15000);
test('pinned private vocabulary matches explicit BPE and rejects changed bytes even after cache hit',()=>fixture(async(root,c)=>{
 const ranks=require('js-tiktoken/ranks/cl100k_base'),bytes=JSON.stringify({bpe_ranks:ranks.bpe_ranks,special_tokens:{}}),file=join(root,'vocab.json');await writeFile(file,bytes);const value={file,sha256:createHash('sha256').update(bytes).digest('hex'),patternEncoding:'cl100k_base' as const};c.model.tokenizerVocabulary=value;validateConfig(c);
 for(const text of ['Hello 你好','a\n b','🧪 跨进程 agent'])expect(countModelText(c.model,text)).toBe(countTextTokens(text,'cl100k_base'));
 await writeFile(file,bytes.replace('IQ==','IA=='));expect(()=>countPinnedTextTokens('Hello 你好',value)).toThrow('digest');
}));
test('private vocabulary refuses incomplete bytes, arbitrary regex and unpinned paths',()=>fixture(async(root,c)=>{
 const file=join(root,'bad.json');for(const payload of [{bpe_ranks:'! 0 YQ=='},{bpe_ranks:'! 0 YQ==',pat_str:'(a+)+$'}]){const bytes=JSON.stringify(payload);await writeFile(file,bytes);expect(()=>countPinnedTextTokens('a',{file,sha256:createHash('sha256').update(bytes).digest('hex'),patternEncoding:'o200k_base'})).toThrow();}
 c.model.tokenizerVocabulary={file:'relative.json',sha256:'0'.repeat(64),patternEncoding:'cl100k_base'};expect(()=>validateConfig(c)).toThrow('tokenizerVocabulary');
}));
test('configured framing changes pressure and compression budget, without touching messages',()=>{
 const model=structuredClone(defaultConfig.model);model.maxContextTokens=10000;model.maxOutputTokens=100;const messages=[{role:'user' as const,content:'keep this turn'}],tools=[{name:'read',description:'fixture',input_schema:{type:'object'}}];const before=estimateContextInput('sys',messages,tools,model),budget=conversationBudget(model,'sys',tools);
 model.contextFraming={baseTokens:9000,perMessageTokens:50,perToolTokens:10};expect(estimateContextInput('sys',messages,tools,model)-before).toBe(9060);expect(budget-conversationBudget(model,'sys',tools)).toBe(Math.min(9010,budget));const snap=measureContext(model,'sys',messages,tools);expect(snap.framingTokens).toBe(9060);expect(contextPressure(snap).compact).toBe(true);expect(messages[0]!.content).toBe('keep this turn');
 model.contextFraming.perToolTokens=-1;expect(()=>measureContext(model,'sys',messages,tools)).toThrow('contextFraming');
});
