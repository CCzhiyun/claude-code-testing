// Explicit product files only. No private project state in the product snapshot.
import {createHash} from 'node:crypto';
import {lstat,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),mode=process.argv[2],file=join(root,'.ccpt/implementation-064/source-snapshot.json');
if(!['capture','verify'].includes(mode??''))throw new Error('Use capture|verify');
const items=[];
async function visit(relative){const path=join(root,relative),info=await lstat(path);if(info.isSymbolicLink())throw new Error('Snapshot refuses links');if(info.isDirectory()){for(const name of(await readdir(path)).sort())await visit(join(relative,name));return;}if(!info.isFile()||info.size>32*1024*1024)throw new Error('Invalid source snapshot file');items.push({path:relative.split(sep).join('/'),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}
for(const target of ['src','dist','test','scripts','vscode-extension','package.json','package-lock.json','tsconfig.json','tsconfig.declarations.json','README.md','docs/settings.schema.json','docs/DELIVERY-0.64.zh-CN.md','docs/REMAINING-0.64.zh-CN.md'])await visit(target);
items.sort((a,b)=>a.path.localeCompare(b.path));const digest=createHash('sha256').update(JSON.stringify(items)).digest('hex');
if(mode==='capture'){await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({at:new Date().toISOString(),digest,items},null,2));console.log(JSON.stringify({captured:true,files:items.length,digest}));}
else {const previous=JSON.parse(await readFile(file,'utf8'));if(previous.digest!==digest)throw new Error('Product sources changed during validation; do not claim a frozen regression');console.log(JSON.stringify({pass:true,files:items.length,digest,unchangedSince:previous.at}));}
