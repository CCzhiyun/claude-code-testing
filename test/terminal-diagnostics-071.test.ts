import {test,expect} from 'bun:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {defaultConfig} from '../src/config.js';
import {writeJson} from '../src/storage.js';
import {workspaceTrustKey} from '../src/workspaceTrust.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';

test('raw-key TUI reads and exports persisted diagnostics without a model request or conversation loss',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ccpt-terminal-diagnostics-071-')),state=join(root,'state');
 const config=structuredClone(defaultConfig);config.hooks=[];config.marketplaceEnabled=false;config.model.apiProtocol='responses';config.model.endpointUrl='http://127.0.0.1:1/responses';config.model.apiKeyEnv='';config.policy.workspaceRoots=[root];config.skillsDirectories=[];config.agentsDirectories=[];config.pluginDirectories=[];
 const id='modelerror_1111111111111111';
 await writeJson(join(state,'settings.json'),config);await writeJson(join(root,'.ccpt','settings.json'),config);
 await writeJson(join(state,'workspace-trust.json'),{version:1,workspaces:{[workspaceTrustKey(root)]:{trustedAt:new Date().toISOString()}}});
 await writeJson(join(state,'diagnostics','model-errors.json'),[{id,at:new Date().toISOString(),model:'fixture',protocol:'responses',transport:'responses',endpoint:'http://127.0.0.1:1/responses',tools:2,status:500,message:'gateway rejected',requestId:'req-terminal-071',diagnostic:'ModelRequestError: gateway rejected\n    at fixture'}]);
 const entry=pathToFileURL(resolve(import.meta.dir,'../src/tui.ts')).href;
 const script=`Object.defineProperty(process.stdin,'isTTY',{value:true});process.stdin.setRawMode=()=>process.stdin;Object.defineProperty(process.stdout,'columns',{value:130});Object.defineProperty(process.stdout,'rows',{value:42});const{runTui}=await import(${JSON.stringify(entry)});await runTui(process.cwd(),'0.71.0');process.exit(0);`;
 const env:Record<string,string>={CCPT_HOME:state,NO_COLOR:'1',DISABLE_AUTOUPDATER:'1'};for(const key of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[key])env[key]=process.env[key]!;
 const child=Bun.spawn([process.execPath,'-e',script],{cwd:root,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});let output='';
 const pumps=Promise.all([child.stdout,child.stderr].map(async stream=>{const decoder=new TextDecoder();for await(const chunk of stream)output+=decoder.decode(chunk,{stream:true});}));
 const until=async(marker:string)=>{const deadline=Date.now()+10000;while(!output.includes(marker)&&Date.now()<deadline)await Bun.sleep(25);expect(output.includes(marker),output.slice(-4000)).toBe(true);output='';};
 const send=(text:string)=>{child.stdin.write(text+'\r');child.stdin.flush();};
 try{
  await until('/model to change');send('/doctor errors');await until('req-terminal-071');send('/doctor export diagnostic-071.json');await until('Local redacted diagnostics:');
  const report=JSON.parse(await readFile(join(root,'diagnostic-071.json'),'utf8'));expect(report.recentModelErrors.entries[0].id).toBe(id);expect(report.recentModelErrors.entries[0].status).toBe(500);
  send('/doctor errors 101');await until('1–100');send('/doctor errors 1');await until('req-terminal-071');send('/exit');await Promise.race([child.exited,Bun.sleep(3000)]);
 }finally{child.kill();await child.exited;await pumps;await removeOwnedTemporaryFixture(root);}
},60000);
