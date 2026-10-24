import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {computePluginDigest,loadPluginAt,resolvePluginPath,validatePluginContributions,type LoadedPlugin,type PluginContributions} from './plugins.js';
import type {PlatformConfig} from './types.js';
import type {PluginSignature} from './pluginSignatures.js';

export interface SignedPluginOverlay {format:1;name:string;version:string;artifactDigest:string;contributes:PluginContributions;signature:PluginSignature}
function canonical(value:unknown,depth=0):unknown{
 if(depth>16)throw new Error('Overlay nesting limit exceeded');
 if(Array.isArray(value))return value.map(v=>canonical(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>{if(['__proto__','prototype','constructor'].includes(k))throw new Error('Unsafe overlay key');return [k,canonical((value as Record<string,unknown>)[k],depth+1)];}));
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 throw new Error('Overlay must contain JSON values');
}
function bytes(row:Omit<SignedPluginOverlay,'signature'>,keyId:string):Buffer{return Buffer.from(JSON.stringify(['CCPT/plugin-overlay/v1',canonical(row),keyId]));}
function structure(row:SignedPluginOverlay,plugin:LoadedPlugin):void{
 if(!row||row.format!==1||row.name!==plugin.name||row.version!==plugin.version||!/^[a-f0-9]{64}$/.test(row.artifactDigest)||!row.contributes||Array.isArray(row.contributes)||Object.keys(row).some(k=>!['format','name','version','artifactDigest','contributes','signature'].includes(k))||Object.keys(row.contributes).some(k=>!['skills','agents','commands','hooks','mcpServers','lspServers'].includes(k))||Buffer.byteLength(JSON.stringify(row))>64000)throw new Error('Invalid or mismatched signed plugin overlay');
 for(const key of ['skills','agents','commands','hooks'] as const)if(row.contributes[key]!==undefined&&!Array.isArray(row.contributes[key]))throw new Error('Overlay contribution must be an array');
 for(const path of [...(row.contributes.skills??[]),...(row.contributes.agents??[])])if(typeof path!=='string')throw new Error('Overlay path must be a relative string');else resolvePluginPath(plugin.path,path);
 canonical(row.contributes);
}
export async function signPluginOverlay(path:string,contributes:PluginContributions,keyFile:string,keyId:string):Promise<SignedPluginOverlay>{
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(keyId))throw new Error('Invalid overlay signing key ID');
 const plugin=await loadPluginAt(path),root=await realpath(plugin.path),keyPath=await realpath(resolve(keyFile));
 const normalize=(v:string)=>process.platform==='win32'?v.toLowerCase():v;
 if(normalize(keyPath)===normalize(root)||normalize(keyPath).startsWith(normalize(root)+sep))throw new Error('Overlay private key must remain outside the artifact');
 const key=createPrivateKey(await readFile(keyPath));if(key.asymmetricKeyType!=='ed25519')throw new Error('Overlay requires Ed25519');
 const base={format:1 as const,name:plugin.name,version:plugin.version,artifactDigest:await computePluginDigest(root),contributes};
 const row={...base,signature:{algorithm:'ed25519' as const,keyId,value:sign(null,bytes(base,keyId),key).toString('base64')}};structure(row,plugin);return row;
}
/** Called only AFTER the original artifact's lock and publisher signature pass.
 * Separate domain/key revocation checks; no changes to the signed artifact tree. */
export function applySignedPluginOverlay(plugin:LoadedPlugin,config:PlatformConfig):LoadedPlugin{
 const row=config.pluginOverlays?.[plugin.name];if(!row)return plugin;structure(row,plugin);
 if(!plugin.integrity?.signature||plugin.integrity.digest!==row.artifactDigest)throw new Error('Overlay requires a matching independently signed artifact');
 const signature=row.signature,pem=config.pluginTrustKeys?.[signature?.keyId];
 if(!signature||signature.algorithm!=='ed25519'||!pem||config.revokedPluginKeys?.includes(signature.keyId)||!(/^[A-Za-z0-9+/]{86}==$/.test(signature.value)))throw new Error('Overlay publisher is invalid, untrusted or revoked');
 const {signature:_,...base}=row;
 if(!verify(null,bytes(base,signature.keyId),createPublicKey(pem),Buffer.from(signature.value,'base64')))throw new Error('Overlay signature verification failed');
 const original=structuredClone(plugin.contributions),extra=structuredClone(row.contributes);
 for(const key of ['mcpServers','lspServers'] as const)for(const name of Object.keys(extra[key]??{}))if(Object.hasOwn(original[key]??{},name))throw new Error('Overlay cannot silently replace an existing server');
 const contributions:PluginContributions={skills:[...new Set([...(original.skills??[]),...(extra.skills??[])])],agents:[...new Set([...(original.agents??[]),...(extra.agents??[])])],commands:[...(original.commands??[]),...(extra.commands??[])],hooks:[...(original.hooks??[]),...(extra.hooks??[])],mcpServers:{...original.mcpServers,...extra.mcpServers},lspServers:{...original.lspServers,...extra.lspServers}};
 validatePluginContributions(plugin.path,contributions);
 return {...plugin,contributions,overlayKeyId:signature.keyId};
}
