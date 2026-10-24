import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,readdir,rename,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {projectStateDir} from './paths.js';
import {loadConfig} from './config.js';
import {loadPluginAt,installPlugin,computePluginDigest,verifyPluginLock} from './plugins.js';
import {verifyPluginSignature} from './pluginSignatures.js';
import {safePluginStatePath,installedPluginPath,listPluginHistory,type PluginScope} from './pluginHistory.js';
import {createId,withFileLock,writeJson} from './storage.js';
import {protectPath} from './policy.js';
import {isWorkspaceTrusted} from './workspaceTrust.js';
import type {PlatformConfig} from './types.js';
import {applySignedPluginOverlay,type SignedPluginOverlay} from './pluginOverlays.js';
import {reviewedRolloutCandidate,withReviewedRollout} from './pluginRolloutAuthority.js';

interface Receipt {format:1;id:string;createdAt:string;plugins:Array<{name:string;version:string;digest:string;sourceDigest:string;overlay?:SignedPluginOverlay}>}
export interface PluginSetPointer {version:number;generation:string;digest:string}
const validId=(id:string)=>/^pluginset_[a-f0-9]{16}$/.test(id);
const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
const root=(cwd:string)=>join(projectStateDir(cwd),'plugin-sets');
const active=(cwd:string)=>join(root(cwd),'active.json');
async function text(cwd:string,path:string,limit:number){await safePluginStatePath(cwd,path);const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw new Error('Invalid plugin-set state type/size');const bytes=await readFile(path);if(bytes.length>limit)throw new Error('Plugin-set state grew beyond size limit');return bytes.toString('utf8');}
async function pointer(cwd:string):Promise<PluginSetPointer|null>{let raw:string;try{raw=await text(cwd,active(cwd),16000);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}const value=JSON.parse(raw) as PluginSetPointer;if(!value||!Number.isSafeInteger(value.version)||value.version<1||!validId(value.generation)||!/^[a-f0-9]{64}$/.test(value.digest)||Object.keys(value).length!==3)throw new Error('Invalid active plugin-set pointer');return value;}
async function verifySet(cwd:string,id:string,config:PlatformConfig,directory=join(root(cwd),id)){
 if(!validId(id))throw new Error('Invalid plugin-set ID');const raw=await text(cwd,join(directory,'receipt.json'),128000),receipt=JSON.parse(raw) as Receipt;
 if(!receipt||receipt.format!==1||receipt.id!==id||!Number.isFinite(Date.parse(receipt.createdAt))||!Array.isArray(receipt.plugins)||!receipt.plugins.length||receipt.plugins.length>32)throw new Error('Invalid plugin-set receipt');
 const names=new Set<string>();for(const row of receipt.plugins){if(!row||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(row.name)||names.has(row.name.toLowerCase())||!/^[a-f0-9]{64}$/.test(row.digest)||!/^[a-f0-9]{64}$/.test(row.sourceDigest))throw new Error('Invalid or duplicate plugin-set entry');names.add(row.name.toLowerCase());const path=join(directory,'plugins',row.name);await safePluginStatePath(cwd,path);const plugin=await loadPluginAt(path);if(plugin.name!==row.name||plugin.version!==row.version||await computePluginDigest(path)!==row.digest)throw new Error('Plugin-set artifact/receipt mismatch');await verifyPluginLock(plugin,config);await verifyPluginSignature(plugin,config);}
 for(const row of receipt.plugins)if(row.overlay){const plugin=await loadPluginAt(join(directory,'plugins',row.name));applySignedPluginOverlay(plugin,{...config,pluginOverlays:{[row.name]:row.overlay}});}
 const entries=await readdir(join(directory,'plugins'),{withFileTypes:true});if(entries.length!==names.size||entries.some(entry=>!entry.isDirectory()||entry.isSymbolicLink()||!names.has(entry.name.toLowerCase())))throw new Error('Unreceipted plugin-set content');
 const envelope=await readdir(directory);if(envelope.length!==2||envelope.some(name=>!['receipt.json','plugins'].includes(name)))throw new Error('Unreceipted plugin-set envelope content');
 return {receipt,digest:hash(raw),directory};
}
async function mutation<T>(cwd:string,confirmed:boolean,action:(config:PlatformConfig)=>Promise<T>){
 if(!confirmed)throw new Error('Plugin-set mutation requires --confirm');if(!await isWorkspaceTrusted(cwd))throw new Error('Plugin-set mutation requires explicit workspace trust');const config=await loadConfig(cwd);if(config.policy.mode==='restricted')throw new Error('Plugin-set mutations are disabled in restricted mode');const lock=join(projectStateDir(cwd),'plugin-maintenance.lock');protectPath(lock,config);await safePluginStatePath(cwd,lock);return withFileLock(lock,async()=>{const fresh=await loadConfig(cwd);if(fresh.policy.mode==='restricted'||!await isWorkspaceTrusted(cwd))throw new Error('Plugin-set mutation authority changed');protectPath(lock,fresh);return action(fresh);});
}
/** One immutable generation contains ALL selected artifact bytes and receipts.
 * No fetch, plugin code execution or modification of the active generation. */
