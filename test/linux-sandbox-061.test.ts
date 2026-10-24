// Opt-in target-machine probes, never silently emulated on Windows/macOS.
import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultConfig} from '../src/config.js';
import {executeCommand} from '../src/policy.js';
import {withExecutionSignal} from '../src/executionControl.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
const enabled=process.platform==='linux'&&process.env.CCPT_RUN_OS_SANDBOX_TESTS==='1';
async function fixture(action:(root:string,workspace:string,config:typeof defaultConfig)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-linux-sandbox-061-')),workspace=join(root,'workspace'),old=process.env.CCPT_HOME;await mkdir(workspace);process.env.CCPT_HOME=join(root,'home');const config=structuredClone(defaultConfig);config.hooks=[];config.policy.workspaceRoots=[workspace];config.policy.osSandbox='linux-bubblewrap';config.policy.mode='sandbox';config.policy.allowedCommands=['node'];try{await action(root,workspace,config);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}}
test.skipIf(!enabled)('real Linux namespace probe hides owned outside sentinel, protected .env, host loopback and credential environment',()=>fixture(async(root,workspace,config)=>{
 const outside=join(root,'outside-sentinel');await writeFile(outside,'OWNED_OUTSIDE_SENTINEL');await writeFile(join(workspace,'.env'),'OWNED_PROTECTED_SENTINEL');const prior=process.env.CCPT_SANDBOX_TEST_TOKEN;process.env.CCPT_SANDBOX_TEST_TOKEN='OWNED_ENV_SENTINEL';const host=Bun.serve({port:0,fetch:()=>new Response('host loopback')});
 const script=`const fs=require('fs'),net=require('net');let outside=false,protectedValue=false;try{outside=fs.readFileSync(process.argv[2],'utf8')==='OWNED_OUTSIDE_SENTINEL'}catch{}try{protectedValue=fs.readFileSync('.env','utf8')==='OWNED_PROTECTED_SENTINEL'}catch{}const socket=net.connect({host:'127.0.0.1',port:Number(process.argv[3])});let done=false;const finish=network=>{if(done)return;done=true;socket.destroy();console.log(JSON.stringify({outside,protectedValue,environment:Boolean(process.env.CCPT_SANDBOX_TEST_TOKEN),network}));};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));setTimeout(()=>finish(false),250);`;
 await writeFile(join(workspace,'probe.cjs'),script);
 try{const result=await executeCommand('node',['probe.cjs',outside,String(host.port)],workspace,config);expect(result.code,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual({outside:false,protectedValue:false,environment:false,network:false});}finally{host.stop(true);if(prior===undefined)delete process.env.CCPT_SANDBOX_TEST_TOKEN;else process.env.CCPT_SANDBOX_TEST_TOKEN=prior;}
}),15000);
test.skipIf(!enabled)('real Linux cancellation stops a deliberately detached descendant heartbeat inside the PID namespace',()=>fixture(async(_root,workspace,config)=>{
 const heartbeat=join(workspace,'heartbeat'),stop=join(workspace,'stop');
 await writeFile(join(workspace,'child.cjs'),`const fs=require('fs');setInterval(()=>{if(fs.existsSync('stop'))process.exit(0);fs.writeFileSync('heartbeat',String(Date.now()));},30);`);
 await writeFile(join(workspace,'parent.cjs'),`require('child_process').spawn(process.execPath,['child.cjs'],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000);`);
 const controller=new AbortController();const execution=withExecutionSignal(controller.signal,()=>executeCommand('node',['parent.cjs'],workspace,config));const settled=execution.then(()=>false,()=>true);
 try{const deadline=Date.now()+4000;while(Date.now()<deadline){try{await readFile(heartbeat);break;}catch{await Bun.sleep(30);}}expect(await readFile(heartbeat,'utf8')).not.toBe('');controller.abort();expect(await settled).toBe(true);await Bun.sleep(200);const before=await readFile(heartbeat,'utf8');await Bun.sleep(300);expect(await readFile(heartbeat,'utf8')).toBe(before);}finally{controller.abort();await settled;await writeFile(stop,'stop owned fixture child');await Bun.sleep(100);}
}),15000);
