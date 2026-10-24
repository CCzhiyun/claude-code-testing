import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {defaultConfig,validateConfig} from '../src/config.js';
import {readSpending,withSpendScope,withModelBudget} from '../src/spending.js';
import {withEphemeralSession} from '../src/ephemeralSession.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
async function fixture(action:(root:string,c:typeof defaultConfig)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-account068-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const c=structuredClone(defaultConfig);c.hooks=[];c.model.maxContextTokens=100;c.model.maxOutputTokens=10;c.spending={account:'team',maxRequests:1,maxTokens:1000};try{await action(root,c);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
const reply=async()=>({content:[],usage:{inputTokens:20,outputTokens:5}});
test('named account charges session AND account; another session cannot evade it',()=>fixture(async(_root,c)=>{
 await withSpendScope('session-a',()=>withModelBudget(c,reply));expect((await readSpending('session-a')).tokens).toBe(25);expect((await readSpending('account:team')).tokens).toBe(25);
 await expect(withSpendScope('session-b',()=>withModelBudget(c,reply))).rejects.toThrow('budget');expect((await readSpending('session-b')).requests).toBe(0);
}));
test('two independent CLI processes race on the same local account',()=>fixture(async(_root,c)=>{
 const program=`import {withModelBudget} from './src/spending.ts';const c=${JSON.stringify(c)};try{await withModelBudget(c,async()=>({content:[],usage:{inputTokens:20,outputTokens:5}}));console.log('FUNDED')}catch(e){console.log('BLOCKED');process.exitCode=2}`;
 const children=Array.from({length:2},()=>Bun.spawn([process.execPath,'-e',program],{cwd:process.cwd(),env:{...process.env},stdout:'pipe',stderr:'pipe'}));
 const rows=await Promise.all(children.map(async child=>({code:await child.exited,out:await new Response(child.stdout).text(),err:await new Response(child.stderr).text()})));
 expect(rows.filter(row=>row.code===0)).toHaveLength(1);expect(rows.filter(row=>row.code===2)).toHaveLength(1);expect((await readSpending('account:team')).requests).toBe(1);
}),20000);
test('ephemeral print cannot reset a named account when it changes CCPT_HOME',()=>fixture(async(_root,c)=>{
 await withEphemeralSession(c,e=>withModelBudget(e,reply));expect((await readSpending('account:team')).requests).toBe(1);await expect(withModelBudget(c,reply)).rejects.toThrow('budget');
}));
test('unknown cancellation and malformed usage retain reservations in both ledgers',()=>fixture(async(_root,c)=>{
 await expect(withSpendScope('cancelled',()=>withModelBudget(c,async()=>{throw new Error('cancelled')}))).rejects.toThrow('cancelled');for(const scope of ['cancelled','account:team'])expect(Object.keys((await readSpending(scope)).reservations)).toHaveLength(1);
 c.spending!.account='other';await expect(withSpendScope('invalid',()=>withModelBudget(c,async()=>({content:[],usage:{inputTokens:-1,outputTokens:2}})))).rejects.toThrow('Invalid provider usage');expect(Object.keys((await readSpending('account:other')).reservations)).toHaveLength(1);
}));
test('corrupt shared state fails closed before spending or mutating session counters',()=>fixture(async(_root,c)=>{
 const path=join(process.env.CCPT_HOME!,'budgets',createHash('sha256').update('account:team').digest('hex')+'.json');await mkdir(join(path,'..'),{recursive:true});await writeFile(path,JSON.stringify({scope:'account:team',requests:-1,tokens:0,costUsd:0,reservations:{}}));
 let calls=0;await expect(withSpendScope('safe',()=>withModelBudget(c,async()=>{calls++;return reply()}))).rejects.toThrow('Corrupt');expect(calls).toBe(0);expect((await readSpending('safe')).requests).toBe(0);
 c.spending!.account='../escape';expect(()=>validateConfig(c)).toThrow('spending.account');
}));
test('safe-integer or floating-point counter overflow cannot send a model request',()=>fixture(async(_root,c)=>{
 const path=join(process.env.CCPT_HOME!,'budgets',createHash('sha256').update('account:team').digest('hex')+'.json');await mkdir(join(path,'..'),{recursive:true});c.spending={account:'team'};let calls=0;
 for(const row of [{scope:'account:team',requests:Number.MAX_SAFE_INTEGER,tokens:0,costUsd:0,reservations:{}},{scope:'account:team',requests:0,tokens:Number.MAX_SAFE_INTEGER,costUsd:0,reservations:{}}]){
  await writeFile(path,JSON.stringify(row));await expect(withSpendScope('overflow',()=>withModelBudget(c,async()=>{calls++;return reply()}))).rejects.toThrow('safe bounds');
 }
 expect(calls).toBe(0);expect((await readSpending('overflow')).requests).toBe(0);
}));
