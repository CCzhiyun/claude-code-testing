import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-ephemeral-059-')),home=join(root,'home');
const env:Record<string,string>={CCPT_HOME:home};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
let requests=0;const server=Bun.serve({port:0,async fetch(){requests++;return Response.json({choices:[{message:{content:'EPHEMERAL_OK'},finish_reason:'stop'}]});}});
try{
 await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[],model:{apiProtocol:'chat-completions',endpointUrl:`http://127.0.0.1:${server.port}/chat/completions`,apiKeyEnv:''}});
 const child=Bun.spawn(['node',join(project,'dist/cli.js'),'-p','Explain a simple concept without using tools.','--no-session-persistence','--cwd',root],{cwd:root,env,stdin:'ignore',stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),20000);
 let out:string,err:string,code:number;try{[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);}finally{clearTimeout(timer);}
 if(code!==0||!out.includes('EPHEMERAL_OK')||requests!==1)throw new Error(err||'Ephemeral inference failed');
 const directories=await readdir(home).catch(error=>{if(error.code==='ENOENT')return [];throw error;});if(directories.some(name=>['sessions','agents','runtime-history'].includes(name)))throw new Error('Ephemeral run left persistent conversation/runtime data');
 const report={pass:true,runtime:'actual built Node CLI',checks:['real loopback answer in no-session-persistence mode','no persistent sessions/agents/runtime-history in user state'],modelRequests:requests,loopbackOnly:true,companyRequests:0,userSettingsModified:false};await writeJson(join(project,'.ccpt/platform-059/final/ephemeral-smoke.json'),report);console.log(JSON.stringify(report,null,2));
}finally{server.stop(true);await removeOwnedTemporaryFixture(root);}
