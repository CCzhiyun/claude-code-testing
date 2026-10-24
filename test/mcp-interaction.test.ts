import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { StdioMcpClient, callMcpServer } from '../src/mcp.js';
import { handleMcpInteraction, mcpInteractionCapabilities, type McpInteractionHandlers } from '../src/mcpInteraction.js';
import { defaultConfig } from '../src/config.js';
import { withExecutionSignal } from '../src/executionControl.js';
import { writeJson } from '../src/storage.js';

const server = { transport: 'stdio' as const, command: 'node', args: [join(import.meta.dir, 'mcp-interaction-fixture.cjs')] };
const sample = { messages: [{ role: 'user', content: { type: 'text', text: 'Exact reviewed prompt' } }], maxTokens: 64 };
const response = { role: 'assistant' as const, content: { type: 'text' as const, text: 'reviewed result' }, model: 'fixture' };
const form = { message: 'Select the target project', requestedSchema: { type: 'object', properties: { project: { type: 'string', enum: ['test', 'live'] }, count: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['project'] } };
const handlers = (): McpInteractionHandlers => ({ confirmSampling: async () => true, sample: async () => structuredClone(response), confirmSamplingResult: async () => true, elicit: async () => ({ action: 'accept', content: { project: 'test', count: 2 } }) });

test('stdio request-ID directions are isolated; default reverse requests fail closed', async () => {
  const client = new StdioMcpClient();
  try {
    await client.connect(server);
    const result: any = await client.request('tools/call', { name: 'fixture', arguments: {} });
    expect(result.reverse.error.code).toBe(-32601); expect(result.capabilities).toEqual({});
    const ping: any = await client.request('tools/call', { name: 'fixture', arguments: { reverse: { method: 'ping', params: {} } } });
    expect(ping.reverse.result).toEqual({});
  } finally { await client.close(); }
});

test('null errors and malformed response envelopes never become empty successful tool results', async () => {
  const client = new StdioMcpClient();
  try {
    await client.connect(server);
    for (const rawResponse of [{ error: null }, { error: { message: 'missing code' } }, { method: 42, result: { ok: true } }, { result: {}, error: { code: -1, message: 'both result and error' } }]) {
      let failure: unknown;
      try { await client.request('tools/call', { name: 'fixture', arguments: { rawResponse } }); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toContain('Invalid MCP');
    }
    const valid: any = await client.request('tools/call', { name: 'fixture', arguments: { rawResponse: { result: { ok: true } } } }); expect(valid.ok).toBe(true);
  } finally { await client.close(); }
});

test('sampling requires two independent exact-content approvals', async () => {
  let sampled = 0, shared = 0; const h = handlers();
  h.confirmSampling = async request => { request.messages[0]!.content.text = 'Callback mutation'; return true; };
  h.sample = async request => { expect(request.messages[0]!.content.text).toBe('SAMPLE-FIXTURE-ONLY'); sampled++; return response; };
  h.confirmSamplingResult = async result => { expect(result.content.text).toBe('reviewed result'); result.content.text = 'Mutation must not be shared'; shared++; return true; };
  const client = new StdioMcpClient();
  try {
    await client.connect(server, undefined, undefined, h);
    const result: any = await client.request('tools/call', { name: 'fixture', arguments: {} });
    expect(result.capabilities.sampling).toEqual({}); expect(result.capabilities.sampling.tools).toBeUndefined();
    expect(result.reverse.result.content.text).toBe('reviewed result'); expect(sampled).toBe(1); expect(shared).toBe(1);
    h.confirmSampling = async () => false;
    expect((await client.request('tools/call', { name: 'fixture', arguments: {} }) as any).reverse.error.code).toBe(-1); expect(sampled).toBe(1);
    h.confirmSampling = async () => true; h.confirmSamplingResult = async () => false;
    const declined: any = await client.request('tools/call', { name: 'fixture', arguments: {} });
    expect(declined.reverse.error.code).toBe(-1); expect(JSON.stringify(declined)).not.toContain('reviewed result');
  } finally { await client.close(); }
});

test('forms validate types, required fields and prohibit credential or unsupported schemas', async () => {
  const h = handlers(), signal = new AbortController().signal;
  expect((await handleMcpInteraction('elicitation/create', form, h, signal) as any).result.content).toEqual({ project: 'test', count: 2 });
  for (const content of [{ project: 'other' }, { count: 2 }, { project: 'test', count: 2.5 }, { project: 'test', extra: 'no' }, { project: 'test', count: Infinity }]) {
    h.elicit = async () => ({ action: 'accept', content } as any);
    expect((await handleMcpInteraction('elicitation/create', form, h, signal) as any).error.code).toBe(-32602);
  }
  let asked = 0; h.elicit = async () => { asked++; return { action: 'accept', content: {} }; };
  for (const invalid of [
    { ...form, mode: 'url', url: 'https://example.invalid' },
    { ...form, requestedSchema: { type: 'object', properties: { api_key: { type: 'string' } } } },
    { ...form, message: 'Enter your password' },
    { ...form, requestedSchema: { type: 'object', properties: { target: { type: 'string', pattern: '(a+)+$' } } } },
    { ...form, requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } } },
  ]) expect((await handleMcpInteraction('elicitation/create', invalid, h, signal) as any).error.code).toBe(-32602);
  expect(asked).toBe(0);
  h.elicit = async () => ({ action: 'decline', content: { project: 'DO-NOT-SHARE' } });
  expect((await handleMcpInteraction('elicitation/create', form, h, signal) as any).result).toEqual({ action: 'decline' });
});

