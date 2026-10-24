import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { spawnAgent, continueAgent } from '../src/agent.js';
import { loadSession } from '../src/sessions.js';
import { writeJson } from '../src/storage.js';
import type { PlatformConfig } from '../src/types.js';

type Protocol = 'messages' | 'chat-completions' | 'responses';
const frame = (event: unknown) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`;
const chatCall = (args: unknown, id = 'call_1') => ({ id, type: 'function', function: { name: 'write_file', arguments: args } });
const chatDelta = (args: string) => ({ choices: [{ delta: { tool_calls: [{ ...chatCall(args), index: 0 }] } }] });
const chatFinish = (reason = 'tool_calls') => ({ choices: [{ delta: {}, finish_reason: reason }] });
const start = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'write_file', input: {} } };
const argsDelta = (args: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } });
const blockStop = { type: 'content_block_stop', index: 0 };
const messageDelta = (reason = 'tool_use') => ({ type: 'message_delta', delta: { stop_reason: reason } });
const messageStop = { type: 'message_stop' };
function configFor(protocol: Protocol, port: number): PlatformConfig {
  const config = structuredClone(defaultConfig);
  config.model.apiProtocol = protocol; config.model.endpointUrl = `http://127.0.0.1:${port}`;
  config.modelRetry = { maxRetries: 0 }; config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  return config;
}

for (const protocol of ['messages', 'chat-completions', 'responses'] as const) test(`${protocol}: JSON and stream-JSON fallback reject malformed/non-object/missing arguments and duplicate IDs`, async () => {
  let value: unknown; let duplicate = false;
  const server = Bun.serve({ port: 0, fetch() {
    const call = protocol === 'messages' ? { type: 'tool_use', id: 'call_1', name: 'write_file', input: value }
      : protocol === 'responses' ? { type: 'function_call', call_id: 'call_1', name: 'write_file', arguments: value }
        : chatCall(value);
    const calls = duplicate ? [call, call] : [call];
    return Response.json(protocol === 'messages' ? { content: calls, stop_reason: 'tool_use' }
      : protocol === 'responses' ? { status: 'completed', output: calls }
        : { choices: [{ message: { tool_calls: calls }, finish_reason: 'tool_calls' }] });
  } });
  try {
    const config = configFor(protocol, server.port!);
    for (const stream of [undefined, {}]) {
      for (value of protocol === 'messages' ? [undefined, null, [], 3, 'SENSITIVE_ARGUMENT'] : [undefined, '', '{"private":"SENSITIVE_ARGUMENT",', 'null', '[]', '3', '"SENSITIVE_ARGUMENT"']) {
        let error: unknown; try { await callModel(config, '', [], [], stream); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('SENSITIVE_ARGUMENT');
      }
      value = protocol === 'messages' ? {} : '{}';
      expect((await callModel(config, '', [], [], stream)).content.find(b => b.type === 'tool_use')?.input).toEqual({});
      duplicate = true; await expect(callModel(config, '', [], [], stream)).rejects.toThrow('Duplicate'); duplicate = false;
    }
  } finally { server.stop(true); }
});

test('Chat SSE requires a tool finish reason AND DONE; invalid tail/identity/JSON blocks the whole response', async () => {
  let frames: unknown[] = [];
  const server = Bun.serve({ port: 0, fetch() { return new Response(frames.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    const config = configFor('chat-completions', server.port!);
    const call = chatDelta('{"path":"fixture.txt","content":"changed"}');
    for (frames of [
      [call], [call, '[DONE]'], [call, chatFinish()], [call, chatFinish('length'), '[DONE]'],
      [call, chatFinish('content_filter'), '[DONE]'], [call, chatFinish('stop'), '[DONE]'],
      [chatDelta('{'), chatFinish(), '[DONE]'], [chatDelta('[]'), chatFinish(), '[DONE]'],
      [call, '{invalid', chatFinish(), '[DONE]'], [call, chatFinish(), '[DONE]', call],
      [call, chatFinish(), chatDelta(' '), '[DONE]'],
      [call, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'different' }] } }] }, chatFinish(), '[DONE]'],
    ]) await expect(callModel(config, '', [], [], {})).rejects.toThrow('no tools executed');
    frames = [call, chatFinish(), { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }, '[DONE]'];
    const result = await callModel(config, '', [], [], {}); expect(result.content[0]?.input).toEqual({ path: 'fixture.txt', content: 'changed' }); expect(result.usage?.outputTokens).toBe(2);
  } finally { server.stop(true); }
});

