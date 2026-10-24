import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, saveSession, loadSession } from '../src/sessions.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('real restarted IDE bridges recover history without execution, scope all sessions and use Goal CAS', async()=>{
 const root=await mkdtemp(join(tmpdir(),'ccpt-ide-history-059-')),home=join(root,'home'),old=process.env.CCPT_HOME;process.env.CCPT_HOME=home;
 let requests=0;const server=Bun.serve({port:0,async fetch(){requests++;return Response.json({choices:[{message:{content:'FOLLOWUP_OK'},finish_reason:'stop'}]});}});
 await writeJson(join(root,'.ccpt/settings.json'),{marketplaceEnabled:false,disableBundledSkills:true,hooks:[],model:{apiProtocol:'chat-completions',apiKeyEnv:'',endpointUrl:`http://127.0.0.1:${server.port}/chat/completions`}});
 const env:Record<string,string>={CCPT_HOME:home};for(const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name]!;
 function start(){const child=Bun.spawn([process.execPath,join(import.meta.dir,'../src/cli.ts'),'ide','serve','--cwd',root],{cwd:root,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});const messages:any[]=[];let buffer='',next=0;
  const pump=(async()=>{for await(const chunk of child.stdout){buffer+=new TextDecoder().decode(chunk);let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);messages.push(JSON.parse(line));}}})();const errors=new Response(child.stderr).text();
  return {child,pump,errors,async call(method:string,params:object={}){const id=++next;child.stdin.write(JSON.stringify({id,method,params})+'\n');child.stdin.flush();const deadline=Date.now()+15000;while(!messages.some(row=>row.id===id)&&Date.now()<deadline)await Bun.sleep(20);const answer=messages.find(row=>row.id===id);if(!answer)throw new Error('IDE bridge timeout');return answer;},async stop(){child.stdin.end();const exit=await Promise.race([child.exited,Bun.sleep(2500).then(()=>null)]);if(exit===null)child.kill();await child.exited;await pump;await errors;}};
 }
 const windows:ReturnType<typeof start>[]=[];
 try{
  const s=await createSession('selected',root);s.messages=[{role:'user',content:'SAVED_QUESTION'},{role:'assistant',content:[{type:'text',text:'SAVED_ANSWER'},{type:'thinking',text:'PRIVATE-REASONING'}]}];await saveSession(s);const other=join(root,'other');await mkdir(other);const foreign=await createSession('PRIVATE-FOREIGN-TITLE',other);
  const first=start();windows.push(first);expect((await first.call('session/history',{id:s.id})).result.textIncluded).toBe(false);const page=(await first.call('session/history',{id:s.id,includeText:true,limit:1})).result;expect(page.items[0].text).toBe('SAVED_ANSWER');expect(JSON.stringify(page)).not.toContain('PRIVATE');await first.stop();
  const next=start();windows.push(next);expect((await next.call('session/history',{id:s.id,includeText:true,cursor:page.nextCursor})).result.items[0].text).toBe('SAVED_QUESTION');expect(requests).toBe(0);
  expect((await next.call('sessions/list')).result.map((row:any)=>row.id)).toEqual([s.id]);for(const method of ['session/history','runtime/history','session/resume'])expect((await next.call(method,{id:foreign.id,goal:'Must not run'})).error.message).toContain('another workspace');expect(requests).toBe(0);
  const goal=(await next.call('goal/set',{sessionId:s.id,objective:'Finish safely'})).result;const paused=await next.call('goal/decide',{sessionId:s.id,id:goal.id,status:'paused',reason:'Review',expectedVersion:1});expect(paused.result.version).toBe(2);expect((await next.call('goal/decide',{sessionId:s.id,id:goal.id,status:'active',expectedVersion:1})).error.message).toContain('changed');
  const answer=(await next.call('chat/send',{sessionId:s.id,goal:'Continue the saved conversation without using any tools.'})).result;expect(answer.sessionId).toBe(s.id);expect(requests).toBe(1);expect((await loadSession(s.id)).messages.some(message=>message.content==='SAVED_QUESTION')).toBe(true);
  const activity=(await next.call('runtime/history',{id:s.id})).result;expect(activity.items.some((row:any)=>row.type==='agent_completed')).toBe(true);expect(activity.metadataOnly).toBe(true);
  const raw=await readFile(join(home,'runtime-history',`${s.id}.json`),'utf8');expect(raw).not.toContain('FOLLOWUP_OK');
 }finally{for(const window of windows)if(window.child.exitCode===null)await window.stop();server.stop(true);if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
},30000);
