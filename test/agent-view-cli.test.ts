import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from './legacyFixtureConfig.js';
import { writeJson } from '../src/storage.js';

let workspace = '';
let server: ReturnType<typeof Bun.serve>;

async function cli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'cli.ts'), ...args, '--cwd', workspace], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CCPT_HOME: join(workspace, 'state'), CCPT_API_KEY: 'agent-view-key' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ccpt-agent-view-'));
  server = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(120);
      return Response.json({ choices: [{ message: { content: 'Live background answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4 } });
    },
  });
  const config = structuredClone(defaultConfig);
  config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.policy.workspaceRoots = [workspace];
  config.agents.defaultIsolation = 'none';
  await writeJson(join(workspace, '.ccpt', 'settings.json'), config);
});

afterAll(async () => {
  server.stop(true);
  await rm(workspace, { recursive: true, force: true });
});

describe.serial('Claude-style Agent View CLI', () => {
  test('starts with --bg, attaches to live output, and retains readable logs', async () => {
    const started = await cli('--bg', 'Evaluate the project', '--no-worktree');
    expect(started.exitCode, started.stderr).toBe(0);
    const agent = JSON.parse(started.stdout) as { id: string; status: string };
    expect(agent.status).toBe('queued');

    const attached = await cli('attach', agent.id, '--timeout', '10000');
    expect(attached.exitCode, attached.stderr).toBe(0);
    expect(attached.stdout).toContain('Live background answer.');

    const logs = await cli('logs', agent.id);
    expect(logs.exitCode, logs.stderr).toBe(0);
    expect(logs.stdout).toContain(`Agent ${agent.id} · completed`);
    expect(logs.stdout).toContain('Live background answer.');
  }, 20_000);

  test('documents the compact and grouped Agent View commands', async () => {
    const result = await cli('--help');
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('ccpt --bg <goal>');
    expect(result.stdout).toContain('ccpt attach|logs|stop <agent-id>');
    expect(result.stdout).toContain('wait|attach|logs|stop|cancel|cleanup');
  });
});
