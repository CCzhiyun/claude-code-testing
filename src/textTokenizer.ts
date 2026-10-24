import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {isAbsolute,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {Tiktoken} from 'js-tiktoken/lite';
import type {PlatformConfig,ContentBlock} from './types.js';
import {estimateTokens} from './tokenUsage.js';
export type TextEncoding='cl100k_base'|'o200k_base';
const require=createRequire(import.meta.url),encoders=new Map<TextEncoding,Tiktoken>(),counts=new Map<string,number>();
type Vocabulary=NonNullable<PlatformConfig['model']['tokenizerVocabulary']>;
const privateEncoders=new Map<string,Tiktoken>();
const customVocabularies=new Map<string,{pat_str:string;special_tokens:Record<string,number>;bpe_ranks:string}>();
export function validateTokenizerVocabulary(value:Vocabulary):void{
 if(!value||typeof value!=='object'||Object.keys(value).some(key=>!['file','sha256','patternEncoding','specialTokenMode','timeoutMs'].includes(key))||typeof value.file!=='string'||!isAbsolute(value.file)||value.file.startsWith('\\\\')||value.file.startsWith('//')||/[\x00-\x1f]/.test(value.file)||!(/^[a-f0-9]{64}$/i.test(value.sha256))||!['cl100k_base','o200k_base','custom'].includes(value.patternEncoding)||value.specialTokenMode!==undefined&&!['ordinary','allowed'].includes(value.specialTokenMode)||value.timeoutMs!==undefined&&(!Number.isSafeInteger(value.timeoutMs)||value.timeoutMs<100||value.timeoutMs>30000))throw new Error('tokenizerVocabulary requires an absolute file, SHA-256 and a supported patternEncoding');
}
/** Pinned packed BPE ranks. Custom regex executes only in a time-bounded child;
 * no remote/code loader. Rehash BEFORE cache lookup, including same-size edits. */
export function countPinnedTextTokens(text:string,value:Vocabulary):number{
 validateTokenizerVocabulary(value);
 let path=resolve(value.file);
 for(;;){const info=lstatSync(path);if(info.isSymbolicLink())throw new Error('Tokenizer vocabulary path must not traverse links');if(path===resolve(value.file)&&(!info.isFile()||info.size>16*1024*1024))throw new Error('Invalid tokenizer vocabulary file');const parent=dirname(path);if(parent===path)break;path=parent;}
 const bytes=readFileSync(value.file);if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==value.sha256.toLowerCase())throw new Error('Tokenizer vocabulary digest changed');
 const identity=value.sha256.toLowerCase()+':'+value.patternEncoding+':'+(value.specialTokenMode??'ordinary');let encoder=privateEncoders.get(identity);
 if(!encoder&&!customVocabularies.has(identity)){
  const parsed=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;
  if(!parsed||typeof parsed.bpe_ranks!=='string'||Object.keys(parsed).some(key=>!['bpe_ranks','special_tokens',...(value.patternEncoding==='custom'?['pat_str']:[])].includes(key))||parsed.special_tokens!==undefined&&(!parsed.special_tokens||typeof parsed.special_tokens!=='object'||Array.isArray(parsed.special_tokens)||Object.keys(parsed.special_tokens).length>1000)||value.patternEncoding==='custom'&&(typeof parsed.pat_str!=='string'||!parsed.pat_str||parsed.pat_str.length>4096||/[\x00-\x1f]/.test(parsed.pat_str)))throw new Error('Invalid private vocabulary pattern or special_tokens');
  const tokens=new Set<string>(),ranks=new Set<number>(),singleBytes=new Set<number>();
  for(const line of parsed.bpe_ranks.split('\n').filter(Boolean)){
   const [prefix,offset,...values]=line.split(' ');const rank=Number(offset);
   if(!prefix||!/^\d+$/.test(offset??'')||!Number.isSafeInteger(rank)||rank<0||rank>10000000||!values.length)throw new Error('Invalid packed BPE row');
   for(const [i,token] of values.entries()){
    const decoded=Buffer.from(token,'base64');if(!decoded.length||decoded.length>1024||decoded.toString('base64')!==token||tokens.has(token)||ranks.has(rank+i)||tokens.size>=500000)throw new Error('Invalid or duplicate packed BPE token/rank');
    tokens.add(token);ranks.add(rank+i);if(decoded.length===1)singleBytes.add(decoded[0]!);
   }
  }
  if(singleBytes.size!==256)throw new Error('Private vocabulary must cover all 256 base bytes');
  const specials=(parsed.special_tokens??{}) as Record<string,number>,specialRanks=new Set<number>();for(const [token,rank] of Object.entries(specials)){if(!token||token.length>256||/[\x00-\x1f]/.test(token)||!Number.isSafeInteger(rank)||rank<0||rank>10000000||ranks.has(rank)||specialRanks.has(rank))throw new Error('Invalid or overlapping private special token');specialRanks.add(rank);}
  if(value.patternEncoding==='custom'){if(customVocabularies.size>=4)customVocabularies.delete(customVocabularies.keys().next().value!);customVocabularies.set(identity,{pat_str:parsed.pat_str as string,special_tokens:specials,bpe_ranks:parsed.bpe_ranks});}
  else{
  const {Tiktoken:Encoder}=require('js-tiktoken/lite') as typeof import('js-tiktoken/lite');
  encoder=new Encoder({pat_str:require('js-tiktoken/ranks/'+value.patternEncoding).pat_str,special_tokens:specials,bpe_ranks:parsed.bpe_ranks});
  if(privateEncoders.size>=4)privateEncoders.delete(privateEncoders.keys().next().value!);privateEncoders.set(identity,encoder);
  }
 }
 if(value.patternEncoding==='custom'){
  boundedText(text);const key=identity+':'+createHash('sha256').update(text).digest('hex'),cached=counts.get(key);if(cached!==undefined)return cached;
  const script="const d=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const{Tiktoken}=require(process.argv[1]);const e=new Tiktoken(d.vocabulary);process.stdout.write(String(e.encode(d.text,d.allowed?'all':[],[]).length));";
  const env:Record<string,string>={};for(const key of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP'])if(process.env[key])env[key]=process.env[key]!;
  const result=spawnSync(process.execPath,['-e',script,require.resolve('js-tiktoken/lite')],{input:JSON.stringify({vocabulary:customVocabularies.get(identity),text,allowed:value.specialTokenMode==='allowed'}),encoding:'utf8',timeout:value.timeoutMs??5000,maxBuffer:4096,windowsHide:true,env});
  if(result.error||result.status!==0||!/^\d+$/.test(result.stdout)||!Number.isSafeInteger(Number(result.stdout)))throw new Error('Private tokenizer subprocess failed or exceeded its timeout; conversation preserved');const count=Number(result.stdout);if(counts.size>=128)counts.delete(counts.keys().next().value!);counts.set(key,count);return count;
 }
 return boundedCount(text,identity,encoder!,value.specialTokenMode==='allowed');
}
function boundedText(text:string){
 if(Buffer.byteLength(text)>16*1024*1024)throw new Error('Tokenizer input exceeds bounded text limits');
 for(const segment of text.matchAll(/\S+|\s+/gu))if(segment[0].length>65536)throw new Error('Tokenizer segment exceeds bounded limits');
}
function boundedCount(text:string,identity:string,encoder:Tiktoken,allowed=false):number{
 boundedText(text);
 const key=identity+':'+createHash('sha256').update(text).digest('hex'),cached=counts.get(key);if(cached!==undefined)return cached;
 const count=encoder.encode(text,allowed?'all':[],[]).length;if(counts.size>=128)counts.delete(counts.keys().next().value!);counts.set(key,count);return count;
}
/** Actual BPE for explicit text encoding, NOT an inferred vendor/model mapping,
 * image tokenizer, request framing count or billing total. Loaded only on opt-in. */
export function countTextTokens(text:string,encoding:TextEncoding):number{
 if(!['cl100k_base','o200k_base'].includes(encoding))throw new Error('Unsupported text tokenizer encoding');
 if(Buffer.byteLength(text)>16*1024*1024)throw new Error('Tokenizer input exceeds bounded text limits');
 for(const segment of text.matchAll(/\S+|\s+/gu))if(segment[0].length>65536)throw new Error('Tokenizer segment exceeds bounded limits; reduce oversized binary/base64/whitespace content');
 const identity=encoding+':'+createHash('sha256').update(text).digest('hex'),known=counts.get(identity);if(known!==undefined)return known;
 // Dense long words (including unbroken CJK) can make the JS BPE merge quadratic.
 // Preserve exact encoding, but move expensive inputs into a bounded child rather
 // than freezing the interactive process indefinitely. No guessed chunk counts.
 if(Buffer.byteLength(text)>256*1024||Array.from(text.matchAll(/\S+/gu)).some(segment=>segment[0].length>1024)){
  const env:Record<string,string>={};for(const key of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP'])if(process.env[key])env[key]=process.env[key]!;
  const script="const d=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const{Tiktoken}=require(process.argv[1]);const e=new Tiktoken(require(process.argv[2]));process.stdout.write(String(e.encode(d.text,[],[]).length));";
  const result=spawnSync(process.execPath,['--max-old-space-size=256','-e',script,require.resolve('js-tiktoken/lite'),require.resolve('js-tiktoken/ranks/'+encoding)],{input:JSON.stringify({text}),encoding:'utf8',timeout:5000,maxBuffer:4096,windowsHide:true,env});
  if(result.error||result.status!==0||!/^\d+$/.test(result.stdout)||!Number.isSafeInteger(Number(result.stdout)))throw new Error('Text tokenizer exceeded its bounded processing limit; conversation preserved. Reduce oversized content or configure a suitable tokenizer/provider input counting instead.');
  const count=Number(result.stdout);if(counts.size>=128)counts.delete(counts.keys().next().value!);counts.set(identity,count);return count;
 }
 let encoder=encoders.get(encoding);if(!encoder){const {Tiktoken:Encoder}=require('js-tiktoken/lite') as typeof import('js-tiktoken/lite');encoder=new Encoder(require('js-tiktoken/ranks/'+encoding));encoders.set(encoding,encoder);}
 const count=encoder.encode(text,[],[]).length;if(counts.size>=128)counts.delete(counts.keys().next().value!);counts.set(identity,count);return count;
}
export function countModelText(model:PlatformConfig['model']|undefined,value:unknown):number{
 if(model?.tokenizerVocabulary)return countPinnedTextTokens(typeof value==='string'?value:JSON.stringify(value)??'',model.tokenizerVocabulary);
 const encoding=model?.tokenizer;if(!encoding)return estimateTokens(value);
 return countTextTokens(typeof value==='string'?value:JSON.stringify(value)??'',encoding);
}

/** Fallback for generated text only. IDs, signatures and encrypted replay state
 * are not generated prose. Invisible reasoning/media remain unknown without usage. */
export function estimateModelOutput(model:PlatformConfig['model'],content:ContentBlock[]):number{
 return content.reduce((total,block)=>total+countModelText(model,
  block.type==='text'?block.text??'':block.type==='thinking'?block.text??'':
  block.type==='tool_use'?`${block.name??''}\n${JSON.stringify(block.input??{})}`:''),0);
}
