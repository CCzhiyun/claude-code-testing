import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { auditDay, integrityAuditAnchors } from './auditIntegrity.js';
import { withFileLock, writeJson } from './storage.js';
import { loadConfig } from './config.js';
import { networkRequest } from './network.js';
import { projectStateDir } from './paths.js';
import { safePluginStatePath } from './pluginHistory.js';
import { isWorkspaceTrusted } from './workspaceTrust.js';

export interface AuditCollectorConfig {
  url: string; stream: string; keyId: string; publicKey: string; tokenEnv: string;
  /** Test/developer collector only. Never permits HTTP on a non-loopback host. */
  allowLoopbackHttp?: boolean;
}
export interface AuditCheckpointRequest { format: 1; stream: string; day: string; anchors: string[] }
export interface AuditCheckpointReceipt {
  format: 1; stream: string; day: string; rows: number; tail: string;
  operationId: string; keyId: string; at: string; signature: string;
}
const zero = '0'.repeat(64), hex = /^[a-f0-9]{64}$/;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = (value: string) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value);
const bytes = (row: Omit<AuditCheckpointReceipt, 'signature'>) => Buffer.from(JSON.stringify(['CCPT/audit-checkpoint/v1',row.format,row.stream,row.day,row.rows,row.tail,row.operationId,row.keyId,row.at]));
function request(value: AuditCheckpointRequest) {
  if (!value || value.format !== 1 || !identity(value.stream) || !Array.isArray(value.anchors) || value.anchors.length > 10000 || value.anchors.some(mac => typeof mac !== 'string' || !hex.test(mac)) || Object.keys(value).some(key => !['format','stream','day','anchors'].includes(key))) throw new Error('Invalid audit checkpoint request');
  auditDay(value.day);
  return { rows: value.anchors.length, tail: value.anchors.at(-1) ?? zero, operationId: digest(['CCPT/audit-checkpoint-request/v1',value.stream,value.day,value.anchors]) };
}
export function verifyAuditCheckpoint(receipt: AuditCheckpointReceipt, publicKey: string, keyId: string) {
  if (!receipt || receipt.format !== 1 || !identity(receipt.stream) || receipt.keyId !== keyId || !identity(keyId) || !Number.isSafeInteger(receipt.rows) || receipt.rows < 0 || receipt.rows > 10000 || !hex.test(receipt.tail) || !hex.test(receipt.operationId) || typeof receipt.at !== 'string' || !Number.isFinite(Date.parse(receipt.at)) || typeof receipt.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(receipt.signature) || Object.keys(receipt).length !== 9) throw new Error('Invalid collector receipt');
  auditDay(receipt.day);
  const key = createPublicKey(publicKey), { signature, ...base } = receipt;
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, bytes(base), key, Buffer.from(signature,'base64'))) throw new Error('Collector receipt signature verification failed');
  return receipt;
}
function matches(receipt: AuditCheckpointReceipt, stream: string, day: string, anchors: string[]) {
  if (receipt.stream !== stream || receipt.day !== day || receipt.rows > anchors.length || receipt.tail !== (receipt.rows ? anchors[receipt.rows-1] : zero)) throw new Error('Audit rollback/divergence detected against externally signed checkpoint');
}
async function receiptFile(directory: string, stream: string, day: string) {
  if (!identity(stream)) throw new Error('Invalid audit stream'); auditDay(day);
  // Check existing ancestors BEFORE recursive creation, not just the leaf.
  for(let path=resolve(directory);;path=dirname(path)){
    try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Collector storage must not traverse links or files');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(dirname(path)===path)break;
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error('Collector storage must be a real administrator-owned directory');
  const file = join(directory, digest([stream,day])+'.json');
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 16000) throw new Error('Invalid collector receipt storage'); }
  catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return file;
}
async function readReceipt(file: string, publicKey: string, keyId: string): Promise<AuditCheckpointReceipt | null> {
  try { const info=await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size>16000) throw new Error('Invalid collector receipt storage'); const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>16000)throw new Error('Collector receipt exceeds limit');return verifyAuditCheckpoint(JSON.parse(text), publicKey, keyId); }
  catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Reference collector storage primitive, not a public HTTP/authentication server.
 * Host it on a separate trusted machine behind authenticated TLS. Caller MUST
 * authenticate and authorize stream ownership before calling. No HMAC key leaves
 * the client. Signed receipts anchor history; this is not WORM/hardware storage. */
