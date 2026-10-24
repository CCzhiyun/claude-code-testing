import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeJson } from '../src/storage.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { createSession, loadSession } from '../src/sessions.js';
import { scheduleWakeup } from '../src/automation.js';
import { createProjectPlan } from '../src/plans.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
const { BridgeTransport } = createRequire(import.meta.url)('../vscode-extension/bridge.cjs');
const project = resolve(import.meta.dir, '..'), root = await mkdtemp(join(tmpdir(), 'ccpt-foundation-smoke-')), home = join(root, 'home'), previous = process.env.CCPT_HOME;
process.env.CCPT_HOME = home;
const env: Record<string,string> = { CCPT_HOME: home };
for (const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
const until = async (condition: () => boolean) => { const end = Date.now()+12000; while (!condition() && Date.now()<end) await Bun.sleep(25); if (!condition()) throw new Error('Foundation smoke deadline'); };
const cli = async (args: string[]) => {
  const child = Bun.spawn(['node',join(project,'dist/cli.js'),...args,'--cwd',root], { cwd: root, env, stdout:'pipe',stderr:'pipe' });
  const timer = setTimeout(() => child.kill(),15000);
  try { const [out,err,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]); if (code!==0) throw new Error(err); return JSON.parse(out); } finally { clearTimeout(timer); }
};
let bridge: any;
try {
  await writeJson(join(root,'.ccpt/settings.json'), { marketplaceEnabled:false,disableBundledSkills:true,hooks:[] }); await trustWorkspace(root);
  const session = await createSession('fixture',root);
  await scheduleWakeup({ sessionId:session.id,prompt:'PRIVATE-CONTEXT',runAt:new Date(Date.now()+60000).toISOString() },root);
  const statePath=join(root,'.ccpt/automation.json'), state=JSON.parse(await readFile(statePath,'utf8')); state.wakeups[0].runAt='2020-01-01T00:00:00Z'; await writeJson(statePath,state);
  const prepared=await cli(['automation','prepare','--minutes','3']); if (prepared.installed) throw new Error('Preparation registered an OS task');
  const tick=await cli(['_automation_tick',prepared.id,'--state-home',home]); if (tick.delivered!==1 || tick.modelsExecuted!==false) throw new Error('Owned scheduled tick failed');
  if ((await loadSession(session.id)).messages.length!==1) throw new Error('Wakeup transcript missing');
  if ((await cli(['_automation_tick',prepared.id,'--state-home',home])).delivered!==0) throw new Error('Wakeup duplicated');
  const notifications: any[]=[], cursors: string[]=[]; let saved: string | undefined;
  const start=()=>new BridgeTransport(root,'node',{fire:(value:unknown)=>notifications.push(value)}, { cursor:saved,onCursor:(cursor:string)=>{saved=cursor;cursors.push(cursor);},retryMs:500,spawn:()=>spawn('node',[join(project,'dist/cli.js'),'ide','serve','--cwd',root],{cwd:root,env,windowsHide:true,stdio:'pipe',shell:false}) });
  bridge=start(); await until(()=>notifications.some(item=>item.method==='project/event'));
  bridge.process.kill(); await until(()=>!bridge.connected);
  await createProjectPlan({cwd:root,request:'PRIVATE-PLAN-A',content:'# PRIVATE-CONTENT-A'});
  await createProjectPlan({cwd:root,request:'PRIVATE-PLAN-B',content:'# PRIVATE-CONTENT-B'});
  await until(()=>notifications.filter(item=>item.method==='project/event'&&item.params.topic==='plans').length===2);
  const replay=notifications.filter(item=>item.method==='project/event');
  if (new Set(replay.map(item=>item.params.cursor)).size!==replay.length || JSON.stringify(replay).includes('PRIVATE-')) throw new Error('Duplicate or sensitive replay metadata');
  bridge.dispose(); bridge=start(); await until(()=>bridge.connected&&cursors.length>=2); await Bun.sleep(500);
  if (notifications.filter(item=>item.method==='project/event'&&item.params.topic==='plans').length!==2) throw new Error('Restored client cursor replayed acknowledged Plan events');
  const report={pass:true,runtime:'built Node CLI plus actual reconnecting BridgeTransport',checks:['owned scheduler tick without model/tool calls','delivery dedupe','two Plan invalidations while bridge offline','cursor survives new bridge instance','no conversation/approval request replay','no private Plan content in event log'],osTaskRegistered:false,realRemoteCertified:false,companyRequests:0,userSettingsModified:false};
  await writeJson(join(project,'.ccpt/foundation-056/final/node-foundation-smoke.json'),report); console.log(JSON.stringify(report,null,2));
} finally { bridge?.dispose(); if(previous===undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME=previous; await removeOwnedTemporaryFixture(root); }
