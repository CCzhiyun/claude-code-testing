import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';

test('raw-key permission preview dismisses/reopens, executes once/session grants and enforces denial on model retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-terminal-approval-')); const state = join(root, 'state');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    const index = requests.length;
    const content = index <= 2 ? 'first' : index <= 4 ? 'second' : 'third';
    const path = index >= 6 ? 'denied.txt' : 'a.txt';
    const tool_calls = index <= 7 ? [{ id: `write-${index}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path, content }) } }] : undefined;
    return Response.json({ choices: [{ message: tool_calls ? { content: null, tool_calls } : { content: 'APPROVAL-FLOW-DONE' } }] });
  } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 15000 };
  config.policy.workspaceRoots = [root]; config.policy.permissionRules.ask = ['write_file(*)']; config.agents.defaultIsolation = 'none';
  config.marketplaceEnabled = false; config.hooks = []; config.pluginDirectories = []; config.skillsDirectories = []; config.agentsDirectories = [];
  await writeFile(join(root, 'a.txt'), 'original');
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:120}); Object.defineProperty(process.stdout,'rows',{value:42}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) output += new TextDecoder().decode(chunk); };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => {
    const deadline = Date.now() + 18000;
    while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(30);
    expect(output.includes(marker), `Missing ${marker}\n${output.slice(-5000)}`).toBe(true); const captured = output; output = ''; return captured;
  };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('/model to change'); send('Update a.txt with approval\r');
    expect(await until('Enter confirm')).toContain('-original');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('original');
    send('\u001b'); await until('Permission dismissed'); expect(requests).toHaveLength(1);
    send('/questions\r'); await until('Enter confirm'); expect(requests).toHaveLength(1);
    send('\r'); await until('+second');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('first'); expect(requests).toHaveLength(3);
    send('\u001b[B'); await until('> 2. Yes'); send('\r');
    await until('Create denied.txt'); expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('third');
    expect(requests).toHaveLength(6); send('3'); await until('Enter confirm'); send('\r');
    await until('APPROVAL-FLOW-DONE'); expect(requests).toHaveLength(8);
    await expect(readFile(join(root, 'denied.txt'), 'utf8')).rejects.toThrow();
    const lastTools = requests.at(-1).messages.filter((message: any) => message.role === 'tool');
    expect(lastTools.at(-1).content).toContain('User denied');
    send('/permissions recent\r'); await until('Recent denials');
    const history = JSON.parse(await readFile(join(state, 'permission-denials.json'), 'utf8'));
    expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ source: 'user', subject: 'denied.txt' });
    send('\u001b'); await until('? shortcuts'); send('/permissions reset\r'); await until('Session approvals and user denials cleared');
    expect(JSON.parse(await readFile(join(state, 'permission-approvals.json'), 'utf8'))).toEqual([]);
    send('/config\r'); await until('Type to filter'); send('API connection preset\r'); await until('Space change');
    for (const label of ['Responses / Bearer', 'Azure / Chat Completions', 'Azure / Responses', 'Messages API']) { send(' '); await until(label); }
    send('\r'); await until('Set the new API endpoint URL');
    // Failed validation keeps the draft open; nothing is written to project configuration.
    expect(JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8')).model.baseUrl).toContain(String(server.port));
    send('/'); await until('Type to filter'); send('\u001b'); await until('Search settings');
    send('Complete API endpoint URL\r'); await until('Space change'); send(' '); await until('Edit: Complete API');
    send(`http://127.0.0.1:${server.port}/v1/messages`); send('\r'); await until('Space change'); send('\r'); await until('Settings saved.');
    const savedModel = JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8')).model;
    expect(savedModel).toMatchObject({ apiProtocol: 'messages', apiKeyHeader: 'x-api-key', apiKeyEnv: 'CCPT_MESSAGES_API_KEY', endpointUrl: `http://127.0.0.1:${server.port}/v1/messages` });
    expect(requests).toHaveLength(8);
    send('/exit\r'); await Promise.race([child.exited, Bun.sleep(3000)]);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 90000);