export async function acceptAuditCheckpoint(directory: string, input: AuditCheckpointRequest, privateKey: string, keyId: string) {
  input=structuredClone(input);const info=request(input), key=createPrivateKey(privateKey);
  if (key.asymmetricKeyType!=='ed25519' || !identity(keyId)) throw new Error('Collector requires an Ed25519 signing identity');
  const publicKey=createPublicKey(key).export({type:'spki',format:'pem'}).toString(), file=await receiptFile(directory,input.stream,input.day);
  return withFileLock(file+'.lock',async()=>{
    const previous=await readReceipt(file,publicKey,keyId);
    if(previous){matches(previous,input.stream,input.day,input.anchors);if(previous.operationId===info.operationId)return previous;}
    const base={format:1 as const,stream:input.stream,day:input.day,...info,keyId,at:new Date().toISOString()};
    const next:AuditCheckpointReceipt={...base,signature:sign(null,bytes(base),key).toString('base64')};
    await writeJson(file,next);return next;
  });
}
export async function readCollectorCheckpoint(directory: string, stream: string, day: string, publicKey: string, keyId: string) {
  const file=await receiptFile(directory,stream,day);
  return withFileLock(file+'.lock',()=>readReceipt(file,publicKey,keyId));
}

function endpoint(config: AuditCollectorConfig) {
  if (!config || !identity(config.stream) || !identity(config.keyId) || typeof config.tokenEnv!=='string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(config.tokenEnv)) throw new Error('Invalid audit collector configuration');
  const url=new URL(config.url);
  if(url.username||url.password||url.search||url.hash|| !(url.protocol==='https:' || config.allowLoopbackHttp===true && url.protocol==='http:' && ['127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Collector requires a pinned HTTPS base URL without credentials/query/fragment');
  const key=createPublicKey(config.publicKey);if(key.asymmetricKeyType!=='ed25519')throw new Error('Pin an Ed25519 collector public key');
  url.pathname=url.pathname.replace(/\/$/,'')+'/checkpoints';return url;
}
/** Explicit authenticated network operation. Never automatically retries a POST
 * whose result is unknown: use mode=query to verify the remote signed checkpoint. */
export async function syncAuditCheckpoint(cwd: string, collector: AuditCollectorConfig, day: string, mode: 'publish' | 'query', confirmed: boolean, signal?: AbortSignal) {
  if(!confirmed)throw new Error('Audit collector network access requires --confirm');
  collector=structuredClone(collector);const url=endpoint(collector);auditDay(day);
  if(!['publish','query'].includes(mode))throw new Error('Audit checkpoint mode must be publish or query');
  const config=await loadConfig(cwd);
  if(config.policy.mode==='restricted'||!config.policy.allowNetwork||!config.network.rejectUnauthorized||!await isWorkspaceTrusted(cwd))throw new Error('Audit collector requires workspace trust, network permission and verified TLS');
  const token=process.env[collector.tokenEnv];if(!token||/[\r\n]/.test(token)||token.length>8000)throw new Error('Audit collector credential environment variable is not configured or invalid');
  const anchors=await integrityAuditAnchors(day), body:AuditCheckpointRequest={format:1,stream:collector.stream,day,anchors}, info=request(body);
  const scope=digest([collector.url,collector.stream,collector.keyId,collector.publicKey]), path=join(projectStateDir(cwd),'audit-checkpoints',scope+'-'+day+'.json');
  await safePluginStatePath(cwd,path);
  const local=await readReceipt(path,collector.publicKey,collector.keyId);if(local)matches(local,collector.stream,day,anchors);
  if(mode==='query'){url.searchParams.set('stream',collector.stream);url.searchParams.set('day',day);}
  let response;
  try { response=await networkRequest(url.toString(),{method:mode==='publish'?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(mode==='publish'?{'Idempotency-Key':info.operationId}:{})},...(mode==='publish'?{body:JSON.stringify(body)}:{}),maxResponseBytes:16000,deadlineMs:15000,...(signal?{signal}:{})},config.network); }
  catch { throw new Error('Collector request interrupted or failed; POST result may be unknown. Query the signed checkpoint before retrying.'); }
  if(response.status===404&&mode==='query'&&!local)return {anchored:false,mode,centralImmutableStorageVerified:false};
  if(response.status!==200)throw new Error(`Collector rejected checkpoint (${response.status}); ${response.status>=500?'POST result may be unknown; query the signed checkpoint. ':''}No automatic replay`);
  let receipt:AuditCheckpointReceipt;try{receipt=verifyAuditCheckpoint(JSON.parse(response.text),collector.publicKey,collector.keyId);}catch{throw new Error('Collector returned an invalid or untrusted signed receipt');}
  matches(receipt,collector.stream,day,anchors);
  if(mode==='publish'&&receipt.operationId!==info.operationId)throw new Error('Collector receipt does not acknowledge the submitted operation');
  await withFileLock(path+'.lock',async()=>{
    await safePluginStatePath(cwd,path);
    const previous=await readReceipt(path,collector.publicKey,collector.keyId),latest=await integrityAuditAnchors(day);
    matches(receipt,collector.stream,day,latest);
    if(previous&&(previous.rows>receipt.rows||previous.rows===receipt.rows&&previous.tail!==receipt.tail))throw new Error('Collector rolled back a previously retained checkpoint');
    await writeJson(path,receipt);
  });
  return {anchored:true,mode,receipt,localRollbackChecked:true,centralImmutableStorageVerified:false,exportedPayloads:false};
}
