const vscode = require('vscode');
const { BridgeTransport } = require('./bridge.cjs');

class Bridge extends BridgeTransport {
  constructor(cwd, context) {
    const command = vscode.workspace.getConfiguration('ccpt').get('command', 'ccpt');
    const key = 'ccpt.projectEventCursor:' + cwd;
    super(cwd, command, new vscode.EventEmitter(), { cursor: context.workspaceState.get(key), onCursor: cursor => context.workspaceState.update(key, cursor) });
  }
}

class AgentsProvider {
  constructor(bridge) { this.bridge = bridge; this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; }
  refresh() { this.emitter.fire(); }
  async getChildren() { return await this.bridge.request('agents/list'); }
  getTreeItem(agent) {
    const item = new vscode.TreeItem(`${agent.role}: ${agent.goal}`, vscode.TreeItemCollapsibleState.None);
    item.description = agent.status;
    item.tooltip = `${agent.id}\n${agent.summary || ''}`;
    item.contextValue = agent.status === 'working' || agent.status === 'queued' ? 'runningAgent' : 'agent';
    item.agentId = agent.id;
    return item;
  }
}

class PlansProvider {
  constructor(bridge, teams = false) { this.bridge = bridge; this.teams = teams; this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; }
  refresh() { this.emitter.fire(); }
  async getChildren() { return await this.bridge.request(this.teams ? 'teams/list' : 'plan/list'); }
  getTreeItem(record) {
    const item = new vscode.TreeItem(this.teams ? record.name : record.title, vscode.TreeItemCollapsibleState.None);
    item.description = this.teams ? record.ownerAgentId : `${record.status} · v${record.version}`;
    if (!this.teams) item.command = { command: 'ccpt.reviewPlan', title: 'Review the selected version', arguments: [{ id: record.id, version: record.version }] };
    return item;
  }
}

class SessionsProvider {
  constructor(bridge) { this.bridge = bridge; this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; }
  refresh() { this.emitter.fire(); }
  async getChildren() { return await this.bridge.request('sessions/list'); }
  getTreeItem(session) {
    const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None);
    item.description = new Date(session.updatedAt).toLocaleString();
    item.contextValue = 'savedSession';
    item.sessionId = session.id;
    item.command = { command: 'ccpt.openSessionHistory', title: 'View saved conversation (no execution)', arguments: [item] };
    return item;
  }
}

class NotificationsProvider {
  constructor(bridge) { this.bridge=bridge; this.limit=100; this.emitter=new vscode.EventEmitter(); this.onDidChangeTreeData=this.emitter.event; }
  refresh() { this.emitter.fire(); }
  async getChildren() {
    const result=await this.bridge.request('notifications/list',{limit:100,offset:this.offset||0});
    return [...result.items.map(item=>({...item,notificationVersion:result.version})), ...(result.nextOffset===null ? [] : [{moreOffset:result.nextOffset}])];
  }
  getTreeItem(record) {
    if (record.moreOffset!==undefined) { const item=new vscode.TreeItem('Older notifications…'); item.command={command:'ccpt.moreNotifications',title:'Older notifications',arguments:[record.moreOffset]}; return item; }
    const item=new vscode.TreeItem(record.title,vscode.TreeItemCollapsibleState.None);
    item.description=`${record.readAt ? 'read' : 'unread'} · ${new Date(record.createdAt).toLocaleString()}`;
    item.tooltip=record.body; item.contextValue=record.readAt ? 'readNotification' : 'unreadNotification';
    item.iconPath=new vscode.ThemeIcon(record.level==='error' ? 'error' : record.level==='warning' ? 'warning' : 'bell');
    item.command={command:'ccpt.viewNotification',title:'View notification',arguments:[record]};
    item.notification=record; return item;
  }
}

