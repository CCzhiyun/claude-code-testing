import {lstat,opendir} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {resolveWorkspacePath} from './paths.js';
import {protectPath} from './policy.js';
import {notifyLifecycle} from './lifecycleNotifications.js';
import {validateHookWatch} from './hookWatchConfig.js';
import type {PlatformConfig,HookDefinition} from './types.js';
export interface HookWatchStatus {phase:'baselining'|'watching'|'blocked'|'stopped';files:number;scans:number;failures:number;lastError?:string}
export type HookFileWatcher=(()=>void)&{update:(config:PlatformConfig)=>void;status:()=>HookWatchStatus};
const ignored=new Set(['.git','.ccpt','node_modules']);
/** Polls metadata only. Incomplete traversals never produce deletion events. */
export function startHookFileWatch(config:PlatformConfig,cwd:string,context:{sessionId?:string;agentId?:string}={},options:{intervalMs?:number;active?:()=>boolean;onError?:()=>void}={}):HookFileWatcher{
 let stopped=false,busy=false,invalid=false,generation=0,initialized=false,selectedConfig=config;
 let targets=new Map<string,HookDefinition[]>(),previous=new Map<string,{fingerprint:string;hooks:HookDefinition[]}>();
 let directories:Array<{path:string;hook:HookDefinition;spec:NonNullable<HookDefinition['watchDirectories']>[number]}>=[];
 const rates=new Map<string,{at:number;count:number}>();
 let status:HookWatchStatus={phase:'baselining',files:0,scans:0,failures:0};
 const report=()=>{try{options.onError?.();}catch{/* Diagnostics callbacks never break the polling loop. */}};
 const pathFor=(name:string,policy:PlatformConfig)=>{
  const lexical=resolve(cwd,name),path=protectPath(resolveWorkspacePath(cwd,name,policy.policy.workspaceRoots),policy),suffix=relative(resolve(cwd),path);
  if(lexical!==path||suffix==='..'||suffix.startsWith('..'+sep)||isAbsolute(suffix))throw new Error('Watched path must remain in the current workspace without links');
  return path;
 };
 const add=(map:Map<string,HookDefinition[]>,path:string,hook:HookDefinition)=>{const list=map.get(path)??[];if(!list.includes(hook))list.push(hook);map.set(path,list);if(map.size>512)throw new Error('Watch file limit');};
 const update=(next:PlatformConfig)=>{
  generation++;invalid=true;targets=new Map();directories=[];previous.clear();rates.clear();initialized=false;selectedConfig=structuredClone(next);status={...status,phase:'baselining',files:0};delete status.lastError;
  for(const hook of selectedConfig.hooks)validateHookWatch(hook);
  if(next.policy.mode==='restricted'){invalid=false;return;}
  for(const hook of selectedConfig.hooks.filter(h=>h.event==='FileChanged')){
   const explicit=hook.watchPaths,names=explicit??(hook.watchDirectories?[]:(hook.matcher??'').split('|').filter(name=>name&&!/[*?{}\[\]\r\n\0]/.test(name)));
   const observer=explicit||hook.watchDirectories?hook:(({matcher,...rest})=>rest)(hook);
   for(const name of names)add(targets,pathFor(name,next),observer);
   for(const spec of hook.watchDirectories??[])directories.push({path:pathFor(spec.path,next),hook,spec});
  }
  if(targets.size>64||directories.length>8)throw new Error('Watch list is limited to 64 explicit files and eight directories');
  invalid=false;
 };
 const safeStat=async(path:string,policy:PlatformConfig)=>{
  protectPath(path,policy);const suffix=relative(resolve(cwd),path);let current=resolve(cwd);
  for(const part of suffix.split(sep).filter(Boolean)){current=join(current,part);try{if((await lstat(current)).isSymbolicLink())throw new Error('Watched path must not traverse links');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
  try{return await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
 };
 const tick=async()=>{
  if(stopped||busy||invalid)return;busy=true;const revision=generation,snapshot=selectedConfig,map=new Map([...targets].map(([path,hooks])=>[path,[...hooks]]));
  try{
   let entries=0,folders=0;
   for(const directory of directories){let count=0;const excluded=(directory.spec.exclude??[]).map(path=>path.replaceAll('\\','/').replace(/\/$/,''));
    const visit=async(path:string,depth:number):Promise<void>=>{
     if(stopped||revision!==generation)return;
     if(++folders>256)throw new Error('Watch directory limit');
     const stat=await safeStat(path,snapshot);if(!stat)return;if(!stat.isDirectory())throw new Error('Watch directory is not a directory');
     const stream=await opendir(path);
     for await(const entry of stream){
      if(stopped||revision!==generation)return;
      if(++entries>2048)throw new Error('Watch traversal limit');
      const child=join(path,entry.name),suffix=relative(directory.path,child).split(sep).join('/');
      if(ignored.has(entry.name.toLowerCase())||excluded.some(prefix=>suffix===prefix||suffix.startsWith(prefix+'/'))||entry.isSymbolicLink())continue;
      if(entry.isDirectory()){if(directory.spec.recursive&&depth<(directory.spec.maxDepth??8))await visit(child,depth+1);}
      else if(entry.isFile()){if(++count>(directory.spec.maxFiles??256))throw new Error('Watch file limit');add(map,pathFor(relative(cwd,child),snapshot),directory.hook);}
     }
    };await visit(directory.path,0);
   }
   const current=new Map<string,{fingerprint:string;hooks:HookDefinition[]}>();
   for(const [path,hooks]of map){if(stopped||revision!==generation)return;const stat=await safeStat(path,snapshot);if(stat&&!stat.isFile())throw new Error('Watched file must be regular');current.set(path,{fingerprint:stat?`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`:'',hooks});}
   if(stopped||revision!==generation)return;
   status={phase:'watching',files:current.size,scans:status.scans+1,failures:status.failures};
   if(!initialized){previous=current;initialized=true;return;}
   const before=previous;previous=current;
   for(const file of new Set([...before.keys(),...current.keys()])){
    if(stopped||revision!==generation)return;
    const was=before.get(file)?.fingerprint??'',now=current.get(file)?.fingerprint??'';
    if(was===now||options.active?.()===false)continue;
    for(const [path,rate]of rates)if(Date.now()-rate.at>60000)rates.delete(path);
    const rate=rates.get(file);if(!rate){if(rates.size>=4096){report();continue;}rates.set(file,{at:Date.now(),count:1});}else if(++rate.count>10){report();continue;}
    const selected=structuredClone(snapshot);selected.hooks=current.get(file)?.hooks??before.get(file)!.hooks;
    await notifyLifecycle(selected,cwd,'FileChanged',{...context,path:file,file_path:file,relative_path:relative(cwd,file).split(sep).join('/'),change:!was?'created':!now?'deleted':'modified',event:!was?'add':!now?'unlink':'change',source:'filesystem-watch'});
   }
   for(const [path,rate]of rates)if(!current.has(path)&&Date.now()-rate.at>60000)rates.delete(path);
  }catch{if(!stopped&&revision===generation){status={...status,phase:'blocked',failures:status.failures+1,lastError:'Watch scan or observer failed; retained baseline. Inspect paths, policy and bounded directory limits.'};report();}}
  finally{busy=false;}
 };
 try{update(config);}catch(error){targets.clear();directories=[];throw error;}
 const interval=options.intervalMs??1000;if(!Number.isSafeInteger(interval)||interval<100||interval>30000)throw new Error('Hook watch interval must be 100–30000 ms');void tick();const timer=setInterval(()=>void tick(),interval);timer.unref();
 const stop=(()=>{stopped=true;generation++;targets.clear();directories=[];previous.clear();status={...status,phase:'stopped',files:0};clearInterval(timer);}) as HookFileWatcher;
 stop.status=()=>({...status});
 stop.update=next=>{if(stopped)throw new Error('Hook watcher is stopped');try{update(next);}catch(error){targets.clear();directories=[];generation++;status={...status,phase:'blocked',lastError:'Invalid replacement watch configuration; observation stopped.'};throw error;}void tick();};return stop;
}
