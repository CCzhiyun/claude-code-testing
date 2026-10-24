import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from './legacyFixtureConfig.js';
import { writeJson } from '../src/storage.js';

let workspace = '';
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ccpt-ide-stream-'));
  server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ choices: [{ message: { content: 'Streamed IDE answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 4 } });
    },
  });
  const config = structuredClone(defaultConfig);
  config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.policy.workspaceRoots = [workspace];
  await writeJson(join(workspace, '.ccpt', 'settings.json'), config);
});

afterAll(async () => {
  server.stop(true);
  await rm(workspace, { recursive: true, force: true });
});

describe('IDE runtime event protocol', () => {
  test('sends live runtime notifications before the final JSON-RPC response', async () => {
    const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
    const child = Bun.spawn([process.execPath, cli, 'ide', 'serve', '--cwd', workspace], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CCPT_HOME: join(workspace, 'state'), CCPT_API_KEY: 'ide-test-key' },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'chat/send', params: { goal: 'Reply from the IDE bridge.' } })}\n`);
    child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    const messages = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const finalIndex = messages.findIndex((message) => message.id === 7);
    const events = messages.filter((message) => message.method === 'runtime/event');
    expect(finalIndex).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(3);
    expect(messages.slice(0, finalIndex).some((message) => message.method === 'runtime/event')).toBe(true);
    expect(events.map((message) => ((message.params as { event: { type: string } }).event.type))).toEqual(expect.arrayContaining(['agent_status', 'turn_started', 'text_delta', 'usage_updated', 'agent_completed']));
    expect(((messages[finalIndex]!.result as { result: string }).result)).toBe('Streamed IDE answer.');
  });
});