function html() {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><style>
  body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)}#log{display:flex;flex-direction:column;gap:12px;margin-bottom:150px}.m{padding:12px;border-radius:8px;background:var(--vscode-editor-inactiveSelectionBackground);white-space:pre-wrap}.user{border-left:3px solid var(--vscode-focusBorder)}.assistant{border-left:3px solid var(--vscode-charts-green)}.error{border-left:3px solid var(--vscode-errorForeground)}#activity{min-height:24px;margin:8px 0;color:var(--vscode-descriptionForeground);white-space:pre-wrap}.technical{font-family:var(--vscode-editor-font-family)}#composer{position:fixed;left:12px;right:12px;bottom:12px;background:var(--vscode-editor-background);display:grid;gap:8px}textarea{resize:vertical;min-height:72px;padding:10px;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}button{padding:8px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0}button:disabled{opacity:.55}.row{display:flex;justify-content:space-between;align-items:center}</style></head><body>
  <div class="row"><h2>CCPT</h2><label><input id="focus" type="checkbox" checked> Focus View</label></div><div class="row"><button id="restore">Restore saved conversation</button><button id="older" hidden>Older messages</button><button id="refreshHistory" hidden>Refresh saved history</button><button id="savedActivity" hidden>Saved activity</button><button id="replay" hidden>Replay journal</button><button id="replayMore" hidden>More journal</button></div><div id="attachments"></div><div id="log"></div><div id="savedActivityLog" hidden></div><div id="activity" role="status" aria-live="polite"></div><div id="composer"><textarea id="prompt" placeholder="Describe a coding task. Current file and selection are attached automatically."></textarea><div class="row"><button id="attach">Attach files</button><button id="send">Send</button></div></div>
  <script>
  const vscode=acquireVsCodeApi(),log=document.getElementById('log'),prompt=document.getElementById('prompt'),focus=document.getElementById('focus'),activity=document.getElementById('activity'),send=document.getElementById('send');
  let live,turn=-1,busy=false;
  function add(text,kind){const el=document.createElement('div');el.className='m '+kind;el.textContent=text;log.appendChild(el);el.scrollIntoView();return el}
  function liveMessage(nextTurn){if(!live||turn!==nextTurn){turn=nextTurn;live=add('','assistant');}return live}
  function status(text,technical=false){activity.className=technical?'technical':'';activity.textContent=text;activity.hidden=technical&&focus.checked}
  function runtime(event){
    if(event.type==='turn_started')status('✻ Thinking…');
    else if(event.type==='thinking_delta')status('✻ Thinking…');
    else if(event.type==='text_delta'&&!event.displaySuppressed){liveMessage(event.turn).textContent+=event.delta;live.scrollIntoView();status('● Responding…')}
    else if(event.type==='display_message'){liveMessage(event.turn).textContent=event.text;live.scrollIntoView();}
    else if(event.type==='tool_started')status('● '+event.name+'…',true);
    else if(event.type==='tool_completed')status((event.isError?'× ':'✓ ')+event.name+' ('+event.durationMs+'ms)',true);
    else if(event.type==='usage_updated')status('↑ '+event.inputTokens+' input · ↓ '+event.outputTokens+' output tokens',true);
    else if(event.type==='input_required')status('Input required');
    else if(event.type==='agent_failed')status('× '+event.error);
    else if(event.type==='agent_completed')status('✓ Completed');
  }
  function finish(text){if(live){live.textContent=text||live.textContent;live.classList.remove('streaming')}else if(text)add(text,'assistant');live=undefined;turn=-1;busy=false;send.disabled=false;status('')}
  send.onclick=()=>{const goal=prompt.value.trim();if(goal&&!busy){busy=true;send.disabled=true;live=undefined;turn=-1;add(goal,'user');status('Queued…');vscode.postMessage({type:'send',goal,focus:focus.checked});prompt.value=''}};
  prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();send.click()}});
  focus.onchange=()=>{if(activity.className==='technical')activity.hidden=focus.checked};
  document.getElementById('attach').onclick=()=>vscode.postMessage({type:'attach'});
  document.getElementById('restore').onclick=()=>{if(!busy)vscode.postMessage({type:'restore'})};
  document.getElementById('older').onclick=()=>{if(!busy)vscode.postMessage({type:'older'})};
  document.getElementById('refreshHistory').onclick=()=>{if(!busy)vscode.postMessage({type:'refreshHistory'})};
  document.getElementById('savedActivity').onclick=()=>{if(!busy)vscode.postMessage({type:'savedActivity'})};
  document.getElementById('replay').onclick=()=>{if(!busy)vscode.postMessage({type:'replay'})};
  document.getElementById('replayMore').onclick=()=>{if(!busy)vscode.postMessage({type:'replayMore'})};
  window.addEventListener('message',e=>{const m=e.data;if(m.type==='runtime')runtime(m.event);if(m.type==='result')finish(m.text);if(m.type==='error'){add(m.text,'error');busy=false;send.disabled=false;status('')}if(m.type==='attachments')document.getElementById('attachments').textContent=m.text;
    if(m.type==='historyBusy'){busy=m.busy;send.disabled=busy;}
    if(m.type==='history'){
      if(!m.prepend){log.replaceChildren();live=undefined;turn=-1;}
      const fragment=document.createDocumentFragment();
      for(const row of m.page.items){const el=document.createElement('div');el.className='m '+row.role;el.textContent=row.text||('[Saved '+row.role+' message; tools: '+row.tools.join(', ')+', images: '+row.images+']');if(row.truncated)el.textContent+=' [preview truncated]';fragment.appendChild(el);}
      log.insertBefore(fragment,log.firstChild);document.getElementById('older').hidden=!m.page.nextCursor;document.getElementById('refreshHistory').hidden=false;document.getElementById('savedActivity').hidden=false;document.getElementById('replay').hidden=false;document.getElementById('replayMore').hidden=true;
      if(!m.prepend)document.getElementById('savedActivityLog').replaceChildren();
      status('Saved conversation preview · no model or tool replay'+(m.runtimeCount!==undefined?' · '+m.runtimeCount+' retained activity records':''));
    }
    if(m.type==='savedActivity'||m.type==='replay'){
      const target=document.getElementById('savedActivityLog');if(!m.append)target.replaceChildren();target.hidden=false;
      for(const row of m.page.items){const el=document.createElement('div');el.className='m technical';el.textContent=row.at+' · '+row.type+(row.name?' · '+row.name:'')+(row.text?'\\n'+row.text:'')+(row.truncated?' [truncated]':'');target.appendChild(el);}
      if(m.type==='replay'){document.getElementById('replayMore').hidden=!m.page.hasMore;status('Captured journal · text according to capture mode · never executes historical actions'+(m.page.captureFailure?' · CAPTURE GAP: inspect journal; history is incomplete':''));}
      else status('Bounded saved activity · redacted text only if enabled before execution · no tool replay'+(m.page.reset?' · retention gap; reload current state':''));
    }
  });
  vscode.postMessage({type:'ready'});
  </script></body></html>`;
}

async function attachmentContext(paths) {
  const parts = [];
  let remaining = 500_000;
  for (const path of paths.slice(0, 20)) {
    if (remaining <= 0) break;
    try {
      const uri = vscode.Uri.file(path);
      const info = await vscode.workspace.fs.stat(uri);
      if ((info.type & vscode.FileType.File) === 0) { parts.push(`Attached path (not a file): ${path}`); continue; }
      if (info.size > 250_000) { parts.push(`Attached file omitted because it exceeds 250 KB: ${path}`); continue; }
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.includes(0)) { parts.push(`Attached binary file (contents omitted): ${path}`); continue; }
      const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, remaining);
      remaining -= content.length;
      parts.push(`Attached file contents: ${path}\n${content}`);
    } catch (error) {
      parts.push(`Attached file could not be read: ${path} (${String(error.message || error)})`);
    }
  }
  return parts.join('\n\n');
}

function activate(context) {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const bridge = new Bridge(cwd, context);
  const agents = new AgentsProvider(bridge);
  const sessions = new SessionsProvider(bridge);
  const plans = new PlansProvider(bridge), teams = new PlansProvider(bridge, true);
  const notifications = new NotificationsProvider(bridge);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ccpt.notifications',notifications));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.moreNotifications',offset=>{notifications.offset=offset;notifications.refresh();}));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.refreshNotifications',()=>{notifications.offset=0;notifications.refresh();}));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.viewNotification',async record=>{
    try { const document=await vscode.workspace.openTextDocument({content:`${record.title}\n${record.createdAt}\n\n${record.body}`,language:'plaintext'}); await vscode.window.showTextDocument(document,{preview:true}); }
    catch(error){vscode.window.showErrorMessage(String(error.message||error));}
  }));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.markNotificationRead',async item=>{
    const record=item?.notification; if(!record)return;
    try { await bridge.request('notifications/read',{ids:[record.id],expectedVersion:record.notificationVersion}); }
    catch(error){vscode.window.showErrorMessage(String(error.message||error));}
    finally{notifications.refresh();}
  }));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ccpt.plans', plans), vscode.window.registerTreeDataProvider('ccpt.teams', teams));
  context.subscriptions.push(bridge.stateChanged, bridge.stateChanged.event(event => { agents.refresh(); sessions.refresh(); plans.refresh(); teams.refresh(); notifications.refresh(); if(event.method==='project/outbox-error')void vscode.window.showWarningMessage(event.params.message); }));
  context.subscriptions.push(bridge, vscode.window.registerTreeDataProvider('ccpt.agents', agents), vscode.window.registerTreeDataProvider('ccpt.sessions', sessions));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.refreshAgents', () => agents.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.resolveConflict',async()=>{
    try{
      const conflicts=await bridge.request('conflict/list');const selected=await vscode.window.showQuickPick(conflicts.map(item=>({label:item.path,description:item.kind||item.status||'unmerged',path:item.path})),{title:'Select exact conflicted path'});if(!selected)return;
      const review=await bridge.request('conflict/review',{path:selected.path});const document=await vscode.workspace.openTextDocument({content:JSON.stringify(review,null,2),language:'json'});await vscode.window.showTextDocument(document,{preview:true});
      const chosen=await vscode.window.showQuickPick([{label:'Use ours',choice:'ours'},{label:'Use theirs',choice:'theirs'},{label:'Use manually edited working bytes/deletion',choice:'working'},{label:'Delete path',choice:'delete'}],{title:'Review bytes/modes; absent side means deletion, not empty content'});if(!chosen)return;
      if(await vscode.window.showWarningMessage(`Apply ${chosen.choice} to ${review.path}? Original working bytes/index are retained; resolution is staged. No commit/push.`,{modal:true},'Apply exact reviewed resolution')!=='Apply exact reviewed resolution')return;
      const result=await bridge.request('conflict/resolve',{path:review.path,choice:chosen.choice,expectedVersion:review.version,confirm:true});vscode.window.showInformationMessage(`Resolved ${result.path}; backup ${result.backup}`);
    }catch(error){vscode.window.showErrorMessage(String(error.message||error));}
  }));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.goalRuns',async()=>{
    try{
      const inventory=await bridge.request('goal-run/list');
      const selected=await vscode.window.showQuickPick([{label:'Prepare a new approved-Plan workflow',prepare:true},...inventory.items.map(run=>({label:`${run.phase} · v${run.version} · ${run.id}`,description:`${run.requests}/${run.budget.maxRequests} requests`,run}))],{title:'Goal workflows · human decisions only'});if(!selected)return;
      if(selected.prepare){
        const candidates=await bridge.request('goal-run/candidates');if(!candidates.length)throw new Error('Approve a Plan and set an active Goal in its original session first.');
        const chosen=await vscode.window.showQuickPick(candidates.map(candidate=>({label:candidate.title,description:`${candidate.planId} · v${candidate.expectedPlanVersion}`,candidate})),{title:'Choose already approved Plan'});if(!chosen)return;
        const integer=async(prompt,max,min=1)=>{const value=await vscode.window.showInputBox({prompt,validateInput:text=>/^\d+$/.test(text)&&Number.isSafeInteger(Number(text))&&Number(text)>=min&&Number(text)<=max?undefined:`Enter an integer from ${min} to ${max}`});return value===undefined?undefined:Number(value);};
        const maxRequests=await integer('Lifetime paid-model request budget',1000);if(maxRequests===undefined)return;const maxTokens=await integer('Lifetime token budget',100000000,1024);if(maxTokens===undefined)return;
        const toolText=await vscode.window.showInputBox({prompt:'Allowed tools, comma-separated; unlisted tools are denied',placeHolder:'read_file,write_file,run_command'});if(!toolText)return;const allowedTools=toolText.split(',').map(t=>t.trim()).filter(Boolean);
        const input={...chosen.candidate,maxRequests,maxTokens,allowedTools};const document=await vscode.workspace.openTextDocument({content:JSON.stringify(input,null,2),language:'json'});await vscode.window.showTextDocument(document,{preview:true});
        if(await vscode.window.showWarningMessage('Prepare this reviewed workflow? No model request now; explicit start is still required.',{modal:true},'Prepare')!=='Prepare')return;const result=await bridge.request('goal-run/prepare',{...input,confirm:true});vscode.window.showInformationMessage(`Prepared ${result.id}; use Goal Workflows to review/start.`);return;
      }
      const run=await bridge.request('goal-run/show',{id:selected.run.id});if(run.version!==selected.run.version)throw new Error('Goal run changed; reopen Goal Workflows and review again.');
      const document=await vscode.workspace.openTextDocument({content:JSON.stringify(run,null,2),language:'json'});await vscode.window.showTextDocument(document,{preview:true});
      const choices=run.phase==='ready'?['Start paid execution','Cancel run']:run.phase==='waiting'||run.phase==='failed'||run.phase==='unknown'?['Prepare continuation','Cancel run']:run.phase==='running'?['Reconcile interrupted owner','Cancel run']:[];
      const choice=await vscode.window.showQuickPick(choices,{title:`Reviewed ${run.id} · v${run.version}`});if(!choice)return;const action=choice==='Start paid execution'?'start':choice==='Prepare continuation'?'resume':choice==='Reconcile interrupted owner'?'recover':'cancel';let feedback;
      if(action==='resume'&&!run.pendingRequestId){feedback=await vscode.window.showInputBox({prompt:run.phase==='unknown'?'Record independent verification of unknown external effects before continuation':'Human continuation feedback'});if(!feedback)return;}
      const warning=action==='resume'&&run.pendingRequestId?`Approve exactly this permission once and prepare continuation? ${JSON.stringify(run.pendingPermission)}`:run.phase==='unknown'&&action==='resume'?'You attest unknown external effects were independently verified. Prepare only, no automatic replay.':`${choice}? Existing Plan, policy, budget and reviewed-version checks remain enforced.`;
      if(await vscode.window.showWarningMessage(warning,{modal:true},'Confirm reviewed action')!=='Confirm reviewed action')return;
      const result=await bridge.request('goal-run/decide',{id:run.id,expectedVersion:run.version,action,confirm:true,...(feedback?{feedback}:{}),...(action==='resume'&&run.pendingRequestId?{approveRequestId:run.pendingRequestId}:{}),confirmUnknown:run.phase==='unknown'&&action==='resume'});vscode.window.showInformationMessage(JSON.stringify(result));
    }catch(error){vscode.window.showErrorMessage(String(error.message||error));}finally{agents.refresh();plans.refresh();}
  }));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.reviewPlan', async selected => {
    if (!selected?.id) return;
    try {
      const plan = await bridge.request('plan/show', { id: selected.id });
      if (plan.version !== selected.version) { plans.refresh(); throw new Error('Plan changed. Select its updated version and review again.'); }
      const document = await vscode.workspace.openTextDocument({ content: `# ${plan.title}\nVersion ${plan.version} · ${plan.status}\n\n${plan.content}`, language: 'markdown' });
      await vscode.window.showTextDocument(document, { preview: true });
      if (plan.status !== 'pending_approval') return;
      const choice = await vscode.window.showQuickPick(['Approve', 'Request changes', 'Reject'], { title: `Plan ${plan.id} · reviewed version ${plan.version}` });
      if (!choice) return;
      const decision = choice === 'Approve' ? 'approved' : choice === 'Reject' ? 'rejected' : 'changes_requested';
      if (await vscode.window.showWarningMessage(`${choice} reviewed Plan version ${plan.version}? This does not execute the Plan.`, { modal: true }, choice) !== choice) return;
      const comment = decision === 'changes_requested' ? await vscode.window.showInputBox({ prompt: 'Revision feedback' }) : undefined;
      if (decision === 'changes_requested' && comment === undefined) return;
      await bridge.request('plan/decide', { id: plan.id, expectedVersion: plan.version, decision, ...(comment ? { comment } : {}) });
      plans.refresh();
    } catch (error) { plans.refresh(); vscode.window.showErrorMessage(String(error.message || error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.cancelAgent', async item => {
    const id = item?.agentId || await vscode.window.showInputBox({ prompt: 'Agent id to cancel' });
    if (!id) return;
    try { await bridge.request('agent/cancel', { id }); agents.refresh(); }
    catch (error) { vscode.window.showErrorMessage(String(error.message || error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.resumeSession', async item => {
    const id = item?.sessionId || await vscode.window.showInputBox({ prompt: 'Session id to resume' });
    if (!id) return;
    const goal = await vscode.window.showInputBox({ prompt: 'What should CCPT do next?', value: 'Continue the saved task.' });
    if (!goal) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CCPT is resuming the session' }, async () => {
      const result = await bridge.request('session/resume', { id, goal });
      vscode.window.showInformationMessage(result.result || result.error || result.status);
      agents.refresh(); sessions.refresh();
    });
  }));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.openSessionHistory', item => vscode.commands.executeCommand('ccpt.open', {sessionId:item?.sessionId})));
  context.subscriptions.push(vscode.commands.registerCommand('ccpt.open', selected => {
    const panel = vscode.window.createWebviewPanel('ccpt.chat', 'CCPT', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = html();
    let agentId;
    const savedKey='ccpt.lastChatSession:'+cwd;
    let sessionId=selected?.sessionId,olderCursor,replayCursor,running=false,loadingHistory=false;
    async function restoreHistory(id,prepend=false){
      if(!prepend)replayCursor=undefined;
      if(running||loadingHistory)return;
      loadingHistory=true;
      panel.webview.postMessage({type:'historyBusy',busy:true});
      try{
        const page=await bridge.request('session/history',{id,includeText:true,textLimit:16000,...(prepend&&olderCursor?{cursor:olderCursor}:{})});
        const runtime=prepend?undefined:await bridge.request('runtime/history',{id,limit:200});
        sessionId=id;agentId=undefined;olderCursor=page.nextCursor;
        await context.workspaceState.update(savedKey,id); // ID only; no transcript in extension state.
        panel.webview.postMessage({type:'history',page,prepend,...(runtime?{runtimeCount:runtime.items.length}: {})});
      }catch(error){panel.webview.postMessage({type:'error',text:String(error.message||error)});}
      finally{loadingHistory=false;panel.webview.postMessage({type:'historyBusy',busy:false});}
    }
    let attachments = [];
    panel.webview.onDidReceiveMessage(async message => {
      if(message.type==='ready'){
        const restoreId=sessionId||(vscode.workspace.getConfiguration('ccpt').get('restoreSessionHistory',false)?context.workspaceState.get(savedKey):undefined);
        if(restoreId)await restoreHistory(restoreId);return;
      }
      if(message.type==='savedActivity'){
        if(running||loadingHistory||!sessionId)return;
        try{const page=await bridge.request('runtime/history',{id:sessionId,limit:200,includeText:true});panel.webview.postMessage({type:'savedActivity',page});}catch(error){panel.webview.postMessage({type:'error',text:String(error.message||error)});}return;
      }
      if(message.type==='replay'||message.type==='replayMore'){
        if(running||loadingHistory||!sessionId)return;
        try{const append=message.type==='replayMore',page=await bridge.request('runtime/replay',{id:sessionId,limit:200,includeText:true,...(append&&replayCursor?{cursor:replayCursor}:{})});replayCursor=page.cursor;panel.webview.postMessage({type:'replay',page,append});}catch(error){panel.webview.postMessage({type:'error',text:String(error.message||error)});}return;
      }
      if(['restore','older','refreshHistory'].includes(message.type)){
        if(running||loadingHistory)return;
        if(message.type==='older'){if(sessionId&&olderCursor)await restoreHistory(sessionId,true);return;}
        if(message.type==='refreshHistory'){if(sessionId)await restoreHistory(sessionId);return;}
        const choices=await bridge.request('sessions/list');
        const choice=await vscode.window.showQuickPick(choices.map(row=>({label:row.title,description:row.id,id:row.id})),{title:'View saved conversation (preview only; no execution)'});
        if(choice)await restoreHistory(choice.id);return;
      }
      if (message.type === 'attach') {
        const selected = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach to CCPT' });
        attachments = selected?.map(uri => uri.fsPath) || attachments;
        panel.webview.postMessage({ type: 'attachments', text: attachments.length ? `Attached: ${attachments.join(', ')}` : '' });
        return;
      }
      if (message.type !== 'send') return;
      if (running || loadingHistory) {panel.webview.postMessage({type:'error',text:'Conversation is busy; wait for the current operation before sending.'});return;}
      running=true;
      try {
      const editor = vscode.window.activeTextEditor;
      const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
      const file = editor ? editor.document.uri.fsPath : '';
      const attached = attachments.length ? await attachmentContext(attachments) : '';
      const contextText = `${file ? `Active file: ${file}` : ''}${selection ? `\nSelection:\n${selection.slice(0, 100_000)}` : ''}${attached ? `\n\n${attached}` : ''}`;
        const result = await bridge.request('chat/send', { goal: message.goal, context: contextText, agentId,...(sessionId?{sessionId}:{}) }, event => panel.webview.postMessage({ type: 'runtime', event }));
        agentId = result.id;
        if(result.sessionId){sessionId=result.sessionId;await context.workspaceState.update(savedKey,sessionId);}
        panel.webview.postMessage({ type: 'result', text: message.focus ? (result.displayResult ?? result.result ?? result.error ?? result.status) : JSON.stringify(result, null, 2) });
        agents.refresh();
      } catch (error) { panel.webview.postMessage({ type: 'error', text: String(error.message || error) }); }
      finally {running=false;}
    });
  }));
  const timer = setInterval(() => { agents.refresh(); sessions.refresh(); plans.refresh(); teams.refresh(); notifications.refresh(); }, 3000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {}
module.exports = { activate, deactivate };
