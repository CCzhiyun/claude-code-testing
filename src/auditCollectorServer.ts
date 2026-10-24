import http from 'node:http';
import https from 'node:https';
import {createHash,createPrivateKey,createPublicKey,timingSafeEqual} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {acceptAuditCheckpoint,readCollectorCheckpoint} from './auditCheckpoint.js';
export interface AuditCollectorServerConfig {
 storageDirectory:string;signingKeyFile:string;keyId:string;
 streams:Record<string,{tokenEnv:string}>;
 tls?:{certFile:string;keyFile:string;caFile?:string;requireClientCert?:boolean};
 /** Only local development, enforced on socket local AND remote addresses. */
 allowLoopbackHttp?:boolean;
 administratorControlledStorage:true;
}
const identity=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(v);
async function localFile(path:string,secret=false){if(typeof path!=='string'||!isAbsolute(path)||path.startsWith('\\\\')||path.startsWith('//'))throw new Error('Collector key/certificate paths must be absolute local files');for(let p=path;;p=dirname(p)){const s=await lstat(p);if(s.isSymbolicLink()||p===path&&(!s.isFile()||s.size>128000))throw new Error('Invalid collector key/certificate path');if(p===path&&secret&&process.platform!=='win32'&&(s.mode&0o077))throw new Error('Collector private keys require owner-only file permissions');if(dirname(p)===p)break;}const b=await readFile(path);if(b.length>128000)throw new Error('Collector key/certificate exceeds bounds');return b;}
const loopback=(v:string|undefined)=>v==='127.0.0.1'||v==='::1'||v==='::ffff:127.0.0.1';
/** Authenticated reference HTTP bridge for externally anchored MCP audit MACs.
 * Never starts listening implicitly, executes tools, accepts a private signing
 * key over HTTP, exports client audit bodies or claims WORM/hardware isolation. */
