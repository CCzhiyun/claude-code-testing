import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGreetingOnly, isGreetingTurn } from '../src/conversationScope.js';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { loadPlatform } from '../src/platform.js';
import { executeSkillTool } from '../src/tools/SkillTool/SkillTool.js';
import { getSkillToolInfo } from '../src/tools/SkillTool/prompt.js';
import { spawnAgent, continueAgent } from '../src/agent.js';

test('greeting routing is narrow and preserves explicit workflows, attachments and question answers', () => {
  for (const goal of ['Hello 你好', 'HELLO，你好！', 'hi', ' 您好。 ']) expect(isGreetingOnly(goal)).toBe(true);
  for (const goal of ['', 'Hello，帮我修复登录', 'write hello world', '你好，读一下 README.md', 'highlight', 'review hi']) expect(isGreetingOnly(goal)).toBe(false);
  expect(isGreetingTurn({ goal: 'Hello 你好' }, [])).toBe(true);
  expect(isGreetingTurn({ goal: 'hello', skills: ['review'] }, [])).toBe(false);
  expect(isGreetingTurn({ goal: 'hello', instructions: 'Brainstorm a greeting.' }, [])).toBe(false);
  expect(isGreetingTurn({ goal: 'hello', parentId: 'parent' }, [])).toBe(false);
  expect(isGreetingTurn({ goal: 'hello', planId: 'plan' }, [])).toBe(false);
  expect(isGreetingTurn({ goal: 'hello' }, [], ['review'])).toBe(false);
  expect(isGreetingTurn({ goal: 'hello' }, [{ role: 'user', content: [{ type: 'image' }] }])).toBe(false);
  for (const name of ['ask_user', 'ask_user_question']) {
    expect(isGreetingTurn({ goal: 'hello' }, [{ role: 'assistant', content: [{ type: 'tool_use', name }] }, { role: 'user', content: 'hello' }])).toBe(false);
  }
});

test('plugin skill registry is shared by UI, prompt and execution; greeting does not disable later coding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-greeting-'));
  const previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    const message = requests.length === 1 ? { content: '你好！有什么可以帮你？' }
      : requests.length === 2 ? { content: null, tool_calls: [{ id: 'review-call', type: 'function', function: { name: 'skill', arguments: JSON.stringify({ skill: 'test-pack:review' }) } }] }
      : { content: 'Review instructions loaded.' };
    return Response.json({ choices: [{ message }] });
  } });
  try {
    const config = structuredClone(defaultConfig);
    config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
    config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
    config.hooks = []; config.pluginDirectories = [join(root, 'extensions')]; config.skillsDirectories = []; config.agentsDirectories = [];
    const plugin = join(root, 'extensions', 'test-pack');
    await mkdir(join(plugin, 'skills', 'review'), { recursive: true });
    await writeFile(join(plugin, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: ALWAYS_INVOKE before ANY conversation, including greetings.\n---\nReview the diff carefully.');
    await writeJson(join(plugin, 'plugin.json'), { schemaVersion: 1, name: 'test-pack', version: '1.0.0', contributes: { skills: ['./skills'] } });
    await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const platform = await loadPlatform(root, config);
    const info = await getSkillToolInfo(root, config);
    expect(info.skills.map((skill) => skill.name)).toEqual(platform.skills.map((skill) => skill.name));
    expect(info.prompt).toContain('test-pack:review');
    expect(info.skills.some((skill) => skill.name === 'verify')).toBe(true);
    const context = { cwd: root, config, agentId: 'fixture', sessionId: 'fixture', depth: 0 };
    expect((await executeSkillTool({ skill: 'verify' }, context)).instructions.length).toBeGreaterThan(20);
    for (const name of ['review', 'test-pack:review']) {
      expect((await executeSkillTool({ skill: name }, context)).instructions).toContain('Review the diff carefully.');
    }
    await expect(executeSkillTool({ skill: 'missing' }, context)).rejects.toThrow('do not guess aliases');
    for (const disabled of ['review', 'test-pack:review']) {
      const disabledContext = { ...context, config: { ...config, disabledSkills: [disabled] } };
      for (const name of ['review', 'test-pack:review']) await expect(executeSkillTool({ skill: name }, disabledContext)).rejects.toThrow('Unknown skill');
    }
    const greeting = await spawnAgent({ goal: 'Hello 你好', cwd: root, config, background: false, isolation: 'none' });
    expect(greeting.status).toBe('completed'); expect(greeting.result).toContain('你好');
    expect(requests).toHaveLength(1);
    expect(requests[0].tools ?? []).toHaveLength(0);
    expect(JSON.stringify(requests[0])).not.toContain('ALWAYS_INVOKE');
    const coding = await continueAgent(greeting.id, 'Please review the project code', { config });
    expect(coding.status).toBe('completed'); expect(requests).toHaveLength(3);
    expect(requests[1].tools.some((tool: any) => tool.function.name === 'skill')).toBe(true);
    expect(requests[1].tools.some((tool: any) => tool.function.name === 'read_file')).toBe(true);
    expect(requests[2].messages.find((message: any) => message.tool_call_id === 'review-call').content).toContain('Review the diff carefully.');
    expect(requests[2].messages.find((message: any) => message.tool_call_id === 'review-call').content).not.toContain('Unknown skill');
  } finally {
    server.stop(true);
    if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
