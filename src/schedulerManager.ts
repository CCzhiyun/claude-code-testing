import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import type {PlatformConfig} from './types.js';
export interface SchedulerManagerBinding {path:string;sha256:string}
export async function inspectManagerFile(path:string):Promise<SchedulerManagerBinding>{
 if(!isAbsolute(path)||/[\x00-\x1f\x7f]/.test(path)||path.length>8000)throw new Error('Scheduler manager requires an absolute executable path');
 const canonical=await realpath(path),info=await lstat(canonical);
 if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024*1024)throw new Error('Scheduler manager must be a bounded regular executable');
 if(process.platform!=='win32'){
  if(!(info.mode&0o111))throw new Error('Scheduler manager is not executable');
  let parent=canonical;for(;;){const stat=await lstat(parent);if(stat.uid!==0||(stat.mode&0o022))throw new Error('Scheduler manager and parents must be root-owned and not group/world writable');const next=dirname(parent);if(next===parent)break;parent=next;}
 }
 const bytes=await readFile(canonical);if(bytes.length>32*1024*1024)throw new Error('Scheduler manager grew beyond bounds');
 return {path:canonical,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function bindSchedulerManager(config:PlatformConfig,platform:'linux'|'darwin'){
 return inspectManagerFile(platform==='linux'?(config.schedulerManagers?.systemctl??'/usr/bin/systemctl'):(config.schedulerManagers?.launchctl??'/bin/launchctl'));
}
export async function schedulerManagerPath(job:{platform?:string;manager?:SchedulerManagerBinding}):Promise<string>{
 const path=job.manager?.path??(job.platform==='linux'?'/usr/bin/systemctl':'/bin/launchctl'),actual=await inspectManagerFile(path);
 if(job.manager&&(actual.path!==job.manager.path||actual.sha256!==job.manager.sha256))throw new Error('Scheduler manager bytes/path changed; explicitly prepare a new job');
 return actual.path;
}
