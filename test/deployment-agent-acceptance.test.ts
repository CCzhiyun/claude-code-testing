import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { spawnAgent, continueAgent, cancelAgent } from '../src/agent.js';
import { loadSession } from '../src/sessions.js';
import { writeJson } from '../src/storage.js';
import { tools } from '../src/tooling.js';
import { validateToolSchemas } from '../src/toolSchema.js';

// Real Agent runtime and real local read_file execution; the provider is a strict LOCAL fixture.
for (const mode of ['chat-completions', 'responses', 'responses-chat-bridge'] as const) test(`${mode}: greeting, full-catalog ordinary/multi-turn chat, actual tool roundtrip, stream cancel and resume`, async () => {
  const protocol = mode === 'responses' ? 'responses' : 'chat-completions';
  const root = await mkdtemp(join(tmpdir(), 'ccpt-deployment-'));
  const prior = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body: any = await request.json(); requests.push(body);
    const index = requests.length;
    if (protocol === 'chat-completions' && body.tools?.length && body.reasoning_effort !== 'none') return Response.json({ error: { code: 'invalid_request_error', param: 'reasoning_effort', message: 'Function tools with reasoning_effort are not supported. Use Responses or none.' } }, { status: 400 });
    const catalog = (body.tools ?? []).map((t: any) => ({ name: t.name ?? t.function.name, description: '', input_schema: t.parameters ?? t.function.parameters }));
    try { validateToolSchemas(catalog); } catch { return Response.json({ error: 'Invalid tool schema' }, { status: 400 }); }
    if (index === 6) {
      // A partial malicious tool call must not execute when generation is cancelled.
      const delta = protocol === 'responses'
        ? { type: 'response.output_text.delta', delta: 'CANCEL_MARKER' }
        : { choices: [{ delta: { content: 'CANCEL_MARKER', tool_calls: [{ index: 0, id: 'partial', type: 'function', function: { name: 'write_file', arguments: '{"path":"fixture.txt","content":' } }] } }] };
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\n`)); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    const text = index === 1 ? '你好 CCPT' : index === 2 ? 'I can read and explain project files.' : index === 4 ? 'File says ACCEPTANCE_FIXTURE.' : index === 5 ? 'Previous file: ACCEPTANCE_FIXTURE.' : 'RESUMED_OK';
    const input = { path: 'fixture.txt' };
    if (protocol === 'chat-completions') {
      const delta = index === 3 ? { tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read_file', arguments: JSON.stringify(input) } }] } : { content: text };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: index === 3 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    const output = index === 3 ? [{ type: 'function_call', call_id: 'call_read', name: 'read_file', arguments: JSON.stringify(input) }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }];
    return new Response(`${index === 3 ? '' : `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`}data: ${JSON.stringify({ type: 'response.completed', response: { id: `resp_${index}`, status: 'completed', output, usage: { input_tokens: 100, output_tokens: 10 } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const config = structuredClone(defaultConfig);
  if (mode === 'responses-chat-bridge') { config.model.apiProtocol = 'responses'; config.model.responsesTransport = 'chat-completions'; }
  else if (mode === 'chat-completions') config.model.apiProtocol = 'chat-completions';
  // Native mode deliberately uses the real Responses-first default, not an override.
  config.model.endpointUrl = `http://127.0.0.1:${server.port}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`;
  config.model.chatToolReasoning = 'none'; config.model.thinkingEnabled = true; config.model.reasoningEffort = 'high';
  config.modelRetry = { maxRetries: 0 }; config.model.maxContextTokens = 128000;
  config.agents.defaultIsolation = 'none'; config.marketplaceEnabled = false; config.policy.workspaceRoots = [root];
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 10000 };
  await writeFile(join(root, 'fixture.txt'), 'ACCEPTANCE_FIXTURE');
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  try {
    let agent = await spawnAgent({ goal: '你好', cwd: root, config, isolation: 'none', background: false });
    expect(agent.status).toBe('completed'); expect(requests[0].tools ?? []).toHaveLength(0);
    agent = await continueAgent(agent.id, 'What capabilities can you provide?', { config });
    expect(agent.status).toBe('completed'); expect(requests[1].tools).toHaveLength(tools.length);
    agent = await continueAgent(agent.id, 'Read fixture.txt and explain its contents.', { config });
    expect(agent.status).toBe('completed'); expect(agent.result).toContain('ACCEPTANCE_FIXTURE'); expect(requests).toHaveLength(4);
    const history = protocol === 'responses' ? requests[3].input : requests[3].messages;
    expect(JSON.stringify(history)).toContain('ACCEPTANCE_FIXTURE');
    expect(history.some((item: any) => protocol === 'responses' ? item.type === 'function_call_output' && item.call_id === 'call_read' : item.role === 'tool' && item.tool_call_id === 'call_read')).toBe(true);
    agent = await continueAgent(agent.id, 'Summarize what the previous file contained.', { config });
    expect(agent.status).toBe('completed'); expect(requests).toHaveLength(5);
    const started = Date.now(); let cancellation: Promise<unknown> | undefined;
    agent = await continueAgent(agent.id, 'Start a long streamed response.', { config, onEvent(event) {
      if (event.type === 'text_delta' && event.delta.includes('CANCEL_MARKER') && !cancellation) cancellation = cancelAgent(agent.id);
    } });
    await cancellation;
    expect(cancellation).toBeDefined(); expect(agent.status).toBe('cancelled'); expect(Date.now() - started).toBeLessThan(5000);
    expect(requests).toHaveLength(6); expect(await readFile(join(root, 'fixture.txt'), 'utf8')).toBe('ACCEPTANCE_FIXTURE');
    const sessionId = agent.sessionId;
    agent = await continueAgent(agent.id, 'Continue after my cancellation.', { config });
    expect(agent.status).toBe('completed'); expect(agent.result).toBe('RESUMED_OK'); expect(agent.sessionId).toBe(sessionId);
    const saved = await loadSession(sessionId); expect(JSON.stringify(saved.messages)).toContain('ACCEPTANCE_FIXTURE');
    for (const body of requests.slice(1)) {
      expect(body.tools).toHaveLength(tools.length);
      if (protocol === 'responses') { expect(body.messages).toBeUndefined(); expect(body.reasoning.effort).toBe('high'); }
      else { expect(body.input).toBeUndefined(); expect(body.reasoning_effort).toBe('none'); }
    }
  } finally {
    server.stop(true); if (prior === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = prior;
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
