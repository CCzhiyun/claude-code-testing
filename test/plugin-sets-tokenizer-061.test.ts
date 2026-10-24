import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {defaultConfig,loadConfig,validateConfig} from '../src/config.js';
import {writeJson} from '../src/storage.js';
import {trustWorkspace,revokeWorkspaceTrust} from '../src/workspaceTrust.js';
import {stagePluginSet,activatePluginSet,inspectPluginSet,pluginSetDirectories} from '../src/pluginSets.js';
import {signPlugin} from '../src/pluginSignatures.js';
import {discoverPlugins} from '../src/plugins.js';
import {countTextTokens,countModelText} from '../src/textTokenizer.js';
import {estimateTokens} from '../src/tokenUsage.js';
import {contextMessages,estimateContextInput,measureContext,formatContextSnapshot} from '../src/contextBudget.js';
import {extensionAuthorityWatchPaths} from '../src/localStateWatch.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';

async function fixture(action:(root:string,settings:Record<string,unknown>,sources:(version:string)=>Promise<string[]>)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-pluginset-061-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');
 try{
  const keys=generateKeyPairSync('ed25519'),key=join(root,'publisher.pem');await writeFile(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));
  const settings={marketplaceEnabled:false,disableBundledSkills:true,requirePluginSignatures:true,pluginTrustKeys:{publisher:keys.publicKey.export({type:'spki',format:'pem'}).toString()},policy:{workspaceRoots:[root]}};
  await writeJson(join(root,'.ccpt/settings.json'),settings);await trustWorkspace(root);
  const sources=async(version:string)=>Promise.all(['alpha','beta'].map(async name=>{const path=join(root,'sources',version,name);await mkdir(path,{recursive:true});await writeJson(join(path,'plugin.json'),{name,version,contributes:{commands:[{name:'check-'+name,description:name,prompt:version}]}});await signPlugin(path,key,'publisher');return path;}));
  await action(root,settings,sources);
 }finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}

test('plugin generations switch two signed artifacts and their receipts with one versioned pointer',()=>fixture(async(root,settings,sources)=>{
 const first=await stagePluginSet(root,await sources('1.0.0'),true);expect(first.activated).toBe(false);expect((await inspectPluginSet(root)).current).toBeNull();
 await mkdir(join(root,'.ccpt/plugin-sets/.pending-interrupted'),{recursive:true});
 const one=await activatePluginSet(root,first.id,0,true);expect(one.version).toBe(1);
 await writeJson(join(root,'.ccpt/settings.json'),{...settings,usePluginSets:true});
 const check=async(version:string)=>{const config=await loadConfig(root);config.pluginDirectories=await pluginSetDirectories(root,config);expect(config.pluginDirectories).not.toContain(join(root,'.ccpt/plugins'));const found=await discoverPlugins(config);expect(found.diagnostics).toEqual([]);expect(found.plugins.map(p=>p.version)).toEqual([version,version]);};
 await check('1.0.0');const second=await stagePluginSet(root,await sources('2.0.0'),true);
 const raced=await Promise.allSettled([activatePluginSet(root,second.id,1,true),activatePluginSet(root,second.id,1,true)]);expect(raced.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await inspectPluginSet(root)).current!.version).toBe(2);await check('2.0.0');
 await activatePluginSet(root,first.id,2,true);await check('1.0.0');expect(extensionAuthorityWatchPaths(root)).toContain(join(root,'.ccpt/plugin-sets/active.json'));
}));

test('rollback refuses revoked signatures and receipt mutation without changing active pointer',()=>fixture(async(root,settings,sources)=>{
 const first=await stagePluginSet(root,await sources('1.0.0'),true),second=await stagePluginSet(root,await sources('2.0.0'),true);await activatePluginSet(root,second.id,0,true);
 const pointer=join(root,'.ccpt/plugin-sets/active.json'),before=await readFile(pointer,'utf8');
 await writeJson(join(root,'.ccpt/settings.json'),{...settings,revokedPluginKeys:['publisher']});await expect(activatePluginSet(root,first.id,1,true)).rejects.toThrow('revoked');expect(await readFile(pointer,'utf8')).toBe(before);
 await writeJson(join(root,'.ccpt/settings.json'),settings);await writeFile(join(root,'.ccpt/plugin-sets',first.id,'plugins/alpha/plugin.json'),'{}');await expect(activatePluginSet(root,first.id,1,true)).rejects.toThrow();expect(await readFile(pointer,'utf8')).toBe(before);
 await writeFile(pointer,JSON.stringify({version:1,generation:second.id,digest:'0'.repeat(64)}));const config=await loadConfig(root);config.usePluginSets=true;await expect(pluginSetDirectories(root,config)).rejects.toThrow('receipt changed');
}));

test('plugin sets require confirmation, trust and a complete active generation; orphan staging is never adopted',()=>fixture(async(root,_settings,sources)=>{
 const paths=await sources('1.0.0');await expect(stagePluginSet(root,paths,false)).rejects.toThrow('confirm');await expect(stagePluginSet(root,[paths[0]!,paths[0]!],true)).rejects.toThrow('Duplicate');
 const config=await loadConfig(root);config.usePluginSets=true;await expect(pluginSetDirectories(root,config)).rejects.toThrow('no active generation');await expect(activatePluginSet(root,'../outside',0,true)).rejects.toThrow('Invalid');
 await revokeWorkspaceTrust(root);await expect(stagePluginSet(root,paths,true)).rejects.toThrow('trust');
}));

test('explicit real BPE encodings count known text vectors and ordinary special-token spelling',()=>{
 expect(countTextTokens('hello world','cl100k_base')).toBe(2);expect(countTextTokens('hello world','o200k_base')).toBe(2);expect(countTextTokens('','cl100k_base')).toBe(0);
 expect(countTextTokens('你好世界','cl100k_base')).toBe(5);expect(countTextTokens('你好世界','o200k_base')).toBe(2);expect(countTextTokens('<|endoftext|>','cl100k_base')).toBeGreaterThan(1);
 expect(()=>countTextTokens('hello','guessed-model' as never)).toThrow('Unsupported');expect(()=>countTextTokens('x'.repeat(65537),'cl100k_base')).toThrow('segment');expect(()=>countTextTokens('x '.repeat(9*1024*1024),'cl100k_base')).toThrow('bounded');
 expect(()=>countTextTokens(' '.repeat(65537),'cl100k_base')).toThrow('segment');
});

test('context preflight uses explicitly selected BPE while requests and multimodal counts remain labelled estimated',()=>{
 const model={...defaultConfig.model,tokenizer:'cl100k_base' as const},messages=[{role:'user' as const,content:'hello world 你好世界'}];
 const input=JSON.stringify({system:'fixture',messages:contextMessages(messages),tools:[]});expect(estimateContextInput('fixture',messages,[],model)).toBe(countTextTokens(input,'cl100k_base'));expect(countModelText(undefined,input)).toBe(estimateTokens(input));
 const snapshot=measureContext(model,'fixture',messages,[]);expect(snapshot.textEncoding).toBe('cl100k_base');expect(formatContextSnapshot(snapshot)).toContain('provider framing/images/billing remain estimated');
 const config=structuredClone(defaultConfig);config.model.tokenizer='guess' as never;expect(()=>validateConfig(config)).toThrow();
});
