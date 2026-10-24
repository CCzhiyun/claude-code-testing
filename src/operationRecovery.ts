import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { projectStateDir } from './paths.js';
import { withFileLock, writeJson } from './storage.js';
import { readUtf8Text } from './textFiles.js';
import { permissionInputHash } from './permissionApprovals.js';
import { redactModelDiagnostic } from './modelErrors.js';
import { executeCommand } from './policy.js';
import { audit } from './audit.js';
import type { ToolContext, PlatformConfig } from './types.js';
import { callMcpServer } from './mcp.js';
import { evaluatePermission } from './utils/permissions/permissions.js';
import { validateOperationRecovery } from './operationRecoveryConfig.js';

export interface OperationRecord { id:string; version:number; sessionId:string; agentId:string; tool:string; inputHash:string; phase:'claimed'|'completed'|'unknown'|'not_applied'|'compensating'|'compensated'|'compensation_unknown'; at:string; resultHash?:string; gitCommit?:string; note?:string; mcpServer?:string;mcpTool?:string;connectorDigest?:string }
export interface OperationConnector { inspect(operation:Readonly<OperationRecord>):Promise<Record<string,unknown>>; compensate?(operation:Readonly<OperationRecord>,reason:string):Promise<void> }
const connectors=new Map<string,OperationConnector>();
/** Trusted embedding API, never populated from model output or an untrusted URL. */
export function registerOperationConnector(tool:string,connector:OperationConnector):()=>void {
 if(!/^[\w:.-]{1,120}$/.test(tool)||connectors.has(tool))throw new Error('Invalid or duplicate recovery connector');connectors.set(tool,connector);return ()=>{if(connectors.get(tool)===connector)connectors.delete(tool);};
}
const external=new Set(['git_commit','git_push','create_draft_pr','mcp_call']);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function recoverySpec(config:PlatformConfig,server:string,tool:string){
 const spec=config.mcpServers[server]?.operationRecovery?.[tool];if(!spec)return undefined;
 validateOperationRecovery({[tool]:spec});return spec;
}
/** Business equality is an explicit connector contract, never inferred by an LLM.
 * Only scalar argument fields are selected; arguments and keys are not persisted. */
