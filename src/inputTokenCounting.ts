import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {PlatformConfig,ModelMessage,ToolDefinition} from './types.js';
import {responsesRequest} from './responsesModel.js';
import {resolveModelEndpoint,resolveModelProtocol,modelAuthHeaders} from './modelConnection.js';
import {authorizeModelEndpoint} from './legacyModel.js';
import {prepareModelCredential} from './protectedModelCredentials.js';
import {networkRequest} from './network.js';
import {modelRequestError,withModelDiagnosticSecrets} from './modelErrors.js';
import {assertExecutionBoundary,executionSignal} from './executionControl.js';
import {withModelBudget,isBudgetLimitFailure} from './spending.js';
import {validateToolSchemas} from './toolSchema.js';
import {validateModelAudio} from './modelAudio.js';
import {withModelRetry} from './modelRetry.js';

interface PreparedCount { inputTokens:number; requestHash:string; source:'provider' }
const preparedCount=new AsyncLocalStorage<PreparedCount|undefined>();
function preparedInput(config:PlatformConfig,system:string,messages:ModelMessage[],tools:ToolDefinition[]){
 const {body,scope}=responsesRequest(config,system,messages,tools,false);
 const encoded=JSON.stringify({model:body.model,instructions:body.instructions,input:body.input,...(body.tools?{tools:body.tools}:{}),...(body.reasoning?{reasoning:body.reasoning}:{}),...(body.text?{text:body.text}:{}),...(body.tool_choice?{tool_choice:body.tool_choice}:{})});
 return {encoded,hash:createHash('sha256').update(JSON.stringify([resolveModelEndpoint(config.model),scope,encoded])).digest('hex')};
}
/** Scoped to one query and matched to its complete prepared input. Never trust a
 * persisted snapshot or reuse a count after a tool/system/history change. */
export function withPreparedInputCount<T>(count:PreparedCount|undefined,action:()=>T):T{return preparedCount.run(count,action);}
export function preparedProviderInput(config:PlatformConfig,system:string,messages:ModelMessage[],tools:ToolDefinition[]):number|undefined{
 const count=preparedCount.getStore();if(!count||!config.model.inputTokenCounting||resolveModelProtocol(config.model)!=='responses'||config.model.responsesTransport==='chat-completions')return;
 if(preparedInput(config,system,messages,tools).hash===count.requestHash)return count.inputTokens;
}

export function validateInputTokenCounting(model:PlatformConfig['model']){
 const p=model.inputTokenCounting;if(p===undefined||p===null)return;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['mode','onError','timeoutMs'].includes(k))||p.mode!=='responses'||p.onError!==undefined&&!['stop','estimate'].includes(p.onError)||p.timeoutMs!==undefined&&(!Number.isSafeInteger(p.timeoutMs)||p.timeoutMs<100||p.timeoutMs>30000)||resolveModelProtocol(model)!=='responses'||model.responsesTransport==='chat-completions')throw new Error('model.inputTokenCounting requires native Responses, stop|estimate and timeoutMs 100–30000');
}
/** Explicit opt-in only. Same deployment/auth/CA/proxy as generation; no alternate
 * endpoint, local image fetching, automatic retry or prompt persistence. Counts
 * reserve a request and conservatively charge input tokens at configured prices,
 * NOT a claim that the counting endpoint actually bills those prices. */
export async function countProviderInput(config:PlatformConfig,system:string,messages:ModelMessage[],tools:ToolDefinition[]){
 validateInputTokenCounting(config.model);if(!config.model.inputTokenCounting)return undefined;
 await assertExecutionBoundary();validateToolSchemas(tools);validateModelAudio(config,'responses',messages);
 const url=new URL(resolveModelEndpoint(config.model));if(!/\/responses\/?$/.test(url.pathname))throw new Error('Input token counting requires a Responses endpoint ending in /responses');
 authorizeModelEndpoint(config,url.href);url.pathname=url.pathname.replace(/\/$/,'')+'/input_tokens';
 await prepareModelCredential(config.model);const headers=modelAuthHeaders(config.model);
 const {encoded,hash}=preparedInput(config,system,messages,tools);if(Buffer.byteLength(encoded)>32*1024*1024)throw new Error('Input token counting payload exceeds the bounded 32 MiB limit');
 return withModelDiagnosticSecrets(Object.values(headers).flatMap(v=>[v,v.replace(/^(?:Bearer|Basic)\s+/i,'')]),async()=>{
  let sent=false;try{let inputTokens=0;
   const scheduled={...config,modelRetry:{...config.modelRetry,maxRetries:0}};
   await withModelRetry(scheduled,system,messages,tools,undefined,async()=>withModelBudget(config,async()=>{await assertExecutionBoundary();sent=true;const response=await networkRequest(url.href,{method:'POST',headers:{'content-type':'application/json',...headers},body:encoded,deadlineMs:Math.min(config.network.timeoutMs,config.model.inputTokenCounting!.timeoutMs??10000),maxResponseBytes:16000},config.network);
    if(response.status<200||response.status>=300)throw modelRequestError(response.status,response.text,response.headers);
    let value;try{value=JSON.parse(response.text)}catch{throw new Error('Invalid provider token count JSON')}
    if(!value||value.object!=='response.input_tokens'||!Number.isSafeInteger(value.input_tokens)||value.input_tokens<0||value.input_tokens>100000000)throw new Error('Invalid provider input token count');
    inputTokens=value.input_tokens;return {content:[],usage:{inputTokens,outputTokens:0}};
   }));return {inputTokens,requestHash:hash,source:'provider' as const};
  }catch(error){if(!sent||executionSignal()?.aborted||isBudgetLimitFailure(error)||config.model.inputTokenCounting!.onError!=='estimate')throw error;return {source:'estimate-fallback' as const,requestHash:hash};}
 });
}
