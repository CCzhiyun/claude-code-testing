import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { writeJson } from '../src/storage.js';
import type { ModelMessage } from '../src/types.js';

test('three shipped settings templates load and perform tool-result round trips through their selected wire protocol', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-settings-protocol-'));
  const names = ['CCPT_HOME', 'CCPT_MANAGED_CONFIG', 'CCPT_API_KEY', 'OPENAI_API_KEY', 'CCPT_MESSAGES_API_KEY'] as const;
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.CCPT_HOME = join(root, 'state'); delete process.env.CCPT_MANAGED_CONFIG;
  process.env.CCPT_API_KEY = 'bearer-fixture'; process.env.OPENAI_API_KEY = 'bearer-fixture'; process.env.CCPT_MESSAGES_API_KEY = 'messages-fixture';
  const received: { body: any; headers: Headers }[] = [];
  let protocol = '', round = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    received.push({ body: await request.json(), headers: request.headers });
    const tool = round++ === 0;
    if (protocol === 'messages') return Response.json({ content: tool ? [{ type: 'tool_use', id: 'call1', name: 'echo', input: { text: 'hello' } }] : [{ type: 'text', text: 'done' }], stop_reason: tool ? 'tool_use' : 'end_turn' });
    if (protocol === 'responses') return Response.json({ id: 'resp1', status: 'completed', output: tool ? [{ type: 'function_call', id: 'item1', call_id: 'call1', name: 'echo', arguments: '{"text":"hello"}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] });
    return Response.json({ choices: [{ message: tool ? { tool_calls: [{ id: 'call1', type: 'function', function: { name: 'echo', arguments: '{"text":"hello"}' } }] } : { content: 'done' }, finish_reason: tool ? 'tool_calls' : 'stop' }] });
  } });
  try {
    for (protocol of ['messages', 'responses', 'chat-completions']) {
      round = 0; received.length = 0;
      const template = JSON.parse(await readFile(new URL(`../docs/settings-${protocol}.example.json`, import.meta.url), 'utf8'));
      template.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/${protocol === 'chat-completions' ? 'chat/completions' : protocol}`;
      template.network.allowedHosts = ['127.0.0.1']; template.network.caFile = ''; template.network.proxyUrl = '';
      await writeJson(join(root, 'state', 'settings.json'), template);
      const config = await loadConfig(root);
      const tools = [{ name: 'echo', description: 'Echo', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }];
      const history: ModelMessage[] = [{ role: 'user', content: 'Echo hello' }];
      const first = await callModel(config, 'rules', history, tools);
      expect(first.content.filter(block => block.type === 'tool_use')).toEqual([{ type: 'tool_use', id: 'call1', name: 'echo', input: { text: 'hello' } }]);
      history.push({ role: 'assistant', content: first.content, ...(first.responses ? { responses: first.responses } : {}) }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: 'hello' }] });
      expect((await callModel(config, 'rules', history, tools)).content).toEqual([{ type: 'text', text: 'done' }]);
      const { body, headers } = received[1]!;
      expect(headers.get('api-key')).toBeNull();
      expect(headers.get('authorization')).toBe(protocol === 'messages' ? null : 'Bearer bearer-fixture');
      expect(headers.get('x-api-key')).toBe(protocol === 'messages' ? 'messages-fixture' : null);
      if (protocol === 'responses') {
        expect(body.instructions).toBe('rules'); expect(body.messages).toBeUndefined();
        expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'call1', output: 'hello' });
      } else if (protocol === 'messages') {
        expect(body.system).toBe('rules'); expect(body.messages.at(-1).content[0].type).toBe('tool_result');
      } else {
        expect(body.messages[0]).toEqual({ role: 'system', content: 'rules' });
        expect(body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call1', content: 'hello' });
      }
    }
  } finally {
    server.stop(true);
    for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; }
    await rm(root, { recursive: true, force: true });
  }
});
