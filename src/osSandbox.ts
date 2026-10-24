import {lstat,readdir,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename,join,parse,resolve,relative,sep} from 'node:path';
import type {PlatformConfig} from './types.js';
import {assertWithinRoots} from './paths.js';

/** No runtime download, PATH-based backend resolution or unsandboxed fallback.
 * Only system binaries/libs and the current workspace are mounted. Network is
 * always isolated in this first backend, regardless of host allowNetwork. */
export async function isolatedCommand(command:string,args:string[],cwd:string,config:PlatformConfig):Promise<{command:string;args:string[]}>{
 const wrapper=config.policy.processWrapper;
 const invocation={command:wrapper??command,args:wrapper?[command,...args]:args};
 if(!config.policy.osSandbox)return invocation;
 if(process.platform!=='linux')throw new Error('linux-bubblewrap sandbox requires Linux; no unsandboxed fallback');
 const executable='/usr/bin/bwrap';const info=await lstat(executable);if(!info.isFile()||info.isSymbolicLink()||info.mode&0o022)throw new Error('Sandbox executable must be a non-writable system regular file');
 const root=await realpath(assertWithinRoots(cwd,config.policy.workspaceRoots));
 if(root===parse(root).root||root===await realpath(homedir())||root!==resolve(cwd))throw new Error('Sandbox requires a dedicated non-link workspace, not a home/filesystem root');
 const masks:Array<{path:string;directory:boolean}>=[];let visited=0;
 const scan=async(path:string,depth:number):Promise<void>=>{
   if(++visited>10000||depth>24)throw new Error('Sandbox protected-path scan limit reached; no command launched');
   const stat=await lstat(path),name=basename(path);
   const protectedPath=['.ccpt','.git'].includes(name)||config.policy.protectedPatterns.some(pattern=>path.toLowerCase().includes(pattern.replaceAll('\\','/').toLowerCase()));
   if(protectedPath){if(stat.isSymbolicLink())throw new Error('Sandbox protected path must not be a link');masks.push({path,directory:stat.isDirectory()});return;}
   if(stat.isDirectory()&&!stat.isSymbolicLink())for(const entry of await readdir(path))await scan(join(path,entry),depth+1);
 };
 for(const name of await readdir(root))await scan(join(root,name),0);
 const mounted=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/tmp','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/run'];
 for(const system of ['/usr','/bin','/lib','/lib64'])try{await lstat(system);mounted.push('--ro-bind',system,system);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 mounted.push('--bind',root,root,'--chdir',root);
 for(const mask of masks){if(relative(root,mask.path).startsWith('..'+sep))throw new Error('Invalid sandbox mask');mounted.push(...(mask.directory?['--tmpfs',mask.path]:['--ro-bind','/dev/null',mask.path]));}
 return {command:executable,args:[...mounted,'--',invocation.command,...invocation.args]};
}
