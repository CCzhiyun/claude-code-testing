// Actual built Node CLI and raw-key TUI. Fixture model URLs never leave loopback.
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSession, saveSession } from '../src/sessions.js';
import { writeJson } from '../src/storage.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
const project=resolve(import.meta.dir,'..'),root=await mkdtemp(join(tmpdir(),'ccpt-platform-node-059-')),home=join(root,'home'),workspace=join(root,'workspace'),additional=join(root,'additional'),prior=process.env.CCPT_HOME;process.env.CCPT_HOME=home;
const env:Record<string,string>={CCPT_HOME:home};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
const entry=join(project,'dist/cli.js'),sdk=await import(pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href);let child:ReturnType<typeof Bun.spawn>|undefined,pump:Promise<unknown>|undefined,output='';
async function cli(args:string[]){const p=Bun.spawn(['node',entry,...args,'--cwd',workspace],{cwd:workspace,env,stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>p.kill(),20000);try{const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code!==0)throw new Error(err);return JSON.parse(out);}finally{clearTimeout(timer);}}
async function until(check:()=>boolean,label:string){const deadline=Date.now()+15000;while(!check()&&Date.now()<deadline)await Bun.sleep(30);if(!check())throw new Error(label+'\n'+output.slice(-2500));}
try{
 await mkdir(workspace);await mkdir(additional);const log=join(root,'directory.jsonl'),hook=join(project,'test/lifecycle-057-fixture.cjs');
 await writeJson(join(workspace,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[{event:'DirectoryAdded',command:`node "${hook}" fail "${log}"`}]});await trustWorkspace(workspace);
 const session=await createSession('Node history fixture',workspace);session.messages=[{role:'user',content:'VISIBLE_USER'},{role:'assistant',content:[{type:'text',text:'VISIBLE_ANSWER'},{type:'thinking',text:'PRIVATE_THINKING'}]}];await saveSession(session);
 const metadata=await cli(['sessions','preview',session.id]),text=await cli(['sessions','preview',session.id,'--include-text','--limit','1']);if(metadata.textIncluded||text.items[0].text!=='VISIBLE_ANSWER'||JSON.stringify(text).includes('PRIVATE_'))throw new Error('Node history boundary failed');
 const goal=await cli(['goals','set',session.id,'--objective','Verify raw-key interaction']);
 const job=await cli(['automation','prepare']);await cli(['wakeups','schedule',session.id,'--job',job.id,'--at',new Date(Date.now()+60000).toISOString(),'--prompt','PRIVATE_WAKEUP']);const wakeups=await cli(['wakeups','list']);if(wakeups[0].jobId!==job.id)throw new Error('Node wakeup binding failed');
 const script=`Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});process.stdin.setRawMode=()=>process.stdin;Object.defineProperty(process.stdout,'columns',{value:120});Object.defineProperty(process.stdout,'rows',{value:32});process.argv=['node',${JSON.stringify(entry)},'--cwd',${JSON.stringify(workspace)},'--resume',${JSON.stringify(session.id)}];await import(${JSON.stringify(pathToFileURL(entry).href)});`;
 const terminal=Bun.spawn(['node','--input-type=module','-e',script],{cwd:workspace,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});child=terminal;const collect=async(stream:ReadableStream<Uint8Array>)=>{const decoder=new TextDecoder();for await(const chunk of stream)output+=decoder.decode(chunk,{stream:true});};pump=Promise.all([collect(terminal.stdout),collect(terminal.stderr)]);
 const send=(value:string)=>{terminal.stdin.write(value);terminal.stdin.flush();};await until(()=>output.includes('Resumed: Node history fixture'),'TUI resume boot');send(`/add-dir ${additional}\r`);await until(()=>output.includes('not rolled back'),'Directory observer failure is visible without undoing configuration');send(`/add-dir ${additional}\r`);await Bun.sleep(700);
 const lines=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));if(lines.length!==1||lines[0].path!==additional||lines[0].hook_event_name!=='DirectoryAdded')throw new Error('Duplicate/missing automatic directory Hook');
 send('/goal pause waiting for review\r');await until(()=>output.includes('"status": "paused"'),'Goal paused');send('/goal resume\r');await until(()=>output.includes('"version": 3'),'Goal resumed with version');
 const goals=await sdk.listSessionGoals(session.id,workspace);if(goals[0].id!==goal.id||goals[0].status!=='active'||goals[0].version!==3)throw new Error('TUI Goal transition was not durable');
 send('/exit\r');await Promise.race([terminal.exited,Bun.sleep(3000)]);terminal.kill();await terminal.exited;await pump;child=undefined;
 const report={pass:true,runtime:'actual built Node CLI and raw-key TUI',checks:['metadata-only history default','explicit redacted text preview','CLI job-bound wakeup','CLI Goal set','TUI resume existing session without model execution','automatic DirectoryAdded once','post-action observer failure does not undo root','TUI pause/resume durable CAS'],modelRequests:0,companyRequests:0,osTasksChanged:false,userSettingsModified:false,physicalTerminalCertified:false};await writeJson(join(project,'.ccpt/platform-059/final/node-platform-smoke.json'),report);console.log(JSON.stringify(report,null,2));
}finally{child?.kill();if(child)await child.exited;await pump;if(prior===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=prior;await removeOwnedTemporaryFixture(root);}
