import { randomUUID } from 'node:crypto';
import { runHooks } from './hooks.js';
import type { PlatformConfig } from './types.js';
/** Bounded display batching. Only the surface changes; canonical model/transcript
 * text and tool results remain untouched. Failure always falls back to original. */
export async function displayAssistantMessage(config:PlatformConfig,cwd:string,sessionId:string,agentId:string,text:string,turnId=randomUUID()):Promise<string>{
 if(!text||!config.hooks.some(hook=>hook.event==='MessageDisplay'))return text;
 const setting=config.messageDisplay;
 const size=setting?.mode==='lines' ? setting.linesPerBatch??1 : 1;
 const max=setting?.maxBatches??128;
 if(!Number.isSafeInteger(size)||size<1||size>100&&setting?.mode==='lines'||!Number.isSafeInteger(max)||max<1||max>256)return text;
 const lines:string[]=[];
 if(setting?.mode==='lines'){for(const match of text.matchAll(/[^\n]*\n|[^\n]+$/g)){if(lines.length>=size*max)return text;lines.push(match[0]);}}else lines.push(text);
 const messageId=randomUUID(),output:string[]=[];
 try{for(let offset=0,index=0;offset<lines.length;offset+=size,index++){
  const delta=lines.slice(offset,offset+size).join('');
  output.push((await runHooks(config,'MessageDisplay',{agentId,sessionId,turn_id:turnId,message_id:messageId,index,final:offset+size>=lines.length,delta},cwd)).displayContent??delta);
 }return output.join('');}catch{return text;}
}