test('unsupported sampling tools/context/multimodal and incomplete approval chains never execute', async () => {
  const h = handlers(); let sampled = 0; h.sample = async () => { sampled++; return response; }; const signal = new AbortController().signal;
  for (const invalid of [{ ...sample, tools: [] }, { ...sample, includeContext: 'allServers' }, { ...sample, maxTokens: 1000000 }, { ...sample, messages: [{ role: 'user', content: { type: 'image', data: 'hidden' } }] }]) {
    expect((await handleMcpInteraction('sampling/createMessage', invalid, h, signal) as any).error.code).toBe(-32602);
  }
  expect(sampled).toBe(0);
  delete h.confirmSamplingResult; expect(mcpInteractionCapabilities(h)).not.toHaveProperty('sampling');
  expect((await handleMcpInteraction('sampling/createMessage', sample, h, signal) as any).error.code).toBe(-32601);
  expect(sampled).toBe(0);
});

test('timeout, explicit cancellation and parent completion revoke in-flight approvals', async () => {
  const h = handlers(); h.timeoutMs = 50; h.confirmSampling = async () => new Promise(() => {});
  const timed: any = await handleMcpInteraction('sampling/createMessage', sample, h, new AbortController().signal); expect(timed.error.code).toBe(-32000);
  const controller = new AbortController(); let sampled = 0; h.sample = async () => { sampled++; return response; };
  const client = new StdioMcpClient();
  try {
    await withExecutionSignal(controller.signal, () => client.connect(server, undefined, undefined, h));
    const pending = client.request('tools/call', { name: 'fixture', arguments: {} });
    setTimeout(() => controller.abort(), 25);
    await expect(pending).rejects.toThrow('cancelled'); expect(sampled).toBe(0);
  } finally { await client.close(); }
  const early = new StdioMcpClient(); h.timeoutMs = 1000;
  try {
    await early.connect(server, undefined, undefined, h);
    expect((await early.request('tools/call', { name: 'fixture', arguments: { endEarly: true } }) as any).closedEarly).toBe(true);
    await Bun.sleep(50); expect(sampled).toBe(0);
  } finally { await early.close(); }
}, 10000);

test('reverse requests are limited to eight per MCP client', async () => {
  const client = new StdioMcpClient();
  try {
    await client.connect(server);
    for (let i = 0; i < 8; i++) expect((await client.request('tools/call', { name: 'fixture', arguments: {} }) as any).reverse.error.code).toBe(-32601);
    expect((await client.request('tools/call', { name: 'fixture', arguments: {} }) as any).reverse.error.code).toBe(-32000);
  } finally { await client.close(); }
});

test('an oversized stdio frame terminates the owned MCP process', async () => {
  const client = new StdioMcpClient();
  try {
    await client.connect(server);
    let failure: unknown;
    try { await client.request('tools/call', { name: 'fixture', arguments: { oversize: true } }, 2000); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toContain('oversized');
  } finally { await client.close(); }
}, 10000);

test('restricted policy forbids starting the server and HTTP interaction fails explicitly', async () => {
  const config = structuredClone(defaultConfig); config.policy.mode = 'restricted'; config.policy.workspaceRoots = [import.meta.dir];
  await expect(callMcpServer('fixture', server, 'fixture', {}, true, undefined, config, handlers())).rejects.toThrow('disabled in restricted');
  await expect(callMcpServer('fixture', { transport: 'http', url: 'http://127.0.0.1:1' }, 'fixture', {}, true, undefined, config, handlers())).rejects.toThrow('requires Streamable HTTP');
});

test('interactive terminal path actually calls native Responses only after approval and reviews before sharing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-mcp-interactive-')); const state = join(root, 'state'); const requests: any[] = [];
  const model = Bun.serve({ port: 0, async fetch(request) { requests.push(await request.json()); return Response.json({ id: 'resp_fixture', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'TERMINAL-SAMPLED-RESULT' }] }] }); } });
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.hooks = []; config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
  config.model.apiProtocol = 'responses'; config.model.apiKeyEnv = ''; config.model.endpointUrl = `http://127.0.0.1:${model.port}/v1/responses`; config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 10000 }; config.mcpServers = { fixture: server };
  await writeJson(join(root, '.ccpt/settings.json'), config);
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); Object.defineProperty(process.stderr,'isTTY',{value:true}); process.argv=['node','cli','mcp','call','fixture','fixture','--interactive','--cwd',${JSON.stringify(root)}]; await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dir, '../src/cli.ts')).href)});`;
  const env: Record<string, string> = { CCPT_HOME: state };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { env, cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = ''; const pump = (async () => { for await (const chunk of child.stderr) output += new TextDecoder().decode(chunk); })();
  const until = async (text: string) => { const deadline = Date.now() + 10000; while (!output.includes(text) && Date.now() < deadline) await Bun.sleep(20); expect(output, `Missing ${text}`).toContain(text); output = ''; };
  try {
    await until('Type yes to approve once'); expect(requests).toHaveLength(0);
    child.stdin.write('yes\n'); child.stdin.flush();
    await until('Type yes to approve once'); expect(requests).toHaveLength(1); expect(requests[0].input).toBeDefined(); expect(requests[0].messages).toBeUndefined(); expect(requests[0].tools ?? []).toHaveLength(0);
    child.stdin.write('yes\n'); child.stdin.flush();
    const stdout = await new Response(child.stdout).text(); expect(await child.exited).toBe(0); expect(JSON.parse(stdout).reverse.result.content.text).toBe('TERMINAL-SAMPLED-RESULT');
    await expect(readFile(join(state, 'permission-approvals.json'), 'utf8')).rejects.toThrow();
  } finally { child.kill(); await child.exited; await pump; model.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30000);
