import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {writeJson} from '../src/storage.js';
import {removeOwnedTemporaryFixture} from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-node070-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');
try{
 await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[],policy:{workspaceRoots:[root]}});await trustWorkspace(root);
 const env:Record<string,string>={CCPT_HOME:process.env.CCPT_HOME!,NO_COLOR:'1'};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
 for(const [fixture,output] of [['platform-068-consumer.mjs','compatibility-node.json'],['platform-067-consumer.mjs','previous-platform-node.json']]){
  const child=Bun.spawn(['node',join(project,'test/fixtures',fixture!),pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href,join(project,'dist/cli.js'),join(project,'test/mcp-interaction-fixture.cjs')],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),120000);
  try{const[out,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(error+'\n'+out);const report=JSON.parse(out);await writeJson(join(project,'.ccpt/implementation-070/surfaces',output!),report);console.log(JSON.stringify(report,null,2));}finally{clearTimeout(timer);}
  // Separate owned state is needed for the older fixture's independent ledger.
  await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[],policy:{workspaceRoots:[root]}});
 }
}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}




