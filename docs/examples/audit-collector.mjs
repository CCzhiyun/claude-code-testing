// Reference ONLY: authenticated loopback HTTP behind an administrator-managed
// HTTPS reverse proxy on a SEPARATE trusted host. Not WORM, a daemon installer,
// a key vault, or enterprise acceptance. Never expose this loopback port directly.
import http from 'node:http';
import {createHash,timingSafeEqual,createPrivateKey,createPublicKey} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {acceptAuditCheckpoint,readCollectorCheckpoint} from 'ccpt/sdk';
const {CCPT_COLLECTOR_TOKEN:token,CCPT_COLLECTOR_KEY_FILE:keyFile,CCPT_COLLECTOR_STORE:store,CCPT_COLLECTOR_STREAMS:streamsText,CCPT_COLLECTOR_KEY_ID:keyId='collector'}=process.env;
if(!token||token.length<24||!keyFile||!store||!streamsText)throw new Error('Configure separate collector token, private-key file, store and explicitly allowed streams');
const info=await lstat(keyFile);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)throw new Error('Invalid collector signing-key file');
const privateKey=await readFile(keyFile,'utf8'),key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ed25519')throw new Error('Collector key must be Ed25519');
const publicKey=createPublicKey(key).export({type:'spki',format:'pem'}).toString(),streams=new Set(streamsText.split(','));
if([...streams].some(s=>!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(s)))throw new Error('Invalid collector stream allowlist');
const secret=createHash('sha256').update('Bearer '+token).digest(),port=Number(process.env.CCPT_COLLECTOR_PORT??8788);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Invalid collector port');
let active=0;
const server=http.createServer(async(req,res)=>{
 const reply=(status,body)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}};
 if(active>=16){reply(503,{error:'busy; query unknown results'});return;}
 if(!timingSafeEqual(secret,createHash('sha256').update(req.headers.authorization??'').digest())){reply(401,{error:'unauthorized'});req.resume();return;}
 active++;
 try{
  const url=new URL(req.url??'/','http://127.0.0.1');if(!url.pathname.endsWith('/checkpoints')){reply(404,{error:'not found'});return;}
  let receipt;
  if(req.method==='POST'){
   const chunks=[];let size=0;for await(const chunk of req){if((size+=chunk.length)>800000){reply(413,{error:'too large'});req.destroy();return;}chunks.push(chunk);}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!streams.has(input.stream)){reply(403,{error:'stream denied'});return;}
   receipt=await acceptAuditCheckpoint(store,input,privateKey,keyId);
  }else if(req.method==='GET'){
   const stream=url.searchParams.get('stream'),day=url.searchParams.get('day');if(!streams.has(stream)){reply(403,{error:'stream denied'});return;}
   receipt=await readCollectorCheckpoint(store,stream,day,publicKey,keyId);
  }else{reply(405,{error:'method denied'});return;}
  reply(receipt?200:404,receipt??{error:'no checkpoint'});
 }catch{reply(409,{error:'invalid/divergent checkpoint or collector storage failure; investigate without replay'});}
 finally{active--;}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=32;
server.listen(port,'127.0.0.1',()=>console.log('Reference collector listening on loopback; deploy authenticated HTTPS proxy separately.'));
