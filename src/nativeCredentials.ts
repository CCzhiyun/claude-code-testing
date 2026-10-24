import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { homeStateDir } from './paths.js';
import { assertExecutionActive, controlProcess } from './executionControl.js';

export type NativeCredentialBackend = 'macos-keychain' | 'linux-secret-service';
export interface NativeCredentialInvocation { executable:string; args:string[]; input:string; missingCode?:number }
/** Pure, testable invocation builder. Secrets never appear in argv/environment.
 * macOS uses security's documented stdin command mode, with base64-only data. */
export function nativeCredentialInvocation(backend:NativeCredentialBackend,action:'read'|'write'|'remove',namespace:string,data?:Buffer,platform:NodeJS.Platform=process.platform):NativeCredentialInvocation {
  if(backend==='macos-keychain'&&platform!=='darwin'||backend==='linux-secret-service'&&platform!=='linux')throw new Error(`Credential backend ${backend} is unavailable on this OS`);
  if(!namespace||namespace.length>1000||data&&data.length>5000)throw new Error('Native credential namespace/data exceeds supported bounds (5000 bytes)');
  const id=createHash('sha256').update(`CCPT/native/v1:${resolve(homeStateDir())}:${namespace}`).digest('hex');
  const encoded=data?.toString('base64');
  if(action==='write'&&!encoded)throw new Error('Native credential value is required');
  if(backend==='macos-keychain'){
    const selectors=['-a',id,'-s','org.ccpt.credentials'];
    if(action==='write')return {executable:'/usr/bin/security',args:['-i'],input:`add-generic-password -U ${selectors.join(' ')} -w ${encoded}\n`};
    return {executable:'/usr/bin/security',args:[action==='read'?'find-generic-password':'delete-generic-password',...selectors,...(action==='read'?['-w']:[])],input:'',missingCode:44};
  }
  return {executable:'/usr/bin/secret-tool',args:[action==='write'?'store':action==='read'?'lookup':'clear',...(action==='write'?['--label=CCPT credential']:[]),'application','ccpt','namespace',id],input:action==='write'?encoded!:'',missingCode:1};
}
async function invoke(spec:NativeCredentialInvocation):Promise<{code:number;output:string;stderr:boolean}>{
  assertExecutionActive();
  const env:NodeJS.ProcessEnv={};
  for(const key of ['HOME','USER','LOGNAME','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR','DISPLAY','WAYLAND_DISPLAY'])if(process.env[key])env[key]=process.env[key];
  return new Promise((yes,no)=>{
    const child=spawn(spec.executable,spec.args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env});
    const control=controlProcess(child,15000);const chunks:Buffer[]=[];let bytes=0,stderr=false,invalid=false;
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>16000){invalid=true;child.kill();}else chunks.push(chunk);});
    child.stderr.on('data',()=>{stderr=true;});child.stdin.on('error',()=>{});
    child.once('error',()=>{control.dispose();no(new Error('Native credential helper unavailable; plaintext fallback is forbidden'));});
    child.once('close',code=>{control.dispose();if(control.error()||invalid){no(new Error('Native credential helper cancelled, timed out or exceeded output bounds'));return;}yes({code:code??1,output:Buffer.concat(chunks).toString('utf8').trim(),stderr});});
    child.stdin.end(spec.input);
  });
}
export async function readNativeCredential(backend:NativeCredentialBackend,namespace:string):Promise<Buffer|undefined>{
  const spec=nativeCredentialInvocation(backend,'read',namespace),result=await invoke(spec);
  // macOS not-found has a documented OSStatus-derived exit code; Linux only
  // treats silent lookup miss as absence. Service/locked-store errors fail closed.
  if(result.code===spec.missingCode&&!result.output&&(backend==='macos-keychain'||!result.stderr))return undefined;
  if(result.code!==0||!result.output||!(/^[A-Za-z0-9+/]+={0,2}$/.test(result.output)))throw new Error('Native credential lookup failed');
  const value=Buffer.from(result.output,'base64');
  if(value.length>5000||value.toString('base64')!==result.output){value.fill(0);throw new Error('Invalid native credential envelope');}
  return value;
}
export async function writeNativeCredential(backend:NativeCredentialBackend,namespace:string,data:Buffer):Promise<void>{
  const result=await invoke(nativeCredentialInvocation(backend,'write',namespace,data));
  if(result.code!==0)throw new Error('Native credential write failed');
  const actual=await readNativeCredential(backend,namespace);
  try{if(!actual||actual.length!==data.length||!timingSafeEqual(actual,data))throw new Error('Native credential read-back verification failed');}finally{actual?.fill(0);}
}
export async function removeNativeCredential(backend:NativeCredentialBackend,namespace:string):Promise<void>{
  const spec=nativeCredentialInvocation(backend,'remove',namespace),result=await invoke(spec);
  if(result.code!==0&&!(result.code===spec.missingCode&&(backend==='macos-keychain'||!result.stderr)))throw new Error('Native credential removal failed');
}