test('Messages SSE requires closed tool block, tool_use stop reason and message_stop', async () => {
  let frames: unknown[] = [];
  const server = Bun.serve({ port: 0, fetch() { return new Response(frames.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    const config = configFor('messages', server.port!);
    const args = argsDelta('{"path":"fixture.txt","content":"changed"}');
    for (frames of [
      [start, args], [start, args, blockStop, messageDelta()], [start, args, messageDelta(), messageStop],
      [start, args, blockStop, messageDelta('max_tokens'), messageStop], [start, args, blockStop, messageStop],
      [start, argsDelta('{'), blockStop, messageDelta(), messageStop],
      [start, argsDelta('null'), blockStop, messageDelta(), messageStop],
      [start, args, '{invalid', blockStop, messageDelta(), messageStop],
      [start, args, blockStop, argsDelta(' '), messageDelta(), messageStop],
      [start, args, blockStop, messageDelta(), messageStop, start],
      [{ ...start, index: -1 }, args, blockStop, messageDelta(), messageStop],
      [start, { ...args, index: 0.5 }, blockStop, messageDelta(), messageStop],
      [blockStop, start, args, blockStop, messageDelta(), messageStop],
      [start, args, blockStop, blockStop, messageDelta(), messageStop],
      [start, args, blockStop, messageDelta('max_tokens'), messageDelta(), messageStop],
    ]) await expect(callModel(config, '', [], [], {})).rejects.toThrow('no tools executed');
    frames = [start, args, blockStop, messageDelta(), messageStop];
    expect((await callModel(config, '', [], [], {})).content[0]?.input?.path).toBe('fixture.txt');
    frames = [start, blockStop, messageDelta(), messageStop];
    expect((await callModel(config, '', [], [], {})).content[0]?.input).toEqual({});
  } finally { server.stop(true); }
});

for (const protocol of ['messages', 'chat-completions'] as const) test(`${protocol}: UTF-8 split inside Chinese/emoji survives text, thinking and tool arguments`, async () => {
  const text = '你好🙂', thinking = '分析🚀', argument = '文件🙂.txt';
  const frames = protocol === 'chat-completions' ? [
    { choices: [{ delta: { content: text, reasoning_content: thinking } }] },
    chatDelta(JSON.stringify({ path: argument })), chatFinish(), '[DONE]',
  ] : [
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking } },
    { type: 'content_block_stop', index: 2 }, start, argsDelta(JSON.stringify({ path: argument })), blockStop, messageDelta(), messageStop,
  ];
  const bytes = Buffer.from(frames.map(frame).join(''));
  const cuts = [...bytes.keys()].filter(i => bytes[i]! >= 128).map(i => i + 1);
  const server = Bun.serve({ port: 0, fetch() { return new Response(new ReadableStream({ async start(controller) {
    let previous = 0; for (const cut of [...cuts, bytes.length]) { controller.enqueue(bytes.subarray(previous, cut)); previous = cut; await Bun.sleep(2); } controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    let shown = '', thoughts = '';
    const result = await callModel(configFor(protocol, server.port!), '', [], [], { onTextDelta(delta) { shown += delta; }, onThinkingDelta(delta) { thoughts += delta; } });
    expect(shown).toBe(text); expect(thoughts).toBe(thinking);
    expect(result.content.find(b => b.type === 'tool_use')?.input?.path).toBe(argument);
    expect(result.content.find(b => b.type === 'text')?.text).toBe(text);
  } finally { server.stop(true); }
});

test('a valid first call plus a malformed second call executes neither; same Agent/session can continue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-tool-safety-')); const prior = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state'); let requests = 0;
  const server = Bun.serve({ port: 0, fetch() {
    requests++;
    if (requests > 1) return Response.json({ choices: [{ message: { content: 'CONTINUED' }, finish_reason: 'stop' }] });
    return new Response([
      chatDelta('{"path":"fixture.txt","content":"MUST_NOT_WRITE"}'),
      { choices: [{ delta: { tool_calls: [{ ...chatCall('{', 'call_2'), index: 1 }] } }] }, chatFinish(), '[DONE]',
    ].map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const config = configFor('chat-completions', server.port!); config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.marketplaceEnabled = false;
    await writeFile(join(root, 'fixture.txt'), 'ORIGINAL'); await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const events: string[] = [];
    const agent = await spawnAgent({ goal: 'Update fixture.txt', cwd: root, config, background: false, isolation: 'none', onEvent(event) { events.push(event.type); } });
    expect(agent.status).toBe('failed'); expect(agent.error).toContain('Invalid tool arguments'); expect(events).not.toContain('tool_started');
    expect(await readFile(join(root, 'fixture.txt'), 'utf8')).toBe('ORIGINAL'); expect(requests).toBe(1);
    const continued = await continueAgent(agent.id, 'Continue chatting without modifying any file.', { config });
    expect(continued.status).toBe('completed'); expect(continued.sessionId).toBe(agent.sessionId); expect(continued.result).toBe('CONTINUED');
    expect(JSON.stringify((await loadSession(agent.sessionId)).messages)).not.toContain('MUST_NOT_WRITE');
  } finally { server.stop(true); if (prior === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = prior; await rm(root, { recursive: true, force: true }); }
});
