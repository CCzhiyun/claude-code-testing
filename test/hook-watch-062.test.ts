import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../src/config.js';
import {startHookFileWatch} from '../src/hookFileWatch.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
test('explicit watchPaths support relative matchers, dynamic authorized updates and fail-closed invalid replacement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ccpt-watch062-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');let stop:ReturnType<typeof startHookFileWatch>|undefined;
 try{await mkdir(join(root,'src'));const log=join(root,'events.jsonl'),script=join(root,'observer.cjs');await writeFile(script,`let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>require('fs').appendFileSync(${JSON.stringify(log)},s+String.fromCharCode(10)));`);await writeFile(join(root,'src/a.ts'),'a');await writeFile(join(root,'src/b.ts'),'b');const config=structuredClone(defaultConfig);config.policy.workspaceRoots=[root];config.hooks=[{event:'FileChanged',watchPaths:['src/a.ts'],matcher:'src/*.ts',command:`node "${script}"`}];stop=startHookFileWatch(config,root,{}, {intervalMs:100});await Bun.sleep(220);await writeFile(join(root,'src/a.ts'),'a changed');const until=async(text:string)=>{const end=Date.now()+3000;while(Date.now()<end){try{if((await readFile(log,'utf8')).includes(text))return;}catch{}await Bun.sleep(30);}throw new Error('Missing watcher event '+text);};await until('src/a.ts');
  config.hooks[0]!.watchPaths=['src/b.ts'];stop.update(config);await Bun.sleep(220);await writeFile(join(root,'src/a.ts'),'removed input must not trigger');await writeFile(join(root,'src/b.ts'),'b changed');await until('src/b.ts');const lines=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(lines).toHaveLength(2);expect(lines[1].relative_path).toBe('src/b.ts');
  config.hooks[0]!.watchPaths=['../outside'];expect(()=>stop!.update(config)).toThrow();await writeFile(join(root,'src/b.ts'),'after invalid update');await Bun.sleep(250);expect((await readFile(log,'utf8')).trim().split('\n')).toHaveLength(2);stop();expect(()=>stop!.update(config)).toThrow('stopped');
 }finally{stop?.();if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
},10000);
