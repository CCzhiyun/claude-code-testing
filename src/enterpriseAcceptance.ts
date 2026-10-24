import {mkdtemp,lstat,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {PlatformConfig,ModelMessage,ToolContext} from './types.js';
import {probeModelAcceptance} from './modelProbe.js';
import {callModel} from './model.js';
import {resolveModelProtocol} from './modelConnection.js';
import {withSpendScope,readSpending,currentSpendScope} from './spending.js';
import {withModelToolChoice} from './modelToolChoice.js';
import {tools,executeTool} from './tools.js';
import {permissionInputHash} from './permissionApprovals.js';
import {redactModelDiagnostic,ModelRequestError} from './modelErrors.js';
import {createId} from './storage.js';

export interface EnterpriseAcceptanceOptions {confirmed:boolean;maxRequests:number;maxTokens:number;timeoutMs?:number}
/** Paid opt-in, actual deployed configuration. Never changes endpoints, keys,
 * model, CA, proxy, mTLS, credentials or policy to manufacture a passing result. */
export async function runEnterpriseAcceptance(cwd:string,config:PlatformConfig,options:EnterpriseAcceptanceOptions){
 if(!options.confirmed||!Number.isSafeInteger(options.maxRequests)||options.maxRequests<1||options.maxRequests>32||!Number.isSafeInteger(options.maxTokens)||options.maxTokens<1||options.maxTokens>100000000)throw new Error('Enterprise acceptance requires --confirm, --max-requests 1–32 and --max-tokens 1–100000000; model calls may be billed');
 if(options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>120000))throw new Error('Acceptance timeout must be 100–120000ms');
 const scope=`acceptance-${randomUUID()}`,copy=structuredClone(config);copy.model.responsesStore=false;copy.modelRetry={...copy.modelRetry,maxRetries:0};copy.spending={...copy.spending,maxRequests:Math.min(options.maxRequests,copy.spending?.maxRequests??Infinity),maxTokens:Math.min(options.maxTokens,copy.spending?.maxTokens??Infinity)};
 copy.network.timeoutMs=Math.min(copy.network.timeoutMs,options.timeoutMs??20000);
 const report={ok:false,configurationDigest:permissionInputHash({model:config.model,network:config.network,policy:config.policy}),platform:process.platform,node:process.versions.node,checks:[] as Array<{name:string;ok:boolean;detail:string;diagnostics?:unknown}>,budget:undefined as Awaited<ReturnType<typeof readSpending>>|undefined,scope:'Actual deployment/protocol on this host only; not CA rotation, credential expiry, background worker or cross-OS certification',workspaceFilesRead:0};
 let root:string|undefined;
 return withSpendScope(scope,async()=>{try{
  const suite=await probeModelAcceptance(copy,true,{diagnostics:true,...(options.timeoutMs?{timeoutMs:options.timeoutMs}:{})});for(const stage of suite.checks)report.checks.push({name:stage.name,ok:stage.report.ok,detail:stage.report.detail,...(stage.report.diagnostics?{diagnostics:stage.report.diagnostics}:{})});if(!suite.ok)return report;
  root=await mkdtemp(join(resolve(cwd),'.ccpt-acceptance-'));const actual=await realpath(root);if(actual!==resolve(root))throw new Error('Acceptance fixture must not traverse links');
  const marker='ACCEPTANCE_'+randomUUID();await writeFile(join(root,'read-only-fixture.txt'),marker,{mode:0o600});
  const relativePath=join(basename(root),'read-only-fixture.txt'),definition=tools.find(t=>t.name==='read_file')!,messages:ModelMessage[]=[{role:'user',content:`Use read_file to read exactly ${JSON.stringify(relativePath)}. Do not guess its content. After the tool result, output only that exact content.`}];
  const response=await withModelToolChoice(resolveModelProtocol(copy.model)==='messages'?'auto':'required',()=>callModel(copy,'This is an explicitly authorized diagnostic. Only the supplied read_file tool is available.',messages,[definition]));
  const calls=response.content.filter(b=>b.type==='tool_use');if(calls.length!==1||calls[0]!.name!=='read_file'||calls[0]!.input?.path!==relativePath)throw new Error('Model did not choose the exact permitted fixture read; no model-selected tool was executed');
  const ctx:ToolContext={cwd:resolve(cwd),config:copy,sessionId:createId('session'),agentId:createId('agent'),depth:0,operationId:randomUUID()};const output=await executeTool('read_file',calls[0]!.input!,ctx,async()=>{throw new Error('Delegation is disabled in acceptance');});if(output.waiting||output.content!==marker)throw new Error('Read required approval or returned unexpected bytes; nothing was sent back to the model');report.workspaceFilesRead=1;
  messages.push({role:'assistant',content:response.content,...(response.responses?{responses:response.responses}:{})},{role:'user',content:[{type:'tool_result',tool_use_id:calls[0]!.id!,content:output.content}]});const final=await withModelToolChoice('auto',()=>callModel(copy,'Return only the fixture bytes from the tool result. Do not call another tool.',messages,[]));const answer=final.content.filter(b=>b.type==='text').map(b=>b.text??'').join('').trim();if(answer!==marker||final.content.some(b=>b.type==='tool_use'))throw new Error('Tool result continuation did not return the exact fixture bytes');
  report.checks.push({name:'actual-read-file-tool-roundtrip',ok:true,detail:'Only one newly created fixture file read through the real tool dispatcher; exact result returned through the selected model protocol.'});report.ok=true;
 }catch(error){let diagnostics:unknown;for(let e=error,depth=0;e instanceof Error&&depth<8;e=e.cause,depth++)if(e instanceof ModelRequestError&&e.diagnostics){diagnostics=e.diagnostics;break;}report.checks.push({name:'actual-agent-acceptance',ok:false,detail:redactModelDiagnostic(error instanceof Error?error.message:String(error)),...(diagnostics?{diagnostics}:{})});}
 finally{report.budget=await readSpending(currentSpendScope()??scope);if(root){const stat=await lstat(root);if(stat.isDirectory()&&!stat.isSymbolicLink()&&dirname(resolve(root))===resolve(cwd)&&basename(root).startsWith('.ccpt-acceptance-'))await rm(root,{recursive:true,force:true});}}
 return report;});
}
