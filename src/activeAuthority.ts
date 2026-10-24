import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { extensionAuthorityWatchPaths } from './localStateWatch.js';
import { readUtf8Text } from './textFiles.js';
import { HookDecisionError } from './hooks.js';
import {projectStateDir} from './paths.js';
import {join} from 'node:path';
/** Snapshot authority bytes, not just timestamps. Never logs config contents or
 * kills an already-running external process. Changes require a fresh worker. */
export async function authoritySnapshot(cwd:string):Promise<string>{
 const hash=createHash('sha256');const paths=[...extensionAuthorityWatchPaths(cwd),join(projectStateDir(cwd),'plugin-sets/active.json'),...(process.env.CCPT_MANAGED_CONFIG?[process.env.CCPT_MANAGED_CONFIG]:[])];
 for(const path of paths){hash.update(path);try{const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024)throw new Error('Invalid authority file');hash.update(await readUtf8Text(path,1024*1024));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')hash.update('missing');else throw error;}}
 return hash.digest('hex');
}
export async function assertAuthorityUnchanged(cwd:string,expected:string){
 try{if(await authoritySnapshot(cwd)===expected)return;}catch{}
 throw new HookDecisionError('ConfigChange','Configuration/extension authority changed during execution. Conversation preserved; inspect the new policy and continue with a fresh worker.',false);
}