export async function stagePluginSet(cwd:string,sources:string[],confirmed:boolean,overlays:Record<string,SignedPluginOverlay>={}){
 if(!Array.isArray(sources)||!sources.length||sources.length>32||sources.some(s=>typeof s!=='string'))throw new Error('Select 1–32 local plugin sources');
 if(!overlays||typeof overlays!=='object'||Array.isArray(overlays)||Object.keys(overlays).length>32)throw new Error('Invalid plugin-set overlays');
 overlays=structuredClone(overlays);
 return mutation(cwd,confirmed,config=>stageSelected(cwd,sources,overlays,config));
}
async function stageSelected(cwd:string,sources:string[],overlays:Record<string,SignedPluginOverlay>,config:PlatformConfig){
  const parent=root(cwd);await safePluginStatePath(cwd,parent);await mkdir(parent,{recursive:true,mode:0o700});const id=createId('pluginset'),temporary=await mkdtemp(join(parent,'.pending-'));
  const plugins:Receipt['plugins']=[],names=new Set<string>();let files=0,bytes=0;
  const bound=async(path:string,depth=0):Promise<void>=>{if(depth>16||++files>5000)throw new Error('Plugin-set source count/depth limit');const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Plugin-set source must not contain links');if(info.isDirectory()){for(const name of await readdir(path))if(name!=='.git')await bound(join(path,name),depth+1);}else if(!info.isFile()||(bytes+=info.size)>128*1024*1024)throw new Error('Plugin-set source exceeds 128 MiB');};
  try{
   for(const source of sources){const path=protectPath(resolve(cwd,source),config);await bound(path);const plugin=await loadPluginAt(path);if(names.has(plugin.name.toLowerCase()))throw new Error('Duplicate plugin identity in set');names.add(plugin.name.toLowerCase());await verifyPluginLock(plugin,config);await verifyPluginSignature(plugin,config);const overlay=overlays[plugin.name];if(overlay)applySignedPluginOverlay(plugin,{...config,pluginOverlays:{[plugin.name]:overlay}});const digest=await computePluginDigest(path),copied=await installPlugin(path,join(temporary,'plugins'),plugin.name);if(await computePluginDigest(copied)!==digest)throw new Error('Plugin source changed during staging');plugins.push({name:plugin.name,version:plugin.version,digest,sourceDigest:hash(path),...(overlay?{overlay}:{})});}
   if(Object.keys(overlays).some(name=>!plugins.some(row=>row.name===name)))throw new Error('Overlay refers to an artifact outside the selected plugin set');
   await writeJson(join(temporary,'receipt.json'),{format:1,id,createdAt:new Date().toISOString(),plugins} satisfies Receipt);
   const target=join(parent,id);await safePluginStatePath(cwd,target);await rename(temporary,target);const verified=await verifySet(cwd,id,config);return {id,digest:verified.digest,plugins:verified.receipt.plugins,activated:false,current:await pointer(cwd)};
  }finally{await safePluginStatePath(cwd,temporary);if(resolve(temporary).startsWith(resolve(parent)+sep+'.pending-'))await rm(temporary,{recursive:true,force:true});}
}

export interface LegacyPluginSelection { name: string; scope: PluginScope; revisionId?: string }
async function legacyReview(cwd: string, selections: LegacyPluginSelection[], config: PlatformConfig) {
 if (!Array.isArray(selections) || !selections.length || selections.length > 32) throw new Error('Select 1–32 legacy plugins/revisions');
 const names = new Set<string>(), sources: string[] = [], plugins = [];
 for (const row of selections) {
  if (!row || Object.keys(row).some(key=>!['name','scope','revisionId'].includes(key))) throw new Error('Invalid legacy plugin selection');
  const installed = installedPluginPath(cwd,row.name,row.scope);
  if(names.has(row.name.toLowerCase()))throw new Error('Duplicate plugin identity in legacy selection');names.add(row.name.toLowerCase());
  let path=installed,revisionDigest:string|undefined;
  if(row.revisionId!==undefined){
   if(!/^revision_[a-f0-9]{16}$/.test(row.revisionId))throw new Error('Invalid legacy revision ID');
   const revision=(await listPluginHistory(cwd,row.name,row.scope)).find(item=>item.id===row.revisionId);
   if(!revision)throw new Error('Legacy revision not found');revisionDigest=revision.digest;
   path=join(projectStateDir(cwd),'plugin-history',row.scope,row.name,row.revisionId,'content');
  }
  await safePluginStatePath(cwd,path);protectPath(path,config);
  const plugin=await loadPluginAt(path),digest=await computePluginDigest(path);
  if(plugin.name!==row.name||revisionDigest&&revisionDigest!==digest)throw new Error('Legacy artifact/history receipt mismatch');
  await verifyPluginLock(plugin,config);await verifyPluginSignature(plugin,config);
  const overlay=config.pluginOverlays?.[row.name];if(overlay)applySignedPluginOverlay(plugin,config);
  sources.push(path);plugins.push({name:row.name,scope:row.scope,revisionId:row.revisionId??null,version:plugin.version,digest,overlay:overlay??null});
 }
 const binding={current:await pointer(cwd),authorityDigest:hash(JSON.stringify(config)),plugins};
 return {...binding,sources,reviewDigest:hash(JSON.stringify(binding)),activated:false,legacyModified:false,executesPluginCode:false};
}
/** Explicit migration of selected installed artifacts OR retained history bytes.
 * No deletion of legacy history, publisher rewriting, auto-enable or activation. */
export async function previewLegacyPluginMigration(cwd:string,selections:LegacyPluginSelection[]){
 const {sources,...view}=await legacyReview(cwd,structuredClone(selections),await loadConfig(cwd));return view;
}
export async function migrateLegacyPlugins(cwd:string,selections:LegacyPluginSelection[],expectedDigest:string,confirmed:boolean){
 if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('Expected legacy migration review digest required');
 selections=structuredClone(selections);
 return mutation(cwd,confirmed,async config=>{
  const fresh=await legacyReview(cwd,selections,config);if(fresh.reviewDigest!==expectedDigest)throw new Error('Legacy migration review changed; preview again');
  const overlays:Record<string,SignedPluginOverlay>={};for(const row of fresh.plugins)if(row.overlay)overlays[row.name]=row.overlay;
  const staged=await stageSelected(cwd,fresh.sources,overlays,config);
  return {...staged,migratedFrom:fresh.plugins.map(({name,scope,revisionId})=>({name,scope,revisionId})),legacyModified:false,activationAutomatic:false};
 });
}
/** Atomic pointer CAS is the linearization point. Rollback selects a retained
 * generation and rechecks CURRENT trust, locks and revocation; never force restore. */
export async function activatePluginSet(cwd:string,id:string,expectedVersion:number,confirmed:boolean){
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new Error('Expected plugin-set version is required');
 return mutation(cwd,confirmed,config=>switchSet(cwd,id,expectedVersion,config));
}
async function switchSet(cwd:string,id:string,expectedVersion:number,config:PlatformConfig){
 if(config.pluginRollout&&reviewedRolloutCandidate()!==id)throw new Error('Distribution policy requires a reviewed rollout receipt; legacy activation/rollback cannot bypass it');
 const current=await pointer(cwd);if((current?.version??0)!==expectedVersion)throw new Error('Active plugin set changed; refresh before activation/rollback');
 if(expectedVersion>=Number.MAX_SAFE_INTEGER)throw new Error('Plugin generation version exhausted');
 const verified=await verifySet(cwd,id,config);for(const row of verified.receipt.plugins)if(row.overlay&&config.pluginOverlays?.[row.name]&&JSON.stringify(config.pluginOverlays[row.name])!==JSON.stringify(row.overlay))throw new Error('Settings overlay conflicts with selected plugin generation; remove the conflicting explicit setting before switching');
 const next:PluginSetPointer={version:expectedVersion+1,generation:id,digest:verified.digest};await writeJson(active(cwd),next);return {...next,previousGeneration:current?.generation??null,artifactsAndReceiptsSwitchedTogether:true};
}

async function review(cwd:string,id:string,config:PlatformConfig){
 const current=await pointer(cwd),candidate=await verifySet(cwd,id,config),before=current?await verifySet(cwd,current.generation,config):null;
 if(before&&before.digest!==current!.digest)throw new Error('Active plugin-set receipt changed');
 const names=[...new Set([...(before?.receipt.plugins??[]).map(row=>row.name),...candidate.receipt.plugins.map(row=>row.name)])].sort();
 const changes=names.map(name=>{const old=before?.receipt.plugins.find(row=>row.name===name),next=candidate.receipt.plugins.find(row=>row.name===name);return {name,from:old?.version??null,to:next?.version??null,artifactChanged:old?.digest!==next?.digest,overlayChanged:JSON.stringify(old?.overlay)!==JSON.stringify(next?.overlay),removed:!next,added:!old};});
 // Bind all effective configuration without disclosing keys or credentials.
 const authorityDigest=hash(JSON.stringify(config));
 const reviewed={current,candidate:id,candidateDigest:candidate.digest,authorityDigest,changes};
 return {...reviewed,reviewDigest:hash(JSON.stringify(reviewed)),executesPluginCode:false,activationAutomatic:false};
}
/** No fetch here: stage explicit Marketplace selections first, review every
 * removal and overlay change, then commit against this exact preview digest. */
export async function previewPluginSetActivation(cwd:string,id:string){return review(cwd,id,await loadConfig(cwd));}
export async function activateReviewedPluginSet(cwd:string,id:string,expectedDigest:string,confirmed:boolean){
 if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('Expected plugin-set review digest is required');
 return mutation(cwd,confirmed,async config=>{const fresh=await review(cwd,id,config);if(fresh.reviewDigest!==expectedDigest)throw new Error('Plugin-set review changed; preview again before switching');return switchSet(cwd,id,fresh.current?.version??0,config);});
}

/** Emergency trust repair does not verify/execute compromised OLD plugin code.
 * It still verifies every byte/signature/overlay of the replacement and binds
 * the exact current pointer and all policy to a new human-reviewed digest. */
async function remediationReview(cwd:string,id:string,config:PlatformConfig){
 const current=await pointer(cwd);if(!current)throw new Error('No active plugin generation to remediate');if(current.generation===id)throw new Error('Remediation must select a different retained generation');
 let damaged=false;try{const old=await verifySet(cwd,current.generation,config);damaged=old.digest!==current.digest;}catch{damaged=true;}
 if(!damaged)throw new Error('Active plugins are trusted; use the normal reviewed rollout');
 const candidate=await verifySet(cwd,id,{...config,requirePluginSignatures:true});
 const p=config.pluginRollout;if(p){for(const item of candidate.receipt.plugins)if(!p.allowedVersions[item.name]?.includes(item.version))throw new Error('Remediation candidate is outside the configured distribution channel');
  if(!p.allowRemovals){let old:Receipt;try{const raw=await text(cwd,join(root(cwd),current.generation,'receipt.json'),128000);if(hash(raw)!==current.digest)throw new Error('Untrusted old receipt');old=JSON.parse(raw);}catch{throw new Error('Cannot trust old plugin names: receipt does not match the approved pointer; explicit allowRemovals policy review is required');}
   if(!Array.isArray(old.plugins)||old.plugins.some(row=>!row||typeof row.name!=='string'||!candidate.receipt.plugins.some(next=>next.name===row.name)))throw new Error('Remediation removal is denied by distribution policy');}
 }
 const binding={current,candidate:id,candidateDigest:candidate.digest,authorityDigest:hash(JSON.stringify(config)),replacesUntrustedGeneration:true as const};
 return {...binding,reviewDigest:hash(JSON.stringify(['CCPT/plugin-trust-remediation/v1',binding])),previousArtifactsPreserved:true,executesPluginCode:false};
}
export async function previewPluginSetRemediation(cwd:string,id:string){return remediationReview(cwd,id,await loadConfig(cwd));}
export async function remediatePluginSet(cwd:string,id:string,expectedDigest:string,confirmed:boolean){
 if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('Expected remediation review digest is required');
 return mutation(cwd,confirmed,async config=>{const review=await remediationReview(cwd,id,config);if(review.reviewDigest!==expectedDigest)throw new Error('Remediation authority/artifacts/pointer changed; review again');const selected=await withReviewedRollout(id,()=>switchSet(cwd,id,review.current.version,config));return {...selected,previousArtifactsPreserved:true,replacedUntrustedGeneration:true};});
}
export async function pluginSetHealth(cwd:string){
 const current=await pointer(cwd),config=await loadConfig(cwd);if(!current)return {current:null,trusted:true,executesPluginCode:false};
 try{const verified=await verifySet(cwd,current.generation,config);return {current,trusted:verified.digest===current.digest,executesPluginCode:false};}
 catch{return {current,trusted:false,reason:'Current signatures, revocation, locks, artifacts or receipts failed validation. Use remediation-preview with a separately trusted signed generation.',executesPluginCode:false};}
}

const pendingName=(name:string)=>/^\.pending-[A-Za-z0-9_-]{6,64}$/.test(name);
async function pendingReview(cwd:string,name:string,config:PlatformConfig){
 if(!pendingName(name))throw new Error('Invalid interrupted staging name');
 const directory=join(root(cwd),name),raw=await text(cwd,join(directory,'receipt.json'),128000),receipt=JSON.parse(raw) as Receipt;
 // Incomplete or unsigned work is never adopted, even when normal local stages
 // permit unsigned plugins. Recovery cannot infer a dead installer's intent.
 const verified=await verifySet(cwd,receipt.id,{...config,requirePluginSignatures:true},directory);
 const binding={name,id:receipt.id,digest:verified.digest,authority:hash(JSON.stringify(config))};
 return {...binding,reviewDigest:hash(JSON.stringify(binding)),plugins:verified.receipt.plugins.map(row=>({name:row.name,version:row.version,digest:row.digest})),activated:false};
}
export async function inventoryPluginSets(cwd:string){
 const config=await loadConfig(cwd),directory=root(cwd);await safePluginStatePath(cwd,directory);
 let names:string[];try{names=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {current:null,generations:[],interrupted:[]};throw error;}
 const selected=names.filter(name=>validId(name)||pendingName(name));if(selected.length>128)throw new Error('Plugin-set inventory exceeds 128 entries; operator archive required');
 const generations=[],interrupted=[];
 for(const name of selected.sort()){
  try{if(pendingName(name))interrupted.push({recoverable:true,...await pendingReview(cwd,name,config)});else {const verified=await verifySet(cwd,name,config);generations.push({id:name,digest:verified.digest,valid:true});}}
  catch{if(pendingName(name))interrupted.push({name,recoverable:false,reason:'Incomplete, untrusted or invalid staging; retained for operator inspection'});else generations.push({id:name,valid:false});}
 }
 return {current:await pointer(cwd),generations,interrupted};
}
export async function recoverInterruptedPluginSet(cwd:string,name:string,expectedDigest:string,confirmed:boolean){
 if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('Expected interrupted-stage review digest is required');
 return mutation(cwd,confirmed,async config=>{
  const checked=await pendingReview(cwd,name,config);if(checked.reviewDigest!==expectedDigest)throw new Error('Interrupted stage review changed; inspect again');
  const source=join(root(cwd),name),target=join(root(cwd),checked.id);await safePluginStatePath(cwd,target);
  try{await lstat(target);throw new Error('Recovered generation already exists; inspect both without overwriting');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await rename(source,target);
  return {id:checked.id,digest:checked.digest,recovered:true,activated:false,current:await pointer(cwd)};
 });
}
export async function inspectPluginSet(cwd:string,id?:string){const current=await pointer(cwd);if(!id&&!current)return {current:null};const selected=id??current!.generation,config=await loadConfig(cwd),verified=await verifySet(cwd,selected,config);if(!id&&current!.digest!==verified.digest)throw new Error('Active plugin-set receipt changed');return {current,id:selected,digest:verified.digest,plugins:verified.receipt.plugins};}
export async function pluginSetDirectories(cwd:string,config:PlatformConfig):Promise<string[]>{if(!config.usePluginSets)return config.pluginDirectories;const current=await pointer(cwd);if(!current)throw new Error('Plugin sets enabled but no active generation; stage/activate explicitly');const verified=await verifySet(cwd,current.generation,config);if(verified.digest!==current.digest)throw new Error('Active plugin-set receipt changed');const normalize=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path),managed=[join(projectStateDir(cwd),'plugins'),join(projectStateDir(cwd),'plugins-local')].map(normalize);return [join(verified.directory,'plugins'),...config.pluginDirectories.filter(path=>!managed.includes(normalize(path)))];}

/** Read the pointer only once, so artifact directories and independently signed
 * overlays always come from the same generation even during another window's CAS. */
export async function pluginSetConfiguration(cwd:string,config:PlatformConfig){
 if(!config.usePluginSets)return {directories:config.pluginDirectories,overlays:config.pluginOverlays??{}};
 const current=await pointer(cwd);if(!current)throw new Error('Plugin sets enabled but no active generation; stage/activate explicitly');
 const verified=await verifySet(cwd,current.generation,config);if(verified.digest!==current.digest)throw new Error('Active plugin-set receipt changed');
 const overlays={...config.pluginOverlays};
 for(const row of verified.receipt.plugins)if(row.overlay){if(overlays[row.name]&&JSON.stringify(overlays[row.name])!==JSON.stringify(row.overlay))throw new Error('Settings overlay conflicts with active plugin generation; remove the conflicting explicit setting before switching');overlays[row.name]=row.overlay;}
 const normalize=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path),managed=[join(projectStateDir(cwd),'plugins'),join(projectStateDir(cwd),'plugins-local')].map(normalize);
 return {directories:[join(verified.directory,'plugins'),...config.pluginDirectories.filter(path=>!managed.includes(normalize(path)))],overlays};
}
