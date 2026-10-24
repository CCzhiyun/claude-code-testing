import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { defaultConfig } from './legacyFixtureConfig.js';
import { runHooks } from '../src/hooks.js';

describe('hook execution policy', () => {
  const servers: Array<ReturnType<typeof Bun.serve>> = [];
  afterAll(() => servers.forEach((server) => server.stop(true)));
  test('rejects hooks in restricted mode', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.mode = 'restricted';
    config.hooks = [{ event: 'Setup', command: 'node --version' }];
    expect(runHooks(config, 'Setup', {}, process.cwd())).rejects.toThrow('disabled in restricted mode');
  });

  test('rejects shell operators even for allowlisted executables', async () => {
    const config = structuredClone(defaultConfig);
    config.hooks = [{ event: 'Setup', command: 'node --version & node --version' }];
    expect(runHooks(config, 'Setup', {}, process.cwd())).rejects.toThrow('Unsafe shell operator');
  });

  test('parses command hook decisions and additional context', async () => {
    const config = structuredClone(defaultConfig);
    const fixture = join(import.meta.dir, 'hook-fixture.js');
    config.hooks = [{ event: 'Setup', type: 'command', command: `node "${fixture}" context` }];
    expect((await runHooks(config, 'Setup', {}, process.cwd())).additionalContext).toEqual(['fixture context']);
    config.hooks = [{ event: 'Setup', type: 'command', command: `node "${fixture}" block` }];
    await expect(runHooks(config, 'Setup', {}, process.cwd())).rejects.toThrow('fixture blocked');
  });

  test('matches tool hooks before executing them', async () => {
    const config = structuredClone(defaultConfig);
    const fixture = join(import.meta.dir, 'hook-fixture.js');
    config.hooks = [{ event: 'PreToolUse', type: 'command', matcher: 'write_*', command: `node "${fixture}" context` }];
    expect((await runHooks(config, 'PreToolUse', { tool: 'read_file' }, process.cwd())).additionalContext).toEqual([]);
    expect((await runHooks(config, 'PreToolUse', { tool: 'write_file' }, process.cwd())).additionalContext).toEqual(['fixture context']);
  });

  test('runs HTTP hooks through network policy and blocks metadata targets', async () => {
    const server = Bun.serve({ port: 0, fetch: async (request) => Response.json({ additionalContext: `http:${(await request.json() as { value: string }).value}` }) });
    servers.push(server);
    const config = structuredClone(defaultConfig);
    config.hooks = [{ event: 'Setup', type: 'http', url: `http://127.0.0.1:${server.port}/hook` }];
    expect((await runHooks(config, 'Setup', { value: 'ok' }, process.cwd())).additionalContext).toEqual(['http:ok']);
    config.hooks = [{ event: 'Setup', type: 'http', url: 'http://169.254.169.254/latest/meta-data' }];
    await expect(runHooks(config, 'Setup', {}, process.cwd())).rejects.toThrow('blocked private or link-local');
  });

  test('runs prompt hooks against the configured model endpoint', async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: JSON.stringify({ decision: 'approve', additionalContext: 'model verified' }) }, finish_reason: 'stop' }] }) });
    servers.push(server);
    const config = structuredClone(defaultConfig);
    config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.hooks = [{ event: 'Setup', type: 'prompt', prompt: 'Verify $ARGUMENTS' }];
    expect((await runHooks(config, 'Setup', { action: 'test' }, process.cwd())).additionalContext).toEqual(['model verified']);
  });

  test('prompt verifier ok:false blocks and unstructured output never silently approves', async () => {
    let verdict = JSON.stringify({ ok: false, reason: 'Verifier found missing tests' });
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: verdict }, finish_reason: 'stop' }] }) });
    servers.push(server);
    const config = structuredClone(defaultConfig); config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.hooks = [{ event: 'TaskCompleted', type: 'prompt', prompt: 'Verify $ARGUMENTS' }];
    await expect(runHooks(config, 'TaskCompleted', {}, process.cwd())).rejects.toThrow('missing tests');
    verdict = 'Cannot evaluate the evidence';
    await expect(runHooks(config, 'TaskCompleted', {}, process.cwd())).rejects.toThrow('JSON verdict');
    verdict = '{}';
    await expect(runHooks(config, 'TaskCompleted', {}, process.cwd())).rejects.toThrow('explicit verdict');
  });
});
