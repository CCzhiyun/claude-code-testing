import {test,expect} from 'bun:test';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeJson} from '../src/storage.js';
import {signPlugin} from '../src/pluginSignatures.js';
import {signPluginOverlay} from '../src/pluginOverlays.js';
import {computePluginDigest} from '../src/plugins.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {addMarketplace,stageMarketplacePluginSet,installMarketplacePlugin} from '../src/marketplace.js';
import {activatePluginSet,inspectPluginSet} from '../src/pluginSets.js';
import {loadPlatform} from '../src/platform.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
async function fixture(action:(f:{root:string;settings:Record<string,unknown>;publish:(version:string,tamper?:boolean)=>Promise<string[]>;catalog:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'ccpt-overlays064-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');
 try{const catalog=join(root,'catalog'),keys=generateKeyPairSync('ed25519'),overlayKeys=generateKeyPairSync('ed25519'),key=join(root,'publisher.pem'),overlayKey=join(root,'overlay.pem');await mkdir(catalog);await writeFile(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));await writeFile(overlayKey,overlayKeys.privateKey.export({type:'pkcs8',format:'pem'}));
 const settings={marketplaceEnabled:true,disableBundledSkills:true,requirePluginSignatures:true,pluginTrustKeys:{publisher:keys.publicKey.export({type:'spki',format:'pem'}).toString(),team:overlayKeys.publicKey.export({type:'spki',format:'pem'}).toString()},policy:{workspaceRoots:[root]}};
 await writeJson(join(root,'.ccpt/settings.json'),settings);await trustWorkspace(root);
 const publish=async(version:string,tamper=false)=>{const entries=[],paths=[];for(const name of ['alpha','beta']){const path=join(catalog,name);await mkdir(path,{recursive:true});await writeJson(join(path,'plugin.json'),{name,version,contributes:{commands:[{name:'base-'+name,description:name,prompt:'base '+version}]}});await signPlugin(path,key,'publisher');const signedOverlay=await signPluginOverlay(path,{commands:[{name:'team-'+name,description:name,prompt:'team '+version}]},overlayKey,'team');if(tamper)signedOverlay.contributes.commands![0]!.prompt='modified unsigned catalog payload';entries.push({name,source:'./'+name,version,signedOverlay});paths.push(path);}await writeJson(join(catalog,'.claude-plugin/marketplace.json'),{name:'team-catalog',owner:{name:'Fixture'},plugins:entries});return paths;};
 await publish('1.0.0');await addMarketplace(root,catalog);await action({root,settings,publish,catalog});
 }finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
}
const identities=['alpha@team-catalog','beta@team-catalog'];
test('Marketplace stages independently signed overlays without changing publisher bytes; one pointer switches two artifacts and overlays',()=>fixture(async f=>{
 const before=await computePluginDigest(join(f.catalog,'alpha'));await expect(installMarketplacePlugin(f.root,identities[0]!)).rejects.toThrow('plugin-set');
 const first=await stageMarketplacePluginSet(f.root,identities,true);expect((await inspectPluginSet(f.root)).current).toBeNull();expect(await computePluginDigest(join(f.root,'.ccpt/plugin-sets',first.id,'plugins/alpha'))).toBe(before);
 await activatePluginSet(f.root,first.id,0,true);await writeJson(join(f.root,'.ccpt/settings.json'),{...f.settings,usePluginSets:true});
 const one=await loadPlatform(f.root);expect(one.diagnostics).toEqual([]);expect(one.plugins.map(p=>p.overlayKeyId)).toEqual(['team','team']);expect(one.commands.filter(c=>c.name.startsWith('/team-')).map(c=>c.prompt)).toEqual(['team 1.0.0','team 1.0.0']);
 await f.publish('2.0.0');const second=await stageMarketplacePluginSet(f.root,identities,true);const raced=await Promise.allSettled([activatePluginSet(f.root,second.id,1,true),activatePluginSet(f.root,second.id,1,true)]);expect(raced.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await loadPlatform(f.root)).commands.filter(c=>c.name.startsWith('/team-')).map(c=>c.prompt)).toEqual(['team 2.0.0','team 2.0.0']);
 await activatePluginSet(f.root,first.id,2,true);const reverted=await loadPlatform(f.root);expect(reverted.plugins.map(p=>p.version)).toEqual(['1.0.0','1.0.0']);expect(reverted.commands.filter(c=>c.name.startsWith('/team-')).map(c=>c.prompt)).toEqual(['team 1.0.0','team 1.0.0']);
}));
test('tampered/revoked overlay or artifact never publishes an active generation or silently borrows publisher trust',()=>fixture(async f=>{
 const first=await stageMarketplacePluginSet(f.root,identities,true);await activatePluginSet(f.root,first.id,0,true);const pointer=join(f.root,'.ccpt/plugin-sets/active.json'),before=await readFile(pointer,'utf8');
 await f.publish('2.0.0',true);await expect(stageMarketplacePluginSet(f.root,identities,true)).rejects.toThrow('Overlay signature');expect(await readFile(pointer,'utf8')).toBe(before);
 await f.publish('2.0.0');await writeJson(join(f.root,'.ccpt/settings.json'),{...f.settings,revokedPluginKeys:['team']});await expect(stageMarketplacePluginSet(f.root,identities,true)).rejects.toThrow('revoked');await expect(activatePluginSet(f.root,first.id,1,true)).rejects.toThrow('revoked');
 expect(await readFile(pointer,'utf8')).toBe(before);
}));
test('generation receipt mutation, duplicate IDs, missing consent and unsigned catalog overlays are rejected',()=>fixture(async f=>{
 await expect(stageMarketplacePluginSet(f.root,identities,false)).rejects.toThrow('confirm');await expect(stageMarketplacePluginSet(f.root,[identities[0]!,identities[0]!],true)).rejects.toThrow('duplicate');await expect(stageMarketplacePluginSet(f.root,['alpha'],true)).rejects.toThrow('explicit');
 const first=await stageMarketplacePluginSet(f.root,identities,true);await activatePluginSet(f.root,first.id,0,true);const receipt=join(f.root,'.ccpt/plugin-sets',first.id,'receipt.json');const row=JSON.parse(await readFile(receipt,'utf8'));row.plugins[0].overlay.contributes.commands[0].prompt='tampered';await writeJson(receipt,row);await expect(inspectPluginSet(f.root)).rejects.toThrow('Overlay signature');
 const catalog=join(f.catalog,'.claude-plugin/marketplace.json'),manifest=JSON.parse(await readFile(catalog,'utf8'));manifest.plugins[0].commands=[];await writeJson(catalog,manifest);await expect(stageMarketplacePluginSet(f.root,identities,true)).rejects.toThrow('Unsigned catalog');
}));

test('conflicting explicit settings overlay rejects activation before the generation pointer changes',()=>fixture(async f=>{
 const first=await stageMarketplacePluginSet(f.root,identities,true);await activatePluginSet(f.root,first.id,0,true);await f.publish('2.0.0');const second=await stageMarketplacePluginSet(f.root,identities,true);
 await writeJson(join(f.root,'.ccpt/settings.json'),{...f.settings,pluginOverlays:{alpha:first.plugins[0]!.overlay}});const pointer=join(f.root,'.ccpt/plugin-sets/active.json'),before=await readFile(pointer,'utf8');await expect(activatePluginSet(f.root,second.id,1,true)).rejects.toThrow('conflicts');expect(await readFile(pointer,'utf8')).toBe(before);
}));
