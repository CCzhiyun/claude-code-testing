import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from './legacyFixtureConfig.js';
import { query } from '../src/entrypoints/sdk.js';
import { writeJson } from '../src/storage.js';

let workspace = '';
let server: ReturnType<typeof Bun.serve>;
let previousHome: string | undefined;
let previousKey: string | undefined;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ccpt-sdk-stream-'));
  previousHome = process.env.CCPT_HOME;
  previousKey = process.env.CCPT_API_KEY;
  process.env.CCPT_HOME = join(workspace, 'state');
  process.env.CCPT_API_KEY = 'sdk-stream-key';
  server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ choices: [{ message: { content: 'Streamed SDK answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } });
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
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  if (previousKey === undefined) delete process.env.CCPT_API_KEY; else process.env.CCPT_API_KEY = previousKey;
  await rm(workspace, { recursive: true, force: true });
});

describe('SDK runtime streaming', () => {
  test('yields ordered runtime events before the terminal event', async () => {
    const events = [];
    for await (const event of query({ cwd: workspace, prompt: 'Reply through the SDK.' })) events.push(event);
    expect(events[0]?.type).toBe('started');
    expect(events.at(-1)?.type).toBe('completed');
    const runtimeTypes = events.flatMap((event) => event.type === 'runtime' ? [event.event.type] : []);
    expect(runtimeTypes).toEqual(expect.arrayContaining(['agent_status', 'turn_started', 'text_delta', 'usage_updated', 'agent_completed']));
    expect(runtimeTypes.indexOf('text_delta')).toBeLessThan(runtimeTypes.indexOf('agent_completed'));
  });
});
