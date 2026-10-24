import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { cancelAgent, loadAgent, spawnAgent } from '../src/agent.js';
import { createSession, saveSession } from '../src/sessions.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';
import { permissionRequestPayload } from '../src/permissionApprovals.js';

test('actual background worker reconnects without duplicate inference, reuses its Agent and restores pending approval from the picker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-background-resume-')), state = join(root, 'state');
  const previousHome = process.env.CCPT_HOME, previousEntry = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_HOME = state; process.env.CCPT_CLI_ENTRY = resolve(import.meta.dir, '../src/cli.ts');
  let release!: () => void; const gate = new Promise<void>(resolveGate => { release = resolveGate; }); const requests: unknown[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) { requests.push(await request.json()); if (requests.length === 1) await gate; return Response.json({ choices: [{ message: { content: requests.length === 1 ? 'BACKGROUND_FINISHED_MARKER' : 'CONTINUED_SAME_AGENT_MARKER' }, finish_reason: 'stop' }] }); } });
  let ownerId: string | undefined; let child: ReturnType<typeof Bun.spawn> | undefined; let pumps: Promise<unknown> | undefined;
  try {
    const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.agents.defaultIsolation = 'none'; config.policy.workspaceRoots = [root];
    config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`; config.model.name = 'background-model';
    await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
    await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
    const owner = await spawnAgent({ goal: 'Inspect a long running engineering task', cwd: root, config, background: true, isolation: 'none' }); ownerId = owner.id;
    let deadline = Date.now() + 10000; while (!requests.length && Date.now() < deadline) await Bun.sleep(25);
    expect(requests).toHaveLength(1);
    const changedDefaults = structuredClone(config); changedDefaults.model.name = 'changed-settings-default'; changedDefaults.model.thinkingEnabled = true;
    await writeJson(join(root, '.ccpt', 'settings.json'), changedDefaults);
    const pending = await createSession('Pending approval fixture', root);
    const permission = permissionRequestPayload(pending.id, 'shell', { command: 'node', args: ['--version'] }, 'Explicit approval required');
    pending.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'pending-call', name: 'shell', input: permission.input }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'pending-call', content: JSON.stringify(permission) }] }); await saveSession(pending);
    const waitingId = 'agent_0000000000000099';
    await writeJson(join(state, 'agents', `${waitingId}.json`), { id: waitingId, sessionId: pending.id, teamSessionId: pending.id, cwd: root, depth: 0, role: 'lead', goal: 'Pending permission', status: 'waiting_for_input', result: JSON.stringify(permission), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const cli = resolve(import.meta.dir, '../src/cli.ts');
    const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); Object.defineProperty(process.stdout,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:100}); Object.defineProperty(process.stdout,'rows',{value:28}); process.argv=[process.execPath,${JSON.stringify(cli)},'--resume',${JSON.stringify(owner.sessionId)}]; await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    const env: Record<string, string> = { CCPT_HOME: state, CCPT_CLI_ENTRY: cli, DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' };
    for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
    child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    let output = '';
    const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) output += new TextDecoder().decode(chunk); };
    pumps = Promise.all([collect(child.stdout as ReadableStream<Uint8Array>), collect(child.stderr as ReadableStream<Uint8Array>)]);
    const until = async (marker: string) => { const untilAt = Date.now() + 12000; while (!output.includes(marker) && Date.now() < untilAt) await Bun.sleep(25); expect(output, `Missing UI marker ${marker}`).toContain(marker); output = ''; };
    const send = (keys: string) => { const input = child!.stdin as import('bun').FileSink; input.write(keys); input.flush(); };
    await until(`Attached Agent ${owner.id}`); expect(requests).toHaveLength(1);
    expect((await readdir(join(state, 'agents'))).filter(name => name.endsWith('.json'))).toHaveLength(2);
    release(); await until('BACKGROUND_FINISHED_MARKER');
    send('Continue this engineering task\r'); await until('CONTINUED_SAME_AGENT_MARKER');
    expect(requests).toHaveLength(2); expect((await loadAgent(owner.id)).sessionId).toBe(owner.sessionId);
    expect((requests[1] as { model: string }).model).toBe('background-model');
    expect((requests[1] as { reasoning_effort?: string }).reasoning_effort).toBeUndefined();
    expect((await readdir(join(state, 'agents'))).filter(name => name.endsWith('.json'))).toHaveLength(2);
    send('/resume\r'); await until('Space preview');
    send('/'); send('Pending approval fixture'); send('\r'); await until('Yes, allow once');
    expect(requests).toHaveLength(2); expect((await loadAgent(waitingId)).status).toBe('waiting_for_input');
    send('\u001b'); await until('? shortcuts');
    await expect(readFile(join(state, 'permission-approvals.json'))).rejects.toThrow();
    send('/exit\r'); await Promise.race([child.exited, Bun.sleep(3000)]);
  } finally {
    release(); if (child) { child.kill(); await child.exited; await pumps; }
    if (ownerId) await cancelAgent(ownerId).catch(() => undefined);
    server.stop(true);
    if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
    if (previousEntry === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = previousEntry;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup root');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}, 40000);
