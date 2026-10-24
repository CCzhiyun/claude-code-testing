import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('actual CLI raw-key picker restores and forks without API calls, then continues with saved context and a real file tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-terminal-resume-'));
  const state = join(root, 'state');
  const requests: unknown[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ choices: [{ message: requests.length === 1
      ? { content: null, tool_calls: [{ id: 'fixture-write', function: { name: 'write_file', arguments: JSON.stringify({ path: 'fixture-result.txt', content: 'REMEMBERED-KAPPA42' }) } }] }
      : { content: 'RESUME-TOOL-COMPLETED' }, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] });
  } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible';
  config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5_000 };
  config.policy.workspaceRoots = [root];
  config.policy.permissionRules.allow = ['Read(first)', 'Read(second)'];
  config.agents.defaultIsolation = 'none';
  config.pluginDirectories = []; config.hooks = [];
  config.skillsDirectories = []; config.agentsDirectories = [];
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  const skillDirectory = join(root, '.ccpt', 'skills', 'fixture-skill');
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Test a managed Skill\n---\nUse fixture rules.\n');
  await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const id = 'session_0000000000000001';
  await writeJson(join(state, 'sessions', `${id}.json`), { id, cwd: root, title: 'Fixture saved conversation', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [{ role: 'user', content: 'Remember REMEMBERED-KAPPA42' }, { role: 'assistant', content: 'SAVED-RESPONSE-MARKER' }] });
  // Pipe-backed raw-key driver: no desktop access or real provider credentials.
  const cliPath = resolve(import.meta.dir, '../src/cli.ts');
  const entry = pathToFileURL(cliPath).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); Object.defineProperty(process.stdout,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:80}); Object.defineProperty(process.stdout,'rows',{value:24}); process.argv=[process.execPath,${JSON.stringify(cliPath)},'--resume','--model','startup-fixture-model','--effort','low']; await import(${JSON.stringify(entry)});`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_API_KEY: 'fixture-only', CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) output += new TextDecoder().decode(chunk); };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => {
    const deadline = Date.now() + 15_000;
    while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(30);
    expect(output, `Missing terminal marker: ${marker}`).toContain(marker);
    output = '';
  };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('Space preview'); expect(requests).toHaveLength(0);
    send(' '); await until('SAVED-RESPONSE-MARKER'); expect(requests).toHaveLength(0);
    send('\u001b'); await until('Space preview');
    send('\u0012'); await until('Rename conversation');
    send('\u0015'); send('Fixture renamed conversation'); send('\r'); await until('Session renamed. No model request sent.');
    expect(JSON.parse(await readFile(join(state, 'sessions', `${id}.json`), 'utf8')).title).toBe('Fixture renamed conversation');
    expect(requests).toHaveLength(0);
    send('1');
    await until('No model request has been sent.');
    expect(requests).toHaveLength(0);
    send('/skills\r'); await until('Space cycle visibility · Enter save');
    // The catalog also contains built-ins; select our fixture by name, not row 0.
    send('/fixture-skill\r');
    send('   '); send('\r'); await until('Skill settings saved.');
    expect(JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8')).skillOverrides['fixture-skill']).toBe('off');
    expect(requests).toHaveLength(0);
    send('/skills fixture-skill\r'); await until('Unknown skill: fixture-skill');
    expect(requests).toHaveLength(0);
    send('/skills\r'); await until('Space cycle visibility · Enter save');
    send('/fixture-skill\r');
    send(' '); send('\r'); await until('Skill settings saved.');
    expect(JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8')).disabledSkills).toEqual([]);
    expect(JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8')).skillOverrides['fixture-skill']).toBe('on');
    send('/permissions\r'); await until('5 entries ·');
    send('\u001b[C'); await until('2 entries ·');
    send('/'); await until('[typing]');
    send('second'); await until('1 entries ·');
    send('\r'); await until('a add · d delete');
    send('d'); await until('No allow entries.');
    expect(JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8')).policy.permissionRules.allow).toEqual(['Read(first)']);
    send('\u001b'); await until('? shortcuts');
    send('/resume\r'); await until('Fixture renamed conversation');
    send('\r'); await until('No model request has been sent.');
    expect(requests).toHaveLength(0);
    send('/continue Fixture renamed conversation\r'); await until('No model request has been sent.');
    expect(requests).toHaveLength(0);
    send('/fork Alternative design branch\r'); await until('Original session:');
    expect(requests).toHaveLength(0);
    expect(await readdir(join(state, 'sessions'))).toHaveLength(2);
    const branchFiles = await readdir(join(state, 'sessions'));
    const branchPath = branchFiles.find(name => name !== `${id}.json`)!;
    expect(JSON.parse(await readFile(join(state, 'sessions', branchPath), 'utf8')).title).toBe('Alternative design branch');
    send('/new Saved  alternative\r'); await until('Started a fresh conversation.');
    expect(requests).toHaveLength(0);
    send('/resume Saved  alternative\r'); await until('Resumed: Saved  alternative');
    expect(requests).toHaveLength(0);
    send('/new\r'); await until('Started a fresh conversation.');
    send('/continue Saved  alternative\r'); await until('Resumed: Saved  alternative');
    expect(requests).toHaveLength(0);
    send('Write the remembered marker to fixture-result.txt\r');
    await until('RESUME-TOOL-COMPLETED');
    expect(requests).toHaveLength(2);
    expect((requests[0] as { model?: string }).model).toBe('startup-fixture-model');
    expect(JSON.stringify(requests[0])).toContain('REMEMBERED-KAPPA42');
    expect(await readFile(join(root, 'fixture-result.txt'), 'utf8')).toBe('REMEMBERED-KAPPA42');
    const original = JSON.parse(await readFile(join(state, 'sessions', `${id}.json`), 'utf8'));
    expect(original.messages).toHaveLength(2);
    send('/exit\r');
    await Promise.race([child.exited, Bun.sleep(5_000)]);
  } finally {
    child.kill(); await child.exited; await pumps;
    server.stop(true);
    // mkdtemp owns this exact fixture directory; no user workspaces are removed.
    await removeOwnedTemporaryFixture(root);
  }
}, 40_000);
