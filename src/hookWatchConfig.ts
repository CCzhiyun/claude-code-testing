import {isAbsolute} from 'node:path';
import type {HookDefinition} from './types.js';
export function watchRelativePath(value:unknown):value is string {
 return typeof value==='string'&&value.length>0&&value.length<=1024&&!isAbsolute(value)&&!/[\x00-\x1f\x7f*?{}\[\]:]/.test(value)&&!value.split(/[\\/]/).includes('..');
}
export function validateHookWatch(hook:HookDefinition):void {
 if(hook.watchPaths!==undefined&&(hook.event!=='FileChanged'||!Array.isArray(hook.watchPaths)||hook.watchPaths.length>64||hook.watchPaths.some(path=>!watchRelativePath(path))))throw new Error('watchPaths requires FileChanged and at most 64 explicit relative filenames');
 if(hook.watchDirectories===undefined)return;
 if(hook.event!=='FileChanged'||!Array.isArray(hook.watchDirectories)||hook.watchDirectories.length>8)throw new Error('watchDirectories requires FileChanged and at most eight explicit directories');
 for(const entry of hook.watchDirectories){
  if(!entry||typeof entry!=='object'||Object.keys(entry).some(key=>!['path','recursive','maxFiles','maxDepth','exclude'].includes(key))||!watchRelativePath(entry.path)||entry.recursive!==undefined&&typeof entry.recursive!=='boolean'||entry.maxFiles!==undefined&&(!Number.isSafeInteger(entry.maxFiles)||entry.maxFiles<1||entry.maxFiles>512)||entry.maxDepth!==undefined&&(!Number.isSafeInteger(entry.maxDepth)||entry.maxDepth<0||entry.maxDepth>16)||entry.exclude!==undefined&&(!Array.isArray(entry.exclude)||entry.exclude.length>32||entry.exclude.some(path=>!watchRelativePath(path))))throw new Error('Invalid bounded watchDirectories declaration');
 }
}
