import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';

test('raw-key TUI Skills preserve conversation, Teams panel manages actual workers, and fork returns to the lead', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-tui-050-')); const state = join(root, 'home'); const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any; requests.push(body);
    if (String(body.messages[0]?.content).includes('Goal: PLAN-TEAM-FIXTURE')) return Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'team-plan-submit', type: 'function', function: { name: 'exit_plan_mode', arguments: JSON.stringify({ plan: '# Team Plan\n\n- [ ] Inspect team fixture\n- [ ] Validate approved work' }) } }] }, finish_reason: 'tool_calls' }] });
    return Response.json({ choices: [{ message: { content: `UI-FIXTURE-${requests.length}-DONE` } }] });
  } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`; config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.disableBundledSkills = true; config.pluginDirectories = []; config.agentsDirectories = []; config.hooks = [];
  config.agentDefinitions = { reviewer: { description: 'Independent review', prompt: 'PROFILE-REVIEW', tools: ['read_file'], isolation: 'none' } };
  config.agentDefinitions.planner = { description: 'Plan approval fixture', prompt: 'Propose the requested plan', tools: ['read_file', 'exit_plan_mode'], isolation: 'none' };
  for (const [name, metadata, body] of [['explain', 'disable-model-invocation: true\nallowed-tools: Read', 'INLINE-ONLY $ARGUMENTS'], ['investigate', 'context: fork\nagent: reviewer', 'FORK-ONLY $ARGUMENTS']]) {
    await mkdir(join(root, '.ccpt', 'skills', name!), { recursive: true }); await writeFile(join(root, '.ccpt', 'skills', name!, 'SKILL.md'), `---\nname: ${name}\ndescription: Explicit ${name}\n${metadata}\n---\n${body}`);
  }
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:110}); Object.defineProperty(process.stdout,'rows',{value:30}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'050-test'); process.exit(0);`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), CCPT_API_KEY: 'fixture', DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }); let output = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) output += new TextDecoder().decode(chunk); }; const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const send = (text: string) => { child.stdin.write(text); child.stdin.flush(); };
  const until = async (marker: string) => { const deadline = Date.now() + 15000; while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(25); expect(output, `Missing terminal marker ${marker}`).toContain(marker); output = ''; };
  const records = async (): Promise<any[]> => { try { return await Promise.all((await readdir(join(state, 'agents'))).filter((name) => /^agent_.*\.json$/.test(name)).map(async (name) => JSON.parse(await readFile(join(state, 'agents', name), 'utf8')))); } catch { return []; } };
  const idle = async (count: number) => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const agents = await records(); if (agents.length === count && agents.every((agent) => agent.status === 'completed')) { await Bun.sleep(200); return agents; } await Bun.sleep(25); } throw new Error('Agents did not finish'); };
  try {
    await until('/model to change'); send('Remember LEAD-KAPPA-050\r'); await until('UI-FIXTURE-1-DONE'); const first = (await idle(1))[0];
    send('/explain layout\r'); await until('UI-FIXTURE-2-DONE'); expect((await idle(1))[0].id).toBe(first.id); expect(JSON.stringify(requests[1])).toContain('LEAD-KAPPA-050'); expect(requests[1].tools.map((tool: any) => tool.function.name)).toEqual(['read_file']);
    send('Write tests later\r'); await until('UI-FIXTURE-3-DONE'); await idle(1); expect(requests[2].messages[0].content).not.toContain('INLINE-ONLY');
    send('/team create Engineering\r'); await until('Engineering');
    send('/team spawn reviewer Inspect code\r'); await until('conversation unchanged.'); const agents = await idle(2); expect(requests).toHaveLength(4); expect(agents.find((agent) => agent.parentId)?.teamSessionId).toBe(first.sessionId);
    send('/teams\r'); await until('Members'); send('\u001b[C'); await until('Tasks'); send('\u001b[C'); await until('Inbox'); expect(requests).toHaveLength(4); send('\u001b'); await until('dismissed.');
    send('/investigate alternative\r'); await until('Returned to lead'); await idle(3); expect(JSON.stringify(requests[4])).not.toContain('LEAD-KAPPA-050'); expect(JSON.stringify(requests[4])).toContain('FORK-ONLY alternative');
    send('Continue main implementation\r'); await until('UI-FIXTURE-6-DONE'); await idle(3); expect(JSON.stringify(requests[5])).toContain('LEAD-KAPPA-050'); expect(requests[5].messages[0].content).not.toContain('FORK-ONLY');
    send('\u001b[Z'); await until('Permission mode:'); send('\u001b[Z'); await until('Plan mode: read-only'); send('\u001b[Z'); await until('Permission mode:'); expect(requests).toHaveLength(6);
    send('/team spawn --plan planner PLAN-TEAM-FIXTURE\r'); await until('conversation unchanged.');
    let planner: any; const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { planner = (await records()).find(agent => agent.role === 'planner' && agent.pendingPlanId); if (planner?.status === 'waiting_for_input') break; await Bun.sleep(25); }
    expect(planner?.status).toBe('waiting_for_input'); expect(planner?.pendingPlanId).toBeTruthy(); expect(requests).toHaveLength(7);
    send('/team plans\r'); await until('Team Plan'); expect(requests).toHaveLength(7);
    send('\u001b'); await until('dismissed.');
    send(`/plan approve ${planner.pendingPlanId}\r`); await until('Lead conversation unchanged.'); await idle(4); expect(requests).toHaveLength(8);
    send('Continue LEAD after teammate approval\r'); await until('UI-FIXTURE-9-DONE'); await idle(4);
    expect(JSON.stringify(requests[8])).toContain('LEAD-KAPPA-050'); expect(requests[8].messages[0].content).not.toContain(`Goal: Execute the approved project plan ${planner.pendingPlanId}`);
    const approved = JSON.parse(await readFile(join(root, '.ccpt', 'plans', 'index.json'), 'utf8')).plans.find((plan: any) => plan.id === planner.pendingPlanId);
    expect(approved.status).toBe('completed'); expect(approved.executionAgentId).toBe(planner.id);
    send('/exit\r'); await Promise.race([child.exited, Bun.sleep(3000)]);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
