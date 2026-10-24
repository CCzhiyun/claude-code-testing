import { expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { startupSession } from '../src/sessionStartup.js';
import { writeJson } from '../src/storage.js';

test('session startup selects latest workspace history, rejects busy/foreign sessions and does not mutate history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-startup-')); const old = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state');
  const id = 'session_0000000000000001', foreign = 'session_0000000000000002';
  const path = join(root, 'state', 'sessions', `${id}.json`);
  try {
    await writeJson(path, { id, cwd: root, title: 'Saved', createdAt: '2026-01-01', updatedAt: '2026-01-01', messages: [] });
    await writeJson(join(root, 'state', 'sessions', `${foreign}.json`), { id: foreign, cwd: join(root, 'other'), title: 'Foreign', updatedAt: '2026-02-01', messages: [] });
    const before = await readFile(path, 'utf8');
    expect(await startupSession(root, undefined, false)).toBeUndefined();
    expect(await startupSession(root, undefined, true)).toBe(id);
    expect(await startupSession(root, id, false)).toBe(id);
    await expect(startupSession(root, foreign, false)).rejects.toThrow('another workspace');
    await expect(startupSession(root, id, true)).rejects.toThrow('combined');
    await expect(startupSession(join(root, 'empty'), undefined, true)).rejects.toThrow('No previous');
    await writeJson(join(root, 'state', 'agents', 'agent_0000000000000001.json'), { id: 'agent_0000000000000001', sessionId: id, status: 'waiting_for_input', updatedAt: '2026-01-01' });
    await expect(startupSession(root, id, false)).rejects.toThrow('Session is active');
    expect(await readFile(path, 'utf8')).toBe(before);
  } finally { if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old; await rm(root, { recursive: true, force: true }); }
});

test('actual CLI continue/fork carries history, temporary model and tool settings into the worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-startup-cli-')), state = join(root, 'state'); const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) { requests.push(await request.json()); return Response.json({ choices: [{ message: { content: 'STARTUP_OK' }, finish_reason: 'stop' }] }); } });
  const config = structuredClone(defaultConfig); config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`;
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.marketplaceEnabled = false; config.hooks = []; config.toolFilter = ['read_file'];
  const id = 'session_0000000000000001'; const originalPath = join(state, 'sessions', `${id}.json`);
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  await writeJson(originalPath, { id, cwd: root, title: 'Saved', createdAt: '2026-01-01', updatedAt: '2026-01-01', messages: [{ role: 'user', content: 'Remember STARTUP_CONTEXT_42' }, { role: 'assistant', content: 'Remembered.' }] });
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), ...args], { cwd: root, env: { ...process.env, CCPT_HOME: state, DISABLE_AUTOUPDATER: '1' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { out, err, code };
  };
  try {
    const before = await readFile(originalPath, 'utf8');
    const fork = await run(['-p', 'Answer a normal question', '-c', '--fork-session', '--tools', 'default', '--model', 'deployment-fixture', '--effort', 'low', '--output-format', 'json']);
    expect(fork.code, fork.out + fork.err).toBe(0); expect(JSON.parse(fork.out).session_id).not.toBe(id);
    expect(await readFile(originalPath, 'utf8')).toBe(before);
    expect(requests[0].model).toBe('deployment-fixture'); expect(requests[0].reasoning_effort).toBe('low');
    expect(requests[0].tools.length).toBeGreaterThan(1); expect(JSON.stringify(requests[0].messages)).toContain('STARTUP_CONTEXT_42');
    const resumed = await run(['-p', 'No tools this turn', '-r', id, '--tools', '', '--output-format', 'json']);
    expect(resumed.code, resumed.out + resumed.err).toBe(0); expect(JSON.parse(resumed.out).session_id).toBe(id);
    expect(requests[1].tools ?? []).toHaveLength(0);
    const named = await run(['-p', 'Continue by exact name', '--resume', 'Saved', '--tools', '', '--output-format', 'json']);
    expect(named.code, named.out + named.err).toBe(0); expect(JSON.parse(named.out).session_id).toBe(id);
    const picker = await run(['--resume']); expect(picker.code).toBe(1); expect(picker.out + picker.err).toContain('interactive terminal');
    const missingPrintId = await run(['--resume', '--print', 'Do not send', '--output-format', 'json']);
    expect(missingPrintId.code).toBe(1); expect(missingPrintId.out).toContain('requires a session ID or name');
    const invalid = await run(['-p', 'Invalid', '-c', '--no-session-persistence', '--output-format', 'json']);
    expect(invalid.code).toBe(1); expect(invalid.out).toContain('cannot resume'); expect(requests).toHaveLength(3);
  } finally { server.stop(true); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}, 30000);
