// Synthetic local provider for differential client/UI stories; no real model inference.
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const project = resolve(import.meta.dir, '..');
const root = process.env.CCPT_STORY_FIXTURE_DIR ? resolve(process.env.CCPT_STORY_FIXTURE_DIR) : join(project, '.ccpt/story-20261016');
if (!root.startsWith(join(project, '.ccpt') + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Fixture must stay under the project audit state directory');
const workspace = join(root, 'workspace'), evidence = join(root, 'evidence');
const put = async (path: string, content: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content); };
await mkdir(evidence, { recursive: true });
const fixtures = [
  ['story-echo', 'disable-model-invocation: true\nallowed-tools: Read', 'STORY_ECHO_BODY. Retain this convention throughout the task. Args=$ARGUMENTS. First=$0. Second=$ARGUMENTS[1].'],
  ['story-auto', '', 'STORY_AUTO_BODY. This is synthetic context only.'],
  ['story-model-only', 'user-invocable: false', 'STORY_MODEL_ONLY_BODY.'],
  ['story-off', '', 'STORY_OFF_BODY.'],
  ['story-fork', 'disable-model-invocation: true\ncontext: fork\nagent: story-reviewer', 'STORY_FORK_BODY $ARGUMENTS.'],
  ...Array.from({ length: 14 }, (_, n) => [`story-page-${String(n).padStart(2, '0')}`, '', `STORY_PAGE_${n}`]),
];
for (const folder of ['.claude', '.ccpt']) {
  for (const [name, fields, body] of fixtures) await put(join(workspace, folder, 'skills', name!, 'SKILL.md'), `---\nname: ${name}\ndescription: Synthetic ${name} validation only, not a mandatory workflow.\n${fields ? fields + '\n' : ''}---\n${body}\n`);
  await put(join(workspace, folder, 'agents/story-reviewer.md'), '---\nname: story-reviewer\ndescription: Synthetic read-only story reviewer\ntools: Read\nmodel: inherit\nmaxTurns: 2\n---\nSTORY_REVIEWER_PROFILE. Read only the synthetic workspace.');
  await put(join(workspace, folder, 'agents/story-planner.md'), '---\nname: story-planner\ndescription: Synthetic Plan definition boundary\npermissionMode: plan\ntools: Read\n---\nSTORY_PLANNER_PROFILE. Research only.');
  await put(join(workspace, folder, 'rules/api-only.md'), '---\npaths:\n  - "src/api/**/*.ts"\n---\nSTORY_API_RULE_MARKER: API files must use the synthetic response envelope.');
}
await put(join(workspace, 'src/ui/example.ts'), 'export const fixture = "STORY_UI_FILE";\n');
await put(join(workspace, 'src/api/example.ts'), 'export const fixture = "STORY_API_FILE";\n');
if (!process.argv[2]) {
  await put(join(root, 'reference-home/.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark' }));
  await put(join(root, 'reference-home/settings.json'), JSON.stringify({ disableBundledSkills: true, skillOverrides: { 'story-off': 'off' }, permissions: { defaultMode: 'default', allow: ['Read(./**)'], deny: ['Bash', 'PowerShell', 'Write', 'Edit', 'WebFetch', 'WebSearch'] } }));
}

