import {createHash} from 'node:crypto';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';

export interface LauncherBinding {path:string;sha256:string;files?:Array<{path:string;sha256:string;bytes:number}>}
/** Administrator-declared closed dependency trees, including data/known_hosts.
 * No links, glob exclusions or executable discovery. Does not claim the OS DLL
 * loader, remote code or credentials outside the declared trees are isolated. */
export async function bindLauncher(path:string|undefined,dependencies:string[]=[]):Promise<LauncherBinding>{
 const local=(p:unknown):p is string=>typeof p==='string'&&isAbsolute(p)&&!p.startsWith('\\\\')&&!p.startsWith('//')&&!/[\x00-\x1f]/.test(p);
 if(!local(path))throw new Error('SSH recovery backup requires an absolute enterprise processWrapper (local paths only)');
 if(!Array.isArray(dependencies)||dependencies.length>16||dependencies.some(p=>!local(p))||new Set(dependencies.map(p=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p))).size!==dependencies.length)throw new Error('Invalid launcher dependency roots');
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>8*1024*1024||await realpath(path)!==resolve(path))throw new Error('SSH wrapper must be a regular canonical executable');
 const bytes=await readFile(path);if(bytes.length>8*1024*1024)throw new Error('SSH wrapper exceeds bounds');const files:NonNullable<LauncherBinding['files']>=[],seen=new Set<string>();let total=0,entries=0;
 async function visit(file:string,depth:number):Promise<void>{if(depth>16||++entries>1024)throw new Error('Launcher dependency tree exceeds bounded depth/entries');const stat=await lstat(file);if(stat.isSymbolicLink()||await realpath(file)!==resolve(file))throw new Error('Launcher dependencies cannot traverse links');if(stat.isDirectory()){for(const name of(await readdir(file)).sort())await visit(join(file,name),depth+1);return;}
  const canonical=resolve(file),key=process.platform==='win32'?canonical.toLowerCase():canonical;if(seen.has(key))throw new Error('Overlapping launcher dependency roots');seen.add(key);if(!stat.isFile()||stat.size>8*1024*1024||(total+=stat.size)>32*1024*1024||files.length>=256)throw new Error('Launcher dependency file/size limit');const content=await readFile(file);if(content.length!==stat.size)throw new Error('Launcher dependency changed during review');files.push({path:canonical,sha256:createHash('sha256').update(content).digest('hex'),bytes:content.length});
 }
 for(const dependency of dependencies)await visit(dependency,0);files.sort((a,b)=>a.path.localeCompare(b.path));
 return {path:resolve(path),sha256:createHash('sha256').update(bytes).digest('hex'),...(dependencies.length?{files}:{})};
}
