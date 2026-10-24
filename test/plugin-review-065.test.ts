import { test, expect } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeJson } from '../src/storage.js';
import { signPlugin } from '../src/pluginSignatures.js';
import { signPluginOverlay } from '../src/pluginOverlays.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { stagePluginSet, activatePluginSet, previewPluginSetActivation, activateReviewedPluginSet, inventoryPluginSets, recoverInterruptedPluginSet } from '../src/pluginSets.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
async function fixture(action:(root:string,publish:(version:string,overlayOnly?:boolean)=>Promise<Awaited<ReturnType<typeof stagePluginSet>>>,settings:Record<string,unknown>)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-pluginreview065-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');
 try{const keys=generateKeyPairSync('ed25519'),key=join(root,'signer.pem');await writeFile(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));
 const settings={requirePluginSignatures:true,pluginTrustKeys:{team:keys.publicKey.export({type:'spki',format:'pem'}).toString()},policy:{workspaceRoots:[root]}};await writeJson(join(root,'.ccpt/settings.json'),settings);await trustWorkspace(root);
 const publish=async(version:string,overlayOnly=false)=>{const source=join(root,'source');await mkdir(source,{recursive:true});await writeJson(join(source,'plugin.json'),{name:'sample',version:overlayOnly?'1.0.0':version});await signPlugin(source,key,'team');const overlay=await signPluginOverlay(source,{commands:[{name:'team-command',description:'Test',prompt:version}]},key,'team');return stagePluginSet(root,[source],true,{sample:overlay});};
 await action(root,publish,settings);
 }finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
test('overlay-only update review is explicit, CAS-bound and keeps publisher artifact immutable',()=>fixture(async(root,publish)=>{
 const one=await publish('1.0.0');await activatePluginSet(root,one.id,0,true);const two=await publish('changed team instructions',true);
 const preview=await previewPluginSetActivation(root,two.id);expect(preview.changes).toHaveLength(1);expect(preview.changes[0]!.artifactChanged).toBe(false);expect(preview.changes[0]!.overlayChanged).toBe(true);expect(preview.activationAutomatic).toBe(false);
 await expect(activateReviewedPluginSet(root,two.id,preview.reviewDigest,false)).rejects.toThrow('confirm');
 const results=await Promise.allSettled([activateReviewedPluginSet(root,two.id,preview.reviewDigest,true),activateReviewedPluginSet(root,two.id,preview.reviewDigest,true)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await inventoryPluginSets(root)).current!.generation).toBe(two.id);
}));
test('effective authority changes invalidate a reviewed update before pointer mutation',()=>fixture(async(root,publish,settings)=>{
 const one=await publish('1.0.0');await activatePluginSet(root,one.id,0,true);const two=await publish('2.0.0'),preview=await previewPluginSetActivation(root,two.id);
 const pointer=join(root,'.ccpt/plugin-sets/active.json'),before=await readFile(pointer,'utf8');
 await writeJson(join(root,'.ccpt/settings.json'),{...settings,disableBundledSkills:true});
 await expect(activateReviewedPluginSet(root,two.id,preview.reviewDigest,true)).rejects.toThrow('review changed');expect(await readFile(pointer,'utf8')).toBe(before);
}));
test('complete signed interrupted stage is reviewed and recovered without activation or overwrite',()=>fixture(async(root,publish)=>{
 const one=await publish('1.0.0');await activatePluginSet(root,one.id,0,true);const two=await publish('2.0.0'),pending='.pending-REVIEW065';
 await rename(join(root,'.ccpt/plugin-sets',two.id),join(root,'.ccpt/plugin-sets',pending));
 const entry=(await inventoryPluginSets(root)).interrupted[0]!;expect(entry.recoverable).toBe(true);if(!('reviewDigest' in entry))throw new Error('Missing recovery review');
 await expect(recoverInterruptedPluginSet(root,'../escape',entry.reviewDigest,true)).rejects.toThrow('name');await expect(recoverInterruptedPluginSet(root,pending,'0'.repeat(64),true)).rejects.toThrow('review changed');
 const recovered=await recoverInterruptedPluginSet(root,pending,entry.reviewDigest,true);expect(recovered.activated).toBe(false);expect(recovered.current!.generation).toBe(one.id);expect((await inventoryPluginSets(root)).interrupted).toEqual([]);
}));
test('incomplete/tampered/revoked pending sources are retained and cannot be automatically adopted',()=>fixture(async(root,publish,settings)=>{
 const one=await publish('1.0.0'),pending='.pending-REVIEWBAD';await rename(join(root,'.ccpt/plugin-sets',one.id),join(root,'.ccpt/plugin-sets',pending));
 await mkdir(join(root,'.ccpt/plugin-sets/.pending-EMPTY065'));
 await writeJson(join(root,'.ccpt/settings.json'),{...settings,revokedPluginKeys:['team']});
 const list=await inventoryPluginSets(root);expect(list.interrupted).toHaveLength(2);expect(list.interrupted.every(row=>!row.recoverable)).toBe(true);
 await expect(recoverInterruptedPluginSet(root,pending,'0'.repeat(64),true)).rejects.toThrow('revoked');expect((await inventoryPluginSets(root)).interrupted).toHaveLength(2);
}));
test('signed bytes do not authorize unreceipted pending envelope files',()=>fixture(async(root,publish)=>{
 const one=await publish('1.0.0'),pending='.pending-EXTRA065',path=join(root,'.ccpt/plugin-sets',pending);await rename(join(root,'.ccpt/plugin-sets',one.id),path);await writeFile(join(path,'unexpected.sh'),'unreviewed bytes');
 expect((await inventoryPluginSets(root)).interrupted[0]!.recoverable).toBe(false);await expect(recoverInterruptedPluginSet(root,pending,'0'.repeat(64),true)).rejects.toThrow('Unreceipted');
}));