export async function createAuditCollectorServer(input:AuditCollectorServerConfig){
 const c=structuredClone(input);if(!c||c.administratorControlledStorage!==true||!isAbsolute(c.storageDirectory)||c.storageDirectory.startsWith('\\\\')||c.storageDirectory.startsWith('//')||!identity(c.keyId)||!c.streams||Array.isArray(c.streams)||!Object.keys(c.streams).length||Object.keys(c.streams).length>64||Object.entries(c.streams).some(([k,v])=>!identity(k)||!v||Object.keys(v).some(f=>f!=='tokenEnv')||typeof v.tokenEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v.tokenEnv)))throw new Error('Collector requires explicit administrator-owned storage and bounded stream/token-env grants');
 if(Object.keys(c).some(k=>!['storageDirectory','signingKeyFile','keyId','streams','tls','allowLoopbackHttp','administratorControlledStorage'].includes(k))||c.allowLoopbackHttp!==undefined&&typeof c.allowLoopbackHttp!=='boolean'||c.tls&&(!c.tls||typeof c.tls!=='object'||Array.isArray(c.tls)||Object.keys(c.tls).some(k=>!['certFile','keyFile','caFile','requireClientCert'].includes(k))||c.tls.requireClientCert!==undefined&&typeof c.tls.requireClientCert!=='boolean'))throw new Error('Invalid collector TLS or security configuration; unknown fields are not ignored');
 if(!c.tls&&c.allowLoopbackHttp!==true)throw new Error('Collector requires TLS; HTTP is explicit loopback development only');
 const privateKey=(await localFile(c.signingKeyFile,true)).toString('utf8'),key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ed25519')throw new Error('Collector signing key must be Ed25519');const publicKey=createPublicKey(key).export({type:'spki',format:'pem'}).toString();
 const credential=(name:string)=>{const v=process.env[name];if(!v||v.length<16||v.length>8000||/[\x00-\x20\x7f]/.test(v))throw new Error('Collector stream credential is missing or invalid');return createHash('sha256').update(v).digest()};for(const value of Object.values(c.streams))credential(value.tokenEnv);
 let active=0;const rates=new Map<string,{at:number;count:number}>();
 const handler=(req:http.IncomingMessage,res:http.ServerResponse)=>{void(async()=>{
  const send=(status:number,value:unknown)=>{if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  if(req.headers.origin||!c.tls&&(!loopback(req.socket.localAddress)||!loopback(req.socket.remoteAddress))){send(403,{error:'Request origin or transport is not permitted'});return;}
  let url:URL;try{url=new URL(req.url??'','https://collector.invalid')}catch{send(400,{error:'Invalid request'});return;}
  if(url.pathname!=='/checkpoints'||!['POST','GET'].includes(req.method??'')){send(404,{error:'Unknown endpoint'});return;}
  const auth=req.headers.authorization;if(typeof auth!=='string'||!auth.startsWith('Bearer ')||auth.length>8010){send(401,{error:'Unauthorized'});return;}
  const received=createHash('sha256').update(auth.slice(7)).digest(),allowed=new Set<string>();try{for(const [stream,grant]of Object.entries(c.streams))if(timingSafeEqual(received,credential(grant.tokenEnv)))allowed.add(stream);}catch{send(503,{error:'Collector credential unavailable'});return;}
  if(!allowed.size){send(401,{error:'Unauthorized'});return;}
  const ip=req.socket.remoteAddress??'unknown',now=Date.now();for(const [k,v]of rates)if(now-v.at>60000)rates.delete(k);if(!rates.has(ip)&&rates.size>=128){send(429,{error:'Collector rate capacity'});return;}let rate=rates.get(ip);if(!rate){rate={at:now,count:0};rates.set(ip,rate);}if(++rate.count>120||active>=32){send(429,{error:'Collector rate limit'});return;}
  active++;try{
   if(req.method==='GET'){
    if([...url.searchParams.keys()].some(k=>!['stream','day'].includes(k))||url.searchParams.getAll('stream').length!==1||url.searchParams.getAll('day').length!==1){send(400,{error:'Invalid checkpoint query'});return;}
    const stream=url.searchParams.get('stream')!,day=url.searchParams.get('day')!;if(!allowed.has(stream)){send(403,{error:'Stream access denied'});return;}const receipt=await readCollectorCheckpoint(c.storageDirectory,stream,day,publicKey,c.keyId);send(receipt?200:404,receipt??{error:'No checkpoint'});
   }else{
    if(url.search||String(req.headers['content-type']??'').split(';')[0]!.trim().toLowerCase()!=='application/json'||Number(req.headers['content-length']??0)>800000){send(400,{error:'Invalid checkpoint body'});return;}
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>800000){send(413,{error:'Checkpoint exceeds bounds'});req.resume();return;}chunks.push(b);}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!body||!allowed.has(body.stream)){send(403,{error:'Stream access denied'});return;}
    const operationId=createHash('sha256').update(JSON.stringify(['CCPT/audit-checkpoint-request/v1',body.stream,body.day,body.anchors])).digest('hex');
    if(req.headers['idempotency-key']!==operationId){send(409,{error:'Idempotency binding mismatch; no checkpoint was written'});return;}
    const receipt=await acceptAuditCheckpoint(c.storageDirectory,body,privateKey,c.keyId);send(200,receipt);
   }
  }catch{send(400,{error:'Checkpoint validation or storage failed; query before retrying an uncertain publish'});}finally{active--;}
 })().catch(()=>{if(!res.destroyed){res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Collector unavailable"}')}});};
 let server:http.Server|https.Server;
 if(c.tls){if(c.tls.requireClientCert&&!c.tls.caFile)throw new Error('mTLS collector requires an explicit trusted client CA');server=https.createServer({cert:await localFile(c.tls.certFile),key:await localFile(c.tls.keyFile,true),...(c.tls.caFile?{ca:await localFile(c.tls.caFile)}:{}),requestCert:c.tls.requireClientCert===true,rejectUnauthorized:true,minVersion:'TLSv1.2'},handler);}else server=http.createServer(handler);
 server.headersTimeout=5000;server.requestTimeout=15000;server.timeout=15000;server.maxHeadersCount=32;server.maxRequestsPerSocket=100;
 return {server,publicKey,keyId:c.keyId,centralImmutableStorageVerified:false as const};
}