const prior = process.argv[2] ? await readFile(join(evidence, 'model-requests.ndjson'), 'utf8').catch(() => '') : '';
const requests: Array<{ index: number; protocol: string; body: any; responseKind: string }> = prior.split('\n').filter(Boolean).map(line => JSON.parse(line));
let count = requests.at(-1)?.index ?? 0;
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.argv[2] ?? 0), async fetch(req) {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/audit') return Response.json({ requests });
  if (req.method !== 'POST' || !/\/(messages|responses)$/.test(url.pathname)) return Response.json({ error: { message: 'Synthetic provider: unsupported route' } }, { status: 404 });
  const body = await req.json() as any;
  const protocol = url.pathname.endsWith('/responses') ? 'responses' : 'messages';
  const input = protocol === 'responses' ? body.input : body.messages;
  // The reference may append role:system metadata AFTER the human input.
  // Do not mistake that suffix for a user turn or claim that an untriggered tool was tested.
  const last = Array.isArray(input) ? [...input].reverse().find((item: any) => item.type === 'function_call_output' || item.role === 'user' && !(typeof item.content === 'string' && item.content.startsWith('[Untrusted Agent team mailbox:'))) ?? input.at(-1) : input;
  const text = typeof last === 'string' ? last : JSON.stringify(last ?? '');
  const readKind = text.includes('STORY_READ_UI') ? 'ui' : text.includes('STORY_READ_API') ? 'api' : undefined;
  const isToolResult = last?.type === 'function_call_output' || Array.isArray(last?.content) && last.content.some((x: any) => x.type === 'tool_result');
  const tool = readKind && !isToolResult ? (body.tools ?? []).find((t: any) => t.name === (protocol === 'responses' ? 'read_file' : 'Read')) : undefined;
  const index = ++count, callId = `story_call_${index}`;
  const args = protocol === 'responses' ? { path: `src/${readKind}/example.ts` } : { file_path: join(workspace, `src/${readKind}/example.ts`) };
  const responseKind = tool ? 'read-tool' : 'text';
  requests.push({ index, protocol, body, responseKind });
  await appendFile(join(evidence, 'model-requests.ndjson'), JSON.stringify(requests.at(-1)) + '\n');
  const answer = `STORY_REPLY_${index}`;
  const slow = text.includes('STORY_SLOW_STREAM') && !String(body.system ?? body.instructions ?? '').includes('Write the title');
  const eventResponse = (events: string[]) => {
    if (!slow) return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    const encoder = new TextEncoder(); let timer: ReturnType<typeof setTimeout> | undefined; let cursor = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = () => {
          if (cursor === events.length) { controller.close(); return; }
          controller.enqueue(encoder.encode(events[cursor++]));
          timer = setTimeout(send, 1500);
        };
        send();
      },
      cancel() { if (timer) clearTimeout(timer); void appendFile(join(evidence, 'stream-cancels.ndjson'), JSON.stringify({ index, protocol, cancelled: true }) + '\n'); },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  if (protocol === 'responses') {
    const output = tool ? [{ type: 'function_call', id: `fc_${index}`, call_id: callId, name: tool.name, arguments: JSON.stringify(args), status: 'completed' }]
      : [{ type: 'message', id: `msg_${index}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] }];
    const response = { id: `resp_story_${index}`, object: 'response', status: 'completed', model: body.model, output, usage: { input_tokens: 25, output_tokens: 4, total_tokens: 29 } };
    if (!body.stream) return Response.json(response);
    const events = tool ? [] : Array.from({ length: slow ? 20 : 1 }, () => ({ type: 'response.output_text.delta', delta: answer }));
    return eventResponse([...events, { type: 'response.completed', response }].map(e => `data: ${JSON.stringify(e)}\n\n`));
  }
  const content = tool ? [{ type: 'tool_use', id: callId, name: tool.name, input: args }] : [{ type: 'text', text: answer }];
  const response = { id: `msg_story_${index}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 25, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
  if (!body.stream) return Response.json(response);
  const events = [
    { type: 'message_start', message: { ...response, content: [], stop_reason: null, usage: { ...response.usage, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { ...content[0], input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(args) } : { type: 'text_delta', text: answer } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: response.stop_reason, stop_sequence: null }, usage: response.usage },
    { type: 'message_stop' },
  ];
  if (slow) events.splice(3, 0, ...Array.from({ length: 20 }, () => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '.' } })) as any[]);
  return eventResponse(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
} });
const endpoint = `http://127.0.0.1:${server.port}`;
if (!process.argv[2]) await put(join(root, 'ccpt-home/settings.json'), JSON.stringify({ model: { provider: 'openai', apiProtocol: 'responses', responsesTransport: 'native', name: 'story-fixture', endpointUrl: endpoint + '/responses' }, marketplaceEnabled: false, disableBundledSkills: true, skillOverrides: { 'story-off': 'off' }, agents: { defaultIsolation: 'none', maxTurns: 4 }, network: { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true } }, null, 2));
await put(join(evidence, 'fixture.json'), JSON.stringify({ endpoint, workspace, root, skillDefinitions: fixtures.length, provider: 'synthetic-local-only' }, null, 2));
console.log(JSON.stringify({ ready: true, endpoint, workspace, root, skills: fixtures.length }));
// Bound this test helper's lifetime; no daemon or recurring automation is installed.
setTimeout(() => { server.stop(true); process.exit(0); }, 45 * 60_000);
