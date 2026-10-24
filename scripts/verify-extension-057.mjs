// Execute actual extension handlers with a stub VS Code host and built SDK store.
// This is not real VS Code / Remote certification.
import assert from 'node:assert/strict';
import Module,{createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const project=dirname(dirname(fileURLToPath(import.meta.url))),root=await mkdtemp(join(tmpdir(),'ccpt-extension-057-'));
for(const name of Object.keys(process.env))if(/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(name))delete process.env[name];process.env.CCPT_HOME=join(root,'home');
const sdk=await import(pathToFileURL(join(project,'dist/entrypoints/sdk.js')).href),commands=new Map(),providers=new Map(),errors=[],documents=[],requests=[];
const context={subscriptions:[],workspaceState:{get(){},async update(){}}};
const disposable=()=>({dispose(){}});
class Emitter{listeners=[];event=fn=>{this.listeners.push(fn);return disposable();};fire(value){this.listeners.forEach(fn=>fn(value));}dispose(){}}
class FakeBridge{constructor(cwd,command,stateChanged){this.cwd=cwd;this.stateChanged=stateChanged;}async request(method,params={}){requests.push({method,params});if(method==='notifications/list')return sdk.listProjectNotifications(this.cwd,params);if(method==='notifications/read')return sdk.markProjectNotificationsRead(this.cwd,params.ids,params.expectedVersion);return [];}dispose(){}}
const vscode={EventEmitter:Emitter,TreeItem:class{constructor(label){this.label=label;}},TreeItemCollapsibleState:{None:0},ThemeIcon:class{constructor(id){this.id=id;}},workspace:{workspaceFolders:[{uri:{fsPath:root}}],getConfiguration:()=>({get:()=> 'fixture'}),async openTextDocument(value){documents.push(value);return value;}},window:{registerTreeDataProvider:(name,provider)=>{providers.set(name,provider);return disposable();},async showTextDocument(){},showErrorMessage:text=>errors.push(text)},commands:{registerCommand:(name,handler)=>{commands.set(name,handler);return disposable();}}};
const original=Module._load;
try{
  Module._load=function(name,parent,main){if(name==='vscode')return vscode;if(name==='./bridge.cjs'&&parent?.filename===join(project,'vscode-extension/extension.js'))return {BridgeTransport:FakeBridge};return original.call(this,name,parent,main);};
  createRequire(import.meta.url)(join(project,'vscode-extension/extension.js')).activate(context);Module._load=original;
  const note=await sdk.createProjectNotification(root,{title:'<script>not HTML</script>',body:'PRIVATE-BODY'}),provider=providers.get('ccpt.notifications');assert(provider);
  const [record]=await provider.getChildren(),item=provider.getTreeItem(record);assert.equal(item.contextValue,'unreadNotification');
  await commands.get('ccpt.viewNotification')(record);assert.equal(documents[0].language,'plaintext');assert(documents[0].content.includes('PRIVATE-BODY'));assert.equal((await sdk.listProjectNotifications(root)).unread,1);
  await sdk.createProjectNotification(root,{title:'New arrival',body:''});await commands.get('ccpt.markNotificationRead')(item);assert.equal((await sdk.listProjectNotifications(root)).unread,2);assert(errors.some(text=>text.includes('changed')));
  const fresh=await provider.getChildren(),selected=fresh.find(row=>row.id===note.id);await commands.get('ccpt.markNotificationRead')(provider.getTreeItem(selected));assert.equal((await sdk.listProjectNotifications(root)).unread,1);
  assert(requests.every(row=>['notifications/list','notifications/read'].includes(row.method)));
  const report={pass:true,runtime:'actual extension activate/provider/command handlers; stub VS Code host; built SDK',checks:['notification tree registration','plaintext preview with no auto-read','stale receipt rejected','fresh receipt affects one ID only','no chat/approval requests'],realVsCodeCertified:false,companyRequests:0,userSettingsModified:false};
  await mkdir(join(project,'.ccpt/foundation-057/final'),{recursive:true});await writeFile(join(project,'.ccpt/foundation-057/final/extension-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{Module._load=original;for(const item of context.subscriptions)item.dispose?.();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
