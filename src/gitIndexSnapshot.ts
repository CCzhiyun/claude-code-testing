import {lstat,readFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {executeCommand,protectPath} from './policy.js';
import type {PlatformConfig} from './types.js';
export async function boundedIndexBytes(path:string){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024)throw new Error('Unsupported Git index type/size');
 const bytes=await readFile(path);if(bytes.length>64*1024*1024||bytes.length<12||bytes.subarray(0,4).toString()!=='DIRC'||![2,3,4].includes(bytes.readUInt32BE(4)))throw new Error('Invalid or oversized Git index');return bytes;
}
/** Parse entry boundaries before reading extensions: a blob/path containing
 * "link" is not an extension. v2/v3 padding and v4 prefix encoding differ. */
export function indexSharedObject(bytes:Buffer):string|undefined {
 const hashBytes=[20,32].find(length=>bytes.length>=12+length&&createHash(length===20?'sha1':'sha256').update(bytes.subarray(0,-length)).digest().equals(bytes.subarray(-length)));
 if(!hashBytes)throw new Error('Git index checksum mismatch');
 const version=bytes.readUInt32BE(4),count=bytes.readUInt32BE(8),end=bytes.length-hashBytes;let offset=12;
 if(bytes.subarray(0,4).toString()!=='DIRC'||![2,3,4].includes(version)||count>1_000_000)throw new Error('Unsupported Git index header');
 for(let entry=0;entry<count;entry++){
  const start=offset,fixed=40+hashBytes+2;if(offset+fixed>end)throw new Error('Truncated Git index entry');
  const flags=bytes.readUInt16BE(offset+40+hashBytes);offset+=fixed;
  if(flags&0x4000){if(version<3||offset+2>end)throw new Error('Invalid extended index entry');offset+=2;}
  if(version===4){let width=0;for(;;){if(offset>=end||++width>10)throw new Error('Invalid v4 index prefix');if(!(bytes[offset++]!&0x80))break;}}
  const nul=bytes.indexOf(0,offset);if(nul<offset||nul>=end)throw new Error('Unterminated Git index path');offset=nul+1;
  if(version!==4)offset=start+Math.ceil((offset-start)/8)*8;
  if(offset>end)throw new Error('Truncated Git index padding');
 }
 let shared:string|undefined,seen=false;
 while(offset<end){if(offset+8>end)throw new Error('Truncated Git index extension');const signature=bytes.subarray(offset,offset+4).toString(),length=bytes.readUInt32BE(offset+4);offset+=8;if(length>end-offset)throw new Error('Invalid Git index extension size');
  if(signature==='link'){if(seen||length<hashBytes)throw new Error('Invalid shared-index extension');seen=true;const oid=bytes.subarray(offset,offset+hashBytes).toString('hex');if(!/^0+$/.test(oid))shared=oid;}
  offset+=length;
 }
 return shared;
}
/** Shared indexes are immutable Git checksum objects. Keep their full bytes,
 * not merely a split-index indirection file masquerading as a backup. */
export async function sharedIndexSnapshot(cwd:string,config:PlatformConfig,index:Buffer){
 const oid=indexSharedObject(index);if(!oid)return undefined;
 const result=await executeCommand('git',['rev-parse','--git-path',`sharedindex.${oid}`],cwd,config);if(result.code!==0)throw new Error('Cannot locate shared Git index');
 const lexical=resolve(cwd,result.stdout.trim()),path=protectPath(lexical,config);
 if((process.platform==='win32'?lexical.toLowerCase():lexical)!==(process.platform==='win32'?path.toLowerCase():path))throw new Error('Shared index must not traverse links');
 const name=basename(path),match=/^sharedindex\.([a-f0-9]{40}|[a-f0-9]{64})$/.exec(name);if(!match)throw new Error('Invalid shared index object name');
 const bytes=await boundedIndexBytes(path),length=match[1]!.length/2;
 if(bytes.length<12+length||bytes.subarray(-length).toString('hex')!==match[1]||createHash(length===20?'sha1':'sha256').update(bytes.subarray(0,-length)).digest('hex')!==match[1])throw new Error('Shared index checksum mismatch; retained working/index bytes');
 return {path,name,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
