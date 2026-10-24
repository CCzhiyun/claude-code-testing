import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { readJson, writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';

test('brainstorm raw-key picker cancels/reopens without API calls, resumes matched tool results and enforces persistent read-only tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-brainstorm-'));
  const state = join(root, 'state'); const requests: any[] = [];
  const call = (id: string, name: string, input: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const question = (id: string) => call(id, 'ask_user_question', { questions: [{ id, question: id === 'q1' ? 'Who approves leave?' : 'Any scope constraints?', choices: ['Flat team', 'Single manager'] }] });
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    const tool_calls = requests.length === 1 ? [call('read1', 'read_file', { path: 'README.md' }), question('q1'), call('skipped', 'write_file', { path: 'should-not-exist.txt', content: 'bad' })]
      : requests.length === 2 ? [call('denied', 'write_file', { path: 'should-not-exist.txt', content: 'bad' }), question('q2')] : undefined;
    return Response.json({ choices: [{ message: tool_calls ? { content: null, tool_calls } : { content: 'BRAINSTORM-FIXTURE-DONE' } }], ...(requests.length < 3 ? { usage: { prompt_tokens: requests.length * 100, completion_tokens: requests.length * 10, prompt_tokens_details: { cached_tokens: 60 } } } : {}) });
  } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
  config.pluginDirectories = []; config.hooks = []; config.skillsDirectories = []; config.agentsDirectories = [];
  await writeFile(join(root, 'README.md'), 'Fixture: 20 colleagues; discussion only.');
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:100}); Object.defineProperty(process.stdout,'rows',{value:24}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_API_KEY: 'fixture-only', CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) output += new TextDecoder().decode(chunk); };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => {
    const deadline = Date.now() + 15000;
    while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(30);
    expect(output, `Missing terminal marker: ${marker}`).toContain(marker); output = '';
  };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('/model to change'); send('/brainstorm Design a leave tracker\r');
    await until('Enter confirm · Esc cancel'); expect(requests).toHaveLength(1);
    send('\u001b'); await until('Question dismissed; no answer sent.'); expect(requests).toHaveLength(1);
    send('/questions\r'); await until('Enter confirm · Esc cancel'); expect(requests).toHaveLength(1);
    send('\u001b[B'); await until('2/3'); send('\r'); await until('Enter confirm · Esc cancel');
    expect(requests).toHaveLength(2);
    const results = requests[1].messages.filter((m: any) => m.role === 'tool');
    expect(results.map((m: any) => m.tool_call_id)).toEqual(['read1', 'q1', 'skipped']);
    expect(results[0].content).toContain('20 colleagues'); expect(results[1].content).toContain('Single manager'); expect(results[2].content).toContain('Not executed');
    // Custom answer selection, submission, and the second turn use the same durable Agent.
    send('3'); await until('3/3'); send('\r'); await until('Your answer >');
    send('Only a calendar'); send('\r'); await until('BRAINSTORM-FIXTURE-DONE');
    expect(requests).toHaveLength(3);
    expect(requests[2].messages.find((m: any) => m.tool_call_id === 'denied').content).toContain('not enabled');
    expect(requests[2].messages.find((m: any) => m.tool_call_id === 'q2').content).toContain('Only a calendar');
    expect(await readdir(root)).not.toContain('should-not-exist.txt');
    for (const req of requests) expect(req.tools.some((t: any) => t.function.name === 'write_file')).toBe(false);
    // Text can be visible while the streamed turn is still running. Synchronize on
    // durable Agent completion, not on a text delta or a retry of the usage count.
    let completed = false; const completionDeadline = Date.now() + 5000;
    while (!completed && Date.now() < completionDeadline) {
      const paths = (await readdir(join(state, 'agents'))).filter(path => /^agent_[a-f0-9]{16}\.json$/.test(path));
      const agents = await Promise.all(paths.map(path => readJson<{ status: string; result?: string } | null>(join(state, 'agents', path), null)));
      completed = agents.some(agent => agent?.status === 'completed' && agent.result === 'BRAINSTORM-FIXTURE-DONE');
      if (!completed) await Bun.sleep(20);
    }
    expect(completed).toBe(true);
    const records = JSON.parse(await readFile(join(state, 'usage.json'), 'utf8'));
    expect(records).toHaveLength(3); expect(records[0].inputTokens).toBe(100); expect(records[1].inputTokens).toBe(200);
    expect(records[0].inputSource).toBe('reported'); expect(records[2].inputSource).toBe('estimated'); expect(records[2].outputTokens).toBeGreaterThan(0);
    send('/usage details\r'); await until('Cumulative usage is not context occupancy.');
    send('/exit\r'); await Promise.race([child.exited, Bun.sleep(3000)]);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
