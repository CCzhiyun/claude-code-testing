import {createHmac,timingSafeEqual} from 'node:crypto';
import {appendFile,lstat,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homeStateDir} from './paths.js';
import {withFileLock} from './storage.js';
interface ChainRow {sequence:number;previous:string;payload:unknown;mac:string}
const zero='0'.repeat(64);
export function auditDay(day:string):string{if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new Error('Audit day must be a valid YYYY-MM-DD date');return day;}
export function auditIntegrityEnabled():boolean{return process.env.CCPT_AUDIT_INTEGRITY==='required'||process.env.CCPT_AUDIT_HMAC_KEY!==undefined;}
function key():Buffer{const value=process.env.CCPT_AUDIT_HMAC_KEY;if(!value||!/^[a-fA-F0-9]{64,128}$/.test(value)||value.length%2)throw new Error('Audit integrity requires a 32–64 byte hex key from the credential administrator');return Buffer.from(value,'hex');}
const sign=(row:Omit<ChainRow,'mac'>,secret:Buffer)=>createHmac('sha256',secret).update(JSON.stringify(['CCPT/audit-chain/v1',row.sequence,row.previous,row.payload])).digest('hex');
async function location(day:string){const directory=join(homeStateDir(),'audit');await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())throw new Error('Audit directory must not be a link');const file=join(directory,auditDay(day)+'.chain.jsonl');try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>8_000_000)throw new Error('Audit chain file exceeds type/size bounds');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return file;}
async function rows(file:string,secret:Buffer):Promise<ChainRow[]>{
 let text:string;try{text=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 if(text&&!text.endsWith('\n'))throw new Error('Audit chain has an incomplete tail; operator recovery required');
 const result:ChainRow[]=[];for(const line of text.split('\n').filter(Boolean)){
  const row=JSON.parse(line) as ChainRow;if(result.length>=10000||row.sequence!==result.length+1||row.previous!==(result.at(-1)?.mac??zero)||typeof row.mac!=='string'||!/^[a-f0-9]{64}$/.test(row.mac)||Object.keys(row).some(k=>!['sequence','previous','payload','mac'].includes(k)))throw new Error('Audit chain structure or sequence was altered');
  const expected=sign({sequence:row.sequence,previous:row.previous,payload:row.payload},secret);if(!timingSafeEqual(Buffer.from(row.mac,'hex'),Buffer.from(expected,'hex')))throw new Error('Audit integrity verification failed');result.push(row);
 }return result;
}
export async function appendIntegrityAudit(payload:unknown,day=new Date().toISOString().slice(0,10)):Promise<void>{
 const secret=key();try{const file=await location(day);await withFileLock(file+'.lock',async()=>{await location(day);const history=await rows(file,secret);if(history.length>=10000)throw new Error('Audit segment full; archive and rotate with an externally anchored receipt');const base={sequence:history.length+1,previous:history.at(-1)?.mac??zero,payload};const line=JSON.stringify({...base,mac:sign(base,secret)})+'\n';if(Buffer.byteLength(line)>128000)throw new Error('Audit row exceeds 128 KB');let size=0;try{size=(await lstat(file)).size;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(size+Buffer.byteLength(line)>8_000_000)throw new Error('Audit segment full; operator archive required');await appendFile(file,line,{mode:0o600});});}finally{secret.fill(0);}
}
/** A separately retained anchor detects truncation. This is tamper-evident local
 * storage, not immutable hardware or a trusted central collector. */
export async function verifyIntegrityAudit(day:string,expectedTail?:string){
 if(expectedTail!==undefined&&!/^[a-f0-9]{64}$/.test(expectedTail))throw new Error('Expected audit anchor must be a SHA-256-sized hex MAC');
 const secret=key();try{const file=await location(day);return await withFileLock(file+'.lock',async()=>{const history=await rows(file,secret),tail=history.at(-1)?.mac??zero;if(expectedTail!==undefined&&tail!==expectedTail)throw new Error('Audit tail differs from the external anchor (truncation, append or wrong segment)');return {day,rows:history.length,tail,valid:true,truncationProtected:expectedTail!==undefined,centralStorageVerified:false};});}finally{secret.fill(0);}
}
export async function readIntegrityAudit(day:string):Promise<string>{const secret=key();try{const file=await location(day);return await withFileLock(file+'.lock',async()=>(await rows(file,secret)).map(row=>JSON.stringify(row.payload)).join('\n'));}finally{secret.fill(0);}}

/** Verify under the chain lock, export MACs only, never prompts/credentials/body. */
export async function integrityAuditAnchors(day:string):Promise<string[]>{const secret=key();try{const file=await location(day);return await withFileLock(file+'.lock',async()=>(await rows(file,secret)).map(row=>row.mac));}finally{secret.fill(0);}}
