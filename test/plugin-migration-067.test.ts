import { test, expect } from 'bun:test';
import { mkdtemp, readFile, mkdir, writeFile, symlink } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, validateConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { previewLegacyPluginMigration, migrateLegacyPlugins, inspectPluginSet } from '../src/pluginSets.js';
import { snapshotPlugin } from '../src/pluginHistory.js';
import { loadPluginAt } from '../src/plugins.js';
import { signPlugin } from '../src/pluginSignatures.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
async function fixture(action:(root:string,config:typeof defaultConfig)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-plugin067-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const config=structuredClone(defaultConfig);config.policy.workspaceRoots=[root];config.hooks=[];config.marketplaceEnabled=false;config.disableBundledSkills=true;try{await trustWorkspace(root);await writeJson(join(root,'.ccpt/settings.json'),config);await action(root,config);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
const selection=[{name:'team-plugin',scope:'project' as const}];
async function plugin(root:string,version='1.0.0'){const path=join(root,'.ccpt/plugins/team-plugin');await writeJson(join(path,'plugin.json'),{schemaVersion:1,name:'team-plugin',version,contributes:{commands:[{name:'check',description:'fixture',prompt:'Check code'}]}});return path;}
test('legacy installed plugins migrate to immutable generation after digest review without changing active/legacy bytes',()=>fixture(async root=>{
 const path=await plugin(root),before=await readFile(join(path,'plugin.json'),'utf8'),review=await previewLegacyPluginMigration(root,selection);expect(review.activated).toBe(false);await expect(migrateLegacyPlugins(root,selection,review.reviewDigest,false)).rejects.toThrow('confirm');const result=await migrateLegacyPlugins(root,selection,review.reviewDigest,true);expect(result.activated).toBe(false);expect(result.legacyModified).toBe(false);expect((await inspectPluginSet(root)).current).toBeNull();expect((await inspectPluginSet(root,result.id)).plugins![0]!.version).toBe('1.0.0');expect(await readFile(join(path,'plugin.json'),'utf8')).toBe(before);
}));
test('retained history selection uses exact receipt bytes rather than currently installed version',()=>fixture(async root=>{
 await plugin(root);const revision=await snapshotPlugin(root,'team-plugin');await plugin(root,'2.0.0');const chosen=[{...selection[0]!,revisionId:revision.id}],review=await previewLegacyPluginMigration(root,chosen),result=await migrateLegacyPlugins(root,chosen,review.reviewDigest,true);expect((await inspectPluginSet(root,result.id)).plugins![0]!.version).toBe('1.0.0');expect((await loadPluginAt(join(root,'.ccpt/plugins/team-plugin'))).version).toBe('2.0.0');
}));
test('stale source/config, duplicate identity and corrupt history receipt are rejected before staging',()=>fixture(async(root,config)=>{
 await plugin(root);const review=await previewLegacyPluginMigration(root,selection);await plugin(root,'2.0.0');await expect(migrateLegacyPlugins(root,selection,review.reviewDigest,true)).rejects.toThrow('changed');await expect(previewLegacyPluginMigration(root,[...selection,...selection])).rejects.toThrow('Duplicate');
 const fresh=await previewLegacyPluginMigration(root,selection);config.marketplaceEnabled=true;await writeJson(join(root,'.ccpt/settings.json'),config);await expect(migrateLegacyPlugins(root,selection,fresh.reviewDigest,true)).rejects.toThrow('changed');const revision=await snapshotPlugin(root,'team-plugin');await writeFile(join(root,'.ccpt/plugin-history/project/team-plugin',revision.id,'content/plugin.json'),'{}');await expect(previewLegacyPluginMigration(root,[{...selection[0]!,revisionId:revision.id}])).rejects.toThrow();
}));
test('current signature/revocation policy applies to legacy migrations; no grandfathered trust',()=>fixture(async(root,config)=>{
 const path=await plugin(root);config.requirePluginSignatures=true;await writeJson(join(root,'.ccpt/settings.json'),config);await expect(previewLegacyPluginMigration(root,selection)).rejects.toThrow('signature');const keys=generateKeyPairSync('ed25519'),key=join(root,'publisher.pem');await writeFile(key,keys.privateKey.export({type:'pkcs8',format:'pem'}));await signPlugin(path,key,'publisher');config.pluginTrustKeys={publisher:keys.publicKey.export({type:'spki',format:'pem'}).toString()};await writeJson(join(root,'.ccpt/settings.json'),config);const review=await previewLegacyPluginMigration(root,selection);config.revokedPluginKeys=['publisher'];await writeJson(join(root,'.ccpt/settings.json'),config);await expect(migrateLegacyPlugins(root,selection,review.reviewDigest,true)).rejects.toThrow('revoked');
}));
test('grouped plugin Hooks preserve once, directory bounds, HTTP and prompt declarations',()=>fixture(async(root,config)=>{
 const path=join(root,'contributed');await writeJson(join(path,'.claude-plugin/plugin.json'),{name:'fixture',version:'1.0.0'});await writeJson(join(path,'hooks/hooks.json'),{hooks:{FileChanged:[{matcher:'*.ts',hooks:[{type:'command',command:'node fixture.cjs',once:true,watchDirectories:[{path:'src',recursive:true,maxFiles:4}],timeoutMs:1234,statusMessage:'checking'}]}],Notification:[{hooks:[{type:'http',url:'https://example.invalid/hook',allowedEnvVars:['TEST']},{type:'prompt',prompt:'inspect'}]}]}});const loaded=await loadPluginAt(path);expect(loaded.contributions.hooks).toHaveLength(3);expect(loaded.contributions.hooks![0]).toMatchObject({once:true,watchDirectories:[{path:'src',recursive:true,maxFiles:4}],timeoutMs:1234,matcher:'*.ts'});config.hooks=loaded.contributions.hooks!;expect(()=>validateConfig(config)).not.toThrow();
}));
test('unknown grouped Hook type remains visible to validation instead of silently disappearing',()=>fixture(async(root,config)=>{
 const path=join(root,'contributed');await writeJson(join(path,'.claude-plugin/plugin.json'),{name:'fixture',version:'1.0.0',hooks:{Notification:[{hooks:[{type:'unknown',command:'node'}]}]}});config.hooks=(await loadPluginAt(path)).contributions.hooks!;expect(config.hooks).toHaveLength(1);expect(()=>validateConfig(config)).toThrow();
}));