function toolOperationId(context:ToolContext,tool:string,input:Record<string,unknown>):{id:string;business:boolean}{
 if(tool==='mcp_call'){
  const server=String(input.server??''),remoteTool=String(input.tool??''),spec=recoverySpec(context.config,server,remoteTool);
  if(spec?.businessKeyFields){const args=input.arguments as Record<string,unknown>|undefined,selected:Record<string,string|number>={};
   for(const field of [...spec.businessKeyFields].sort()){const value=args?.[field];if(typeof value!=='string'&&typeof value!=='number'||typeof value==='string'&&(!value.trim()||value.length>1024)||typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('Business idempotency requires bounded nonempty string or safe-integer key fields');selected[field]=value as string|number;}
   return {id:`operation_${permissionInputHash({scope:spec.businessScope,server,tool:remoteTool,deployment:context.config.mcpServers[server],selected})}`,business:true};
  }
 }
 return {id:`operation_${hash(context.sessionId+'\n'+context.operationId)}`,business:false};
}
export function operationInput(context:ToolContext,tool:string,input:Record<string,unknown>):Record<string,unknown>{
 if(tool!=='mcp_call'||!context.operationId||context.config.ephemeralSession)return input;
 const server=String(input.server??''),remoteTool=String(input.tool??''),spec=recoverySpec(context.config,server,remoteTool);if(!spec)return input;
 const key=toolOperationId(context,tool,input).id,args=input.arguments&&typeof input.arguments==='object'&&!Array.isArray(input.arguments)?input.arguments as Record<string,unknown>:{};
 if(args[spec.idempotencyArgument]!==undefined&&args[spec.idempotencyArgument]!==key)throw new Error('Do not replace the bound connector idempotency key');
 return {...input,arguments:{...args,[spec.idempotencyArgument]:key}};
}
function configuredConnector(row:OperationRecord,config:PlatformConfig):OperationConnector|undefined{
 if(!row.mcpServer||!row.mcpTool)return connectors.get(row.tool);
 if(!row.connectorDigest||row.connectorDigest!==hash(JSON.stringify(config.mcpServers[row.mcpServer]??null)))throw new Error('Recovery connector deployment changed or is unbound; verify the original external system manually');
 const registered=connectors.get(`mcp:${row.mcpServer}:${row.mcpTool}`);if(registered)return registered;
 const spec=recoverySpec(config,row.mcpServer,row.mcpTool),server=config.mcpServers[row.mcpServer];if(!spec||!server)return connectors.get(row.tool);
 const call=async(tool:string)=>{
  const input={server:row.mcpServer,tool,arguments:{[spec.operationArgument??'operation_id']:row.id}};
  if(config.policy.mode==='restricted'||evaluatePermission('mcp_call',input,config)?.behavior==='deny')throw new Error('Recovery MCP call denied by current policy');
  const result=await callMcpServer(row.mcpServer!,server,tool,input.arguments,config.policy.allowNetwork,undefined,config);
  if(result&&typeof result==='object'&&'isError' in result&&result.isError===true)throw new Error('Recovery connector reported an error; inspect the external result manually');return result;
 };
 return {inspect:async()=>({providerResponse:redactModelDiagnostic(JSON.stringify(await call(spec.statusTool)))}),...(spec.compensateTool?{compensate:async()=>{await call(spec.compensateTool!);}}:{})};
}
function path(cwd:string,id:string){if(!/^operation_[a-f0-9]{64}$/.test(id))throw new Error('Invalid operation ID');return join(projectStateDir(cwd),'operations',`${id}.json`);}
async function root(cwd:string){const dir=join(projectStateDir(cwd),'operations');await mkdir(dir,{recursive:true,mode:0o700});for(const p of [projectStateDir(cwd),dir])if((await lstat(p)).isSymbolicLink())throw new Error('Operation state cannot be a link');return dir;}
export async function inspectOperation(cwd:string,id:string):Promise<OperationRecord>{
 const file=path(cwd,id);for(const p of [projectStateDir(cwd),join(projectStateDir(cwd),'operations'),file]){const stat=await lstat(p);if(stat.isSymbolicLink()||(p===file? !stat.isFile()||stat.size>16000:!stat.isDirectory()))throw new Error('Invalid operation state path');}
 const row=JSON.parse(await readUtf8Text(file,16000)) as OperationRecord;
 if(row.id!==id||!Number.isSafeInteger(row.version)||row.version<1||!/^session_[a-f0-9]{16}$/.test(row.sessionId)||!/^agent_[a-f0-9]{16}$/.test(row.agentId)||!external.has(row.tool)||!/^[a-f0-9]{64}$/.test(row.inputHash)||!['claimed','completed','unknown','not_applied','compensating','compensated','compensation_unknown'].includes(row.phase)||!Number.isFinite(Date.parse(row.at))||row.gitCommit!==undefined&&!/^[a-f0-9]{40,64}$/.test(row.gitCommit))throw new Error('Invalid operation record');
 if(row.mcpServer!==undefined&&!/^[-\w.:]{1,120}$/.test(row.mcpServer)||row.mcpTool!==undefined&&!/^[-\w.:]{1,120}$/.test(row.mcpTool)||row.connectorDigest!==undefined&&!/^[a-f0-9]{64}$/.test(row.connectorDigest))throw new Error('Invalid MCP operation identity');
 return {id:row.id,version:row.version,sessionId:row.sessionId,agentId:row.agentId,tool:row.tool,inputHash:row.inputHash,phase:row.phase,at:row.at,...(row.resultHash&&/^[a-f0-9]{64}$/.test(row.resultHash)?{resultHash:row.resultHash}:{}),...(row.gitCommit?{gitCommit:row.gitCommit}:{}),...(typeof row.note==='string'?{note:redactModelDiagnostic(row.note)}:{}),...(row.mcpServer?{mcpServer:row.mcpServer}:{}),...(row.mcpTool?{mcpTool:row.mcpTool}:{}),...(row.connectorDigest?{connectorDigest:row.connectorDigest}:{})};
}
export async function listOperations(cwd:string){const dir=await root(cwd);const files=(await readdir(dir)).filter(name=>/^operation_[a-f0-9]{64}\.json$/.test(name)).sort();if(files.length>10000)throw new Error('Operation inventory limit reached');return Promise.all(files.slice(-200).map(name=>inspectOperation(cwd,name.slice(0,-5))));}
export async function beginToolOperation(context:ToolContext,tool:string,input:Record<string,unknown>):Promise<OperationRecord|undefined>{
 if(!external.has(tool)||!context.operationId||context.config.ephemeralSession)return undefined;
 if(context.operationId.length>1024)throw new Error('Tool operation ID is too long');
 await root(context.cwd);
 const {id,business}=toolOperationId(context,tool,input),inputHash=permissionInputHash(input);
 return withFileLock(path(context.cwd,id)+'.lock',async()=>{
  try{
   const old=await inspectOperation(context.cwd,id);
   if(old.inputHash!==inputHash||old.tool!==tool||!business&&old.agentId!==context.agentId)throw new Error('Operation ID was reused with different arguments or owner');
   if(old.mcpServer&&old.connectorDigest!==hash(JSON.stringify(context.config.mcpServers[old.mcpServer]??null)))throw new Error('Recovery connector deployment changed; do not replay');
   if(old.phase!=='not_applied')throw new Error(`Operation ${id} is ${old.phase}; do not replay it. Inspect/reconcile its external result first.`);
   old.version++;old.phase='claimed';old.at=new Date().toISOString();if(business){old.sessionId=context.sessionId;old.agentId=context.agentId;}await writeJson(path(context.cwd,id),old);return old;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const row:OperationRecord={id,version:1,sessionId:context.sessionId,agentId:context.agentId,tool,inputHash,phase:'claimed',at:new Date().toISOString(),...(tool==='mcp_call'?{mcpServer:String(input.server),mcpTool:String(input.tool),connectorDigest:hash(JSON.stringify(context.config.mcpServers[String(input.server)]??null))}:{})};await writeJson(path(context.cwd,id),row);return row;
 });
}
export async function finishToolOperation(context:ToolContext,row:OperationRecord|undefined,result:string,success:boolean){
 if(!row)return;
 await withFileLock(path(context.cwd,row.id)+'.lock',async()=>{
  const current=await inspectOperation(context.cwd,row.id);if(current.phase!=='claimed'||current.version!==row.version)return;
  current.phase=success?'completed':'unknown';current.resultHash=hash(result);current.version++;
  if(success&&row.tool==='git_commit'){
   const head=await executeCommand('git',['rev-parse','HEAD'],context.cwd,context.config,context.agentId);
   if(head.code===0&&/^[a-f0-9]{40,64}$/.test(head.stdout.trim()))current.gitCommit=head.stdout.trim();
  }
  await writeJson(path(context.cwd,row.id),current);
 });
}
export async function resolveOperation(cwd:string,id:string,version:number,phase:'completed'|'not_applied',note:string){
 if(!['completed','not_applied'].includes(phase)||!note?.trim()||note.length>2000)throw new Error('A manual outcome and verification note are required');
 await inspectOperation(cwd,id);
 return withFileLock(path(cwd,id)+'.lock',async()=>{const row=await inspectOperation(cwd,id);if(row.version!==version)throw new Error('Operation changed; refresh before deciding');if(!['claimed','unknown','compensation_unknown'].includes(row.phase))throw new Error('Only an uncertain operation needs manual reconciliation');row.phase=phase;row.note=redactModelDiagnostic(note);row.version++;await writeJson(path(cwd,id),row);await audit({event:'operation.manually_verified',actor:'human',outcome:'success',details:{id,phase,version:row.version}});return row;});
}
export async function queryOperation(cwd:string,id:string,config:PlatformConfig){
 const row=await inspectOperation(cwd,id),connector=configuredConnector(row,config);
 if(connector)return {operation:row,inspection:await connector.inspect(Object.freeze({...row})),automaticResolution:false};
 if(row.tool==='git_commit'){
  const head=await executeCommand('git',['rev-parse','HEAD'],cwd,config,'operation-inspector');let receiptCommitExists=false;
  if(row.gitCommit)receiptCommitExists=(await executeCommand('git',['cat-file','-e',`${row.gitCommit}^{commit}`],cwd,config,'operation-inspector')).code===0;
  return {operation:row,inspection:{head:head.code===0?head.stdout.trim():null,receiptCommitExists},automaticResolution:false};
 }
 return {operation:row,inspection:{requiresConnector:true,message:'No configured result-query connector; inspect the external system manually. A timeout does not prove that the operation failed.'},automaticResolution:false};
}
/** Explicit compensation is itself a write-ahead operation. Ambiguous failures
 * are retained, not retried; no automatic token/cost refund occurs. */
export async function compensateOperation(cwd:string,id:string,version:number,reason:string,config:PlatformConfig,confirm:boolean){
 if(!confirm||!reason?.trim())throw new Error('Compensation requires --confirm and a human reason');
 await inspectOperation(cwd,id);
 return withFileLock(path(cwd,id)+'.lock',async()=>{
  const row=await inspectOperation(cwd,id);if(row.version!==version||row.phase!=='completed')throw new Error('Refresh a completed operation before compensating');
  const connector=configuredConnector(row,config);
  if(!connector?.compensate&&!(row.tool==='git_commit'&&row.gitCommit))throw new Error('No safe compensation connector. No force-push, PR deletion or arbitrary inverse command will be guessed.');
  if(!connector){
   const head=await executeCommand('git',['rev-parse','HEAD'],cwd,config,'operation-inspector'),status=await executeCommand('git',['status','--porcelain'],cwd,config,'operation-inspector'),parents=await executeCommand('git',['rev-list','--parents','-n','1',row.gitCommit!],cwd,config,'operation-inspector');
   if(head.code||status.code||parents.code||head.stdout.trim()!==row.gitCommit||status.stdout.trim()||parents.stdout.trim().split(/\s+/).length>2)throw new Error('Git compensation requires clean worktree, exact receipt HEAD and a non-merge commit');
  }
  row.phase='compensating';row.version++;row.note=redactModelDiagnostic(reason);await writeJson(path(cwd,id),row);
  try{
   if(connector?.compensate)await connector.compensate(Object.freeze({...row}),reason);
   else {const result=await executeCommand('git',['revert','--no-edit',row.gitCommit!],cwd,config,'operation-compensator');if(result.code)throw new Error('Git revert did not complete; inspect conflicts and repository state manually');}
   row.phase='compensated';
  }catch(error){row.phase='compensation_unknown';row.note=redactModelDiagnostic(error instanceof Error?error.message:String(error));}
  row.version++;await writeJson(path(cwd,id),row);await audit({event:'operation.compensation',actor:'human',outcome:row.phase==='compensated'?'success':'failure',details:{id,phase:row.phase}});return row;
 });
}
