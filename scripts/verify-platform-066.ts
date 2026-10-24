// Actual compiled Node processes; owned fixtures, no OS registration/model/company traffic.
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {writeJson} from '../src/storage.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-node066-')),old=process.env.CCPT_HOME;
process.env.CCPT_HOME=join(root,'home');
try{
 await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[],policy:{workspaceRoots:[root],allowNetwork:false}});await trustWorkspace(root);
 const env:Record<string,string>={CCPT_HOME:process.env.CCPT_HOME!,NO_COLOR:'1'};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
 const child=Bun.spawn(['node',join(project,'test/fixtures/platform-066-consumer.mjs'),pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href,join(project,'dist/cli.js')],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),90000);
 try{const[out,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(error+'\n'+out);const report=JSON.parse(out);await writeJson(join(project,'.ccpt/implementation-066/surfaces/platform-node.json'),report);console.log(JSON.stringify(report,null,2));}finally{clearTimeout(timer);}
}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
