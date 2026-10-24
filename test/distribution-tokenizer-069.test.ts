import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createRequire} from 'node:module';
import {defaultConfig,validateConfig} from '../src/config.js';
import {countPinnedTextTokens} from '../src/textTokenizer.js';
import {bindLauncher} from '../src/launcherBinding.js';
import {signPlugin} from '../src/pluginSignatures.js';
import {stagePluginSet,inspectPluginSet,activatePluginSet} from '../src/pluginSets.js';
import {previewPluginRollout,preparePluginRollout,applyPluginRollout,reconcilePluginRollout,checkPluginRollouts} from '../src/pluginRollout.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {writeJson} from '../src/storage.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import {listProjectNotifications} from '../src/notifications.js';
const require=createRequire(import.meta.url),hash=(b:string)=>createHash('sha256').update(b).digest('hex');
async function fixture(action:(root:string,c:typeof defaultConfig)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-dist069-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const c=structuredClone(defaultConfig);c.hooks=[];c.policy.workspaceRoots=[root];try{await action(root,c)}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root)}}
test('private vocabulary supports explicit special tokens and custom regex in a credential-free bounded child',()=>fixture(async(root,c)=>{
 const ranks=require('js-tiktoken/ranks/cl100k_base'),file=join(root,'vocab.json');const body=JSON.stringify({bpe_ranks:ranks.bpe_ranks,special_tokens:{'<private>':200000},pat_str:ranks.pat_str});await writeFile(file,body);const value={file,sha256:hash(body),patternEncoding:'custom' as const,specialTokenMode:'allowed' as const,timeoutMs:5000};c.model.tokenizerVocabulary=value;validateConfig(c);expect(countPinnedTextTokens('<private>',value)).toBe(1);expect(countPinnedTextTokens('<private>',{...value,specialTokenMode:'ordinary'})).toBeGreaterThan(1);expect(countPinnedTextTokens('Hello 你好',value)).toBe(4);
 const bad=JSON.stringify({bpe_ranks:ranks.bpe_ranks,special_tokens:{bad:0},pat_str:ranks.pat_str});await writeFile(file,bad);expect(()=>countPinnedTextTokens('test',{...value,sha256:hash(bad)})).toThrow('overlapping');
}));
test('malicious custom regex times out without terminating conversation or exposing child environment',()=>fixture(async(root)=>{
 const ranks=require('js-tiktoken/ranks/cl100k_base'),file=join(root,'evil.json'),body=JSON.stringify({bpe_ranks:ranks.bpe_ranks,special_tokens:{},pat_str:'(a+)+$'});await writeFile(file,body);const start=Date.now();expect(()=>countPinnedTextTokens('a'.repeat(5000)+'!',{file,sha256:hash(body),patternEncoding:'custom',timeoutMs:100})).toThrow('timeout');expect(Date.now()-start).toBeLessThan(3000);
}));
test('launcher binds recursive declared helper/config/known_hosts files; add/remove/edit invalidates deployment',()=>fixture(async(root)=>{
 const exe=join(root,'launcher.bin'),dir=join(root,'dependencies');await writeFile(exe,'launcher');await mkdir(dir);await mkdir(join(dir,'nested'));await writeFile(join(dir,'known_hosts'),'pinned-host-key');await writeFile(join(dir,'nested','helper.js'),'helper');const first=await bindLauncher(exe,[dir]);expect(first.files).toHaveLength(2);await writeFile(join(dir,'known_hosts'),'changed-host-key');expect(await bindLauncher(exe,[dir])).not.toEqual(first);await writeFile(join(dir,'known_hosts'),'pinned-host-key');expect(await bindLauncher(exe,[dir])).toEqual(first);await writeFile(join(dir,'new-policy.json'),'{}');expect((await bindLauncher(exe,[dir])).files).toHaveLength(3);await expect(bindLauncher(exe,[dir,join(dir,'nested')])).rejects.toThrow('Overlapping');
}));
test('network/device tokenizer and launcher paths are rejected before filesystem authentication',()=>fixture(async(_root,c)=>{
 c.model.tokenizerVocabulary={file:'\\\\example.invalid\\share\\vocab.json',sha256:'0'.repeat(64),patternEncoding:'cl100k_base'};expect(()=>validateConfig(c)).toThrow('tokenizerVocabulary');await expect(bindLauncher('\\\\example.invalid\\share\\launcher')).rejects.toThrow('local paths');
}));
async function signed(root:string,c:typeof defaultConfig){const keys=generateKeyPairSync('ed25519'),key=join(root,'publisher.pem');await writeFile(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));c.pluginTrustKeys={team:keys.publicKey.export({type:'spki',format:'pem'}).toString()};c.requirePluginSignatures=true;c.pluginRollout={allowedVersions:{team:['1.0.0','2.0.0']},checkOnStartup:true,maxApprovalMinutes:30};await writeJson(join(root,'.ccpt/settings.json'),c);await trustWorkspace(root);return async(version:string)=>{const dir=join(root,'source-'+version);await mkdir(dir);await writeJson(join(dir,'plugin.json'),{schemaVersion:1,name:'team',version});await signPlugin(dir,key,'team');return stagePluginSet(root,[dir],true)};}
test('signed channel rollout has CAS, expiry, restart reconciliation and deduplicated local review notifications',()=>fixture(async(root,c)=>{
 const publish=await signed(root,c),one=await publish('1.0.0'),review=await previewPluginRollout(root,one.id),receipt=await preparePluginRollout(root,one.id,review.reviewDigest,true);expect((await checkPluginRollouts(root)).checked).toBe(1);await checkPluginRollouts(root);expect((await listProjectNotifications(root)).items).toHaveLength(1);
 await expect(activatePluginSet(root,one.id,0,true)).rejects.toThrow('reviewed rollout');
 const results=await Promise.allSettled([applyPluginRollout(root,receipt.id,1,true),applyPluginRollout(root,receipt.id,1,true)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await inspectPluginSet(root)).current!.generation).toBe(one.id);await expect(applyPluginRollout(root,receipt.id,1,true)).rejects.toThrow('Stale');
 // Simulate power loss after active-pointer CAS but before completion receipt.
 const path=join(root,'.ccpt/plugin-rollouts',receipt.id+'.json'),state=JSON.parse(await readFile(path,'utf8'));state.phase='applying';await writeJson(path,state);expect((await reconcilePluginRollout(root,receipt.id,state.version,true)).phase).toBe('completed');
 const two=await publish('2.0.0'),next=await previewPluginRollout(root,two.id),r=await preparePluginRollout(root,two.id,next.reviewDigest,true);await writeJson(join(root,'.ccpt/plugin-rollouts',r.id+'.json'),{...r,expiresAt:'2020-01-01T00:00:00.000Z'});await expect(applyPluginRollout(root,r.id,1,true)).rejects.toThrow('expired');expect((await inspectPluginSet(root)).current!.generation).toBe(one.id);
}),20000);
test('rollout rejects out-of-channel versions and invalid policy rather than relaxing signatures',()=>fixture(async(root,c)=>{
 const publish=await signed(root,c),bad=await publish('3.0.0');await expect(previewPluginRollout(root,bad.id)).rejects.toThrow('outside');c.pluginRollout!.allowedVersions.team=['*'];expect(()=>validateConfig(c)).toThrow('pluginRollout');
}));
