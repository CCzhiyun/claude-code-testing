// Actual built Node CLI/bridge and raw-key TUI; never register/remove an OS job.
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeJson } from '../src/storage.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-platform-057-')),workspace=join(root,'workspace'),home=join(root,'home');
const previous=process.env.CCPT_HOME;process.env.CCPT_HOME=home;
const env:Record<string,string>={CCPT_HOME:home};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
const entry=join(project,'dist/cli.js');const sdk=await import(pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href);
async function cli(args:string[]){const child=Bun.spawn(['node',entry,...args,'--cwd',workspace],{cwd:workspace,env,stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>child.kill(),15000);try{const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(err);return JSON.parse(out);}finally{clearTimeout(timer);}}
let child:ReturnType<typeof Bun.spawn>|undefined,pump:Promise<unknown>|undefined,output='';
async function until(fn:()=>boolean,label:string){const deadline=Date.now()+12000;while(!fn()&&Date.now()<deadline)await Bun.sleep(25);if(!fn())throw new Error('Platform smoke deadline: '+label+'\nFixture-only output:\n'+output.slice(-3000));}
try{
  await mkdir(workspace);await writeJson(join(workspace,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[]});await trustWorkspace(workspace);
  const prepared=await cli(['automation','prepare']);const status=await cli(['automation','status',prepared.id]);
  const rebound=await cli(['automation','rebind',prepared.id,'--expected-digest',status.expectedDigest,'--confirm']);
  if(rebound.osTaskRegistered || rebound.replacement.id===prepared.id || (await cli(['automation','list'])).length!==2)throw new Error('Built scheduler management mismatch');
  if(!(await cli(['_automation_tick',prepared.id,'--state-home',home])).disabled)throw new Error('Rebound old job is not inert');
  const note=await sdk.createProjectNotification(workspace,{title:'BOOT_NOTIFICATION',body:'Fixture body'});
  const page=await cli(['notifications','list']);if(page.items[0].id!==note.id)throw new Error('Built CLI notification list mismatch');
  const script=`Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});process.stdin.setRawMode=()=>process.stdin;Object.defineProperty(process.stdout,'columns',{value:120});Object.defineProperty(process.stdout,'rows',{value:30});process.argv=['node',${JSON.stringify(entry)},'--cwd',${JSON.stringify(workspace)}];await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  const terminal=Bun.spawn(['node','--input-type=module','-e',script],{cwd:workspace,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});child=terminal;
  const collect=async(stream:ReadableStream<Uint8Array>)=>{const decoder=new TextDecoder();for await(const chunk of stream)output+=decoder.decode(chunk,{stream:true});};pump=Promise.all([collect(terminal.stdout),collect(terminal.stderr)]);
  const send=(text:string)=>{terminal.stdin.write(text);terminal.stdin.flush();};
  await until(()=>output.includes('Using '),'built Node TUI boot');send('/notifications\r');await until(()=>output.includes('BOOT_NOTIFICATION'),'notification resource view');
  if((await sdk.listProjectNotifications(workspace)).unread!==1)throw new Error('Viewing marked a notification read');
  await sdk.createProjectNotification(workspace,{title:'LIVE_NOTIFICATION',body:'Arrived while resource dialog is open'});
  await until(()=>output.includes('LIVE_NOTIFICATION'),'live notification refresh');
  // Node readline waits for a possible escape sequence before emitting bare Esc.
  send('\u001b');await Bun.sleep(700);const current=await sdk.listProjectNotifications(workspace);send(`/notifications read ${note.id} ${current.version}\r`);
  await until(()=>output.includes('acknowledged'),'explicit TUI read acknowledgement');
  if((await sdk.listProjectNotifications(workspace)).unread!==1)throw new Error('Read acknowledgement included a different notification');
  send('/exit\r');await Promise.race([terminal.exited,Bun.sleep(3000)]);terminal.kill();await terminal.exited;await pump;child=undefined;
  const report={pass:true,runtime:'built Node CLI and built Node TUI',checks:['scheduler list/status/CAS rebind','old job remains inert','notification CLI listing','raw-key notification view','new notification refresh while dialog open','viewing never marks read','explicit versioned single-ID acknowledgement'],ttyScope:'fixture TTY override, not physical ConPTY/Remote certification',osTasksChanged:false,companyRequests:0,modelRequests:0,userSettingsModified:false};
  await writeJson(join(project,'.ccpt/foundation-057/final/node-platform-smoke.json'),report);console.log(JSON.stringify(report,null,2));
}finally{child?.kill();if(child)await child.exited;await pump;if(previous===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=previous;await removeOwnedTemporaryFixture(root);}
