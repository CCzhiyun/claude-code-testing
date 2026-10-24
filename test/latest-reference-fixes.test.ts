import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { parseMarkdownDocument } from '../src/frontmatter.js';
import { loadSkillsFromDirectories, expandSkillInstructions } from '../src/skills.js';
import { loadAgentsFromDirectories } from '../src/agents.js';
import { spawnAgent, continueAgent } from '../src/agent.js';
import { invokeUserSkill } from '../src/skillInvocation.js';
import { loadSession, forkSession } from '../src/sessions.js';
import { engineeringRuleContext, expandRulePatterns, matchesRulePath } from '../src/scopedRules.js';
import { repositoryContext } from '../src/context.js';
import { loadUserBindings } from '../src/keybindings/loadUserBindings.js';
import { navigateSkills, renderSkillsManager, skillSettingsPatch } from '../src/components/skillsManager.js';
import type { SkillsDialogState } from '../src/components/commandDialogs.js';

const put = async (path: string, value: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, value); };
async function fixture(run: (f: { root: string; home: string; config: typeof defaultConfig; requests: any[] }) => Promise<void>, handler?: (body: any, index: number) => any) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-latest-fixes-')); const home = join(root, 'home');
  const saved = { home: process.env.CCPT_HOME, key: process.env.CCPT_API_KEY };
  process.env.CCPT_HOME = home; process.env.CCPT_API_KEY = 'fixture-key'; const requests: any[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json(); requests.push(body); const output = handler ? handler(body, requests.length) : undefined;
    return Response.json({ id: `resp_fix_${requests.length}`, object: 'response', status: 'completed', output: output ?? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'FIXTURE_DONE' }] }], usage: { input_tokens: 10, output_tokens: 2 } });
  } });
  const config = structuredClone(defaultConfig);
  config.model = { ...config.model, provider: 'openai', apiProtocol: 'responses', responsesTransport: 'native', name: 'fixture', endpointUrl: `http://127.0.0.1:${server.port}/responses` };
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.agents.maxTurns = 8;
  config.skillsDirectories = [join(root, '.ccpt/skills')]; config.agentsDirectories = [join(root, '.ccpt/agents')]; config.pluginDirectories = []; config.hooks = []; config.disableBundledSkills = true;
  await put(join(home, 'settings.json'), JSON.stringify(config));
  try { await run({ root, home, config, requests }); }
  finally { server.stop(true); if (saved.home === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = saved.home; if (saved.key === undefined) delete process.env.CCPT_API_KEY; else process.env.CCPT_API_KEY = saved.key; await rm(root, { recursive: true, force: true }); }
}

test('raw readline ESC meta flag is normalized without making Alt+key match plain keys', async () => {
  await fixture(async ({ root }) => {
    const resolver = await loadUserBindings(root);
    expect(resolver.resolve('', { name: 'escape', sequence: '\u001b', meta: true, shift: false, ctrl: false }, ['Chat'])).toEqual({ type: 'match', action: 'chat:interrupt' });
    expect(resolver.resolve('c', { name: 'c', sequence: '\u001bc', meta: true }, ['Chat'])).not.toEqual({ type: 'match', action: 'chat:interrupt' });
    expect(resolver.resolve('', { name: 'tab', sequence: '\u001b[Z', shift: true }, ['Chat'])).toEqual({ type: 'match', action: 'permission:cycleMode' });
  });
});

test('frontmatter rejects unclosed/duplicate/unsafe keys and correctly parses quoted comma, boolean, CRLF and EOF terminator', () => {
  for (const input of ['---\ndisable-model-invocation: true\nBody', '---\nuser-invocable: false\nuser-invocable: true\n---\nBody', '---\n__proto__: x\n---\nBody', '---\nitems: ["bad]\n---\nBody']) expect(() => parseMarkdownDocument(input)).toThrow();
  expect(parseMarkdownDocument('---\r\nitems: ["a,b", "c", true, false]\r\n---\r\nBody').attributes.items).toEqual(['a,b', 'c', true, false]);
  expect(parseMarkdownDocument('\uFEFF---\nname: x\n---').body).toBe('');
  expect(parseMarkdownDocument('---\n---\nBody')).toEqual({ attributes: {}, body: 'Body' });
});

test('named Skill arguments follow positional order, limit 64 names/64 chars and never recursively expand values', async () => {
  await fixture(async ({ config }) => {
    const path = join(config.skillsDirectories[0]!, 'args/SKILL.md');
    await put(path, '---\nname: args\ndescription: Base\nwhen_to_use: Extra trigger\narguments: [issue, branch]\n---\n$issue | $branch | $2');
    const skill = (await loadSkillsFromDirectories([path])).skills[0]!;
    expect(skill.description).toBe('Base Extra trigger');
    expect(expandSkillInstructions(skill, '"$ARGUMENTS literal"')).toBe('$ARGUMENTS literal |  | $2');
    expect(expandSkillInstructions({ ...skill, instructions: '$2' }, 'one')).toBe('$2\n\nARGUMENTS: one');
    expect(expandSkillInstructions({ ...skill, instructions: '$issue $branch' }, '')).toBe(' ');
    const names = Array.from({ length: 65 }, (_, i) => `n${i}`);
    await put(path, `---\nname: args\narguments: ${names.join(' ')}\n---\n$n63 $n64`);
    const capped = (await loadSkillsFromDirectories([path])).skills[0]!;
    expect(capped.argumentNames).toHaveLength(64);
    expect(expandSkillInstructions(capped, names.join(' '))).toBe('n63 $n64');
    expect(() => expandSkillInstructions({ ...skill, instructions: '$ARGUMENTS '.repeat(11) }, 'x'.repeat(100_000))).toThrow('1 MB');
  });
});

test('Skill metadata fails clearly for non-enforced security fields and oversized files', async () => {
  await fixture(async ({ config }) => {
    for (const field of ['paths: [src/**]', 'disallowed-tools: Write']) {
      const path = join(config.skillsDirectories[0]!, 'restricted/SKILL.md'); await put(path, `---\n${field}\n---\nBody`);
      const loaded = await loadSkillsFromDirectories([path]); expect(loaded.skills).toHaveLength(0); expect(loaded.errors[0]).toContain('not enforced');
    }
    const large = join(config.skillsDirectories[0]!, 'large/SKILL.md'); await put(large, 'x'.repeat(1_000_001)); expect((await loadSkillsFromDirectories([large])).errors[0]).toContain('1 MB');
  });
});

test('author-only Skills are clearly locked in UI and search deletes complete graphemes', () => {
  const state: SkillsDialogState = { type: 'skills', selected: 0, expanded: false, skills: [{ name: 'manual', path: 'SKILL.md', source: 'project', description: 'Manual', instructions: 'Read', disableModelInvocation: true, visibility: 'on' }] };
  navigateSkills(state, 'space'); navigateSkills(state, '', 'm');
  expect(state.pendingOverrides).toBeUndefined(); expect(state.pendingModes).toBeUndefined();
  expect(renderSkillsManager(state, 80, 24).join('\n')).toContain('[author] user-only');
  state.pendingOverrides = { manual: 'on' }; expect(skillSettingsPatch(state).skillOverrides).toBeUndefined();
  state.searching = true;
  for (const grapheme of ['👩‍💻', 'e\u0301', '🇨🇳']) { state.query = 'x' + grapheme; navigateSkills(state, 'backspace'); expect(state.query).toBe('x'); }
});

test('inline Skill body survives continuation, disk resume and fork while next-turn tools are not permanently narrowed', async () => {
  await fixture(async ({ root, config, requests }) => {
    await put(join(config.skillsDirectories[0]!, 'sticky/SKILL.md'), '---\nname: sticky\ndescription: Explicit fixture\ndisable-model-invocation: true\nallowed-tools: Read\n---\nPERSISTENT_SKILL_CONVENTION $ARGUMENTS');
    const lead = (await invokeUserSkill({ name: 'sticky', args: 'first', cwd: root, config })).agent;
    expect(requests[0].tools.map((t: any) => t.name)).toEqual(['read_file']);
    const resumed = await continueAgent(lead.id, 'Second normal coding question', { config });
    expect(JSON.stringify(requests[1].input)).toContain('PERSISTENT_SKILL_CONVENTION first');
    expect(requests[1].tools.some((t: any) => t.name === 'write_file')).toBe(true);
    expect(resumed.id).toBe(lead.id); expect(resumed.sessionId).toBe(lead.sessionId);
    const persisted = await loadSession(lead.sessionId); const fork = await forkSession(persisted.id);
    expect(JSON.stringify(fork.messages)).toContain('PERSISTENT_SKILL_CONVENTION first');
    expect(JSON.stringify(persisted.messages).split('PERSISTENT_SKILL_CONVENTION').length - 1).toBe(1);
  });
});

test('Plan Agent definition loads recursively, enforces real tool filtering and cannot execute a model write', async () => {
  await fixture(async ({ root, config, requests }) => {
    await put(join(config.agentsDirectories[0]!, 'research/deep/planner.md'), '---\nname: planner\ndescription: Research\npermissionMode: plan\ntools: Read Write Agent\n---\nResearch only');
    expect((await loadAgentsFromDirectories(config.agentsDirectories)).agents[0]?.permissionMode).toBe('plan');
    const planner = await spawnAgent({ role: 'planner', goal: 'Plan the synthetic change', cwd: root, config, background: false, isolation: 'none' });
    expect(planner.planMode).toBe(true); expect(planner.status).toBe('completed');
    expect(requests[0].tools.some((t: any) => ['write_file', 'delegate'].includes(t.name))).toBe(false);
    expect(JSON.stringify(requests[1].input)).toContain('not enabled'); await expect(access(join(root, 'blocked.txt'))).rejects.toThrow();
  }, (_, index) => index === 1 ? [{ type: 'function_call', call_id: 'blocked', name: 'write_file', arguments: JSON.stringify({ path: 'blocked.txt', content: 'must not exist' }) }] : undefined);
});

test('Rules startup strips metadata, loads global conventions and defers paths until actual matching file access', async () => {
  await fixture(async ({ root, home, config, requests }) => {
    await put(join(home, 'rules/general.md'), 'USER_GLOBAL_RULE');
    await put(join(root, '.ccpt/rules/api.md'), '---\npaths: ["src/api/**/*.{ts,tsx}"]\n---\nLAZY_API_RULE');
    await put(join(root, 'src/ui/view.ts'), 'UI_FILE'); await put(join(root, 'src/api/main.ts'), 'API_FILE');
    const initial = await repositoryContext(root, config); expect(initial).toContain('USER_GLOBAL_RULE'); expect(initial).not.toContain('LAZY_API_RULE'); expect(initial).not.toContain('paths:');
    const agent = await spawnAgent({ goal: 'Read synthetic files', cwd: root, config, background: false, isolation: 'none' });
    expect(agent.status).toBe('completed');
    expect(JSON.stringify(requests[0])).not.toContain('LAZY_API_RULE'); expect(JSON.stringify(requests[1])).not.toContain('LAZY_API_RULE');
    expect(JSON.stringify(requests[2].input)).toContain('LAZY_API_RULE');
    expect(JSON.stringify(requests[3].input).split('LAZY_API_RULE').length - 1).toBe(1);
    await continueAgent(agent.id, 'Continue the same task', { config }); expect(JSON.stringify(requests.at(-1).input)).toContain('LAZY_API_RULE');
    expect((await engineeringRuleContext(root, config, { files: ['../outside.ts'] }))).toBe('');
  }, (_, index) => index <= 3 ? [{ type: 'function_call', call_id: `read_${index}`, name: 'read_file', arguments: JSON.stringify({ path: index === 1 ? 'src/ui/view.ts' : 'src/api/main.ts' }) }] : undefined);
});

test('Rules glob variants are bounded and invalid patterns never match everything', () => {
  for (const file of ['src/api/a.ts', 'src/api/deep/a.ts']) expect(matchesRulePath('src/api/**/*.ts', file)).toBe(true);
  expect(matchesRulePath('src/api/**/*.ts', 'src\\api\\a.ts')).toBe(true);
  expect(matchesRulePath('src/api/**/*.ts', 'src/ui/a.ts')).toBe(false);
  expect(matchesRulePath('src/[!x]/*.ts', 'src/a/a.ts')).toBe(true);
  expect(matchesRulePath('src/[bad/**', 'src/anything/a.ts')).toBe(false);
  expect(matchesRulePath('**/*.ts', '../secret.ts')).toBe(false);
  expect(expandRulePatterns(['src/**/*.{ts,tsx}'])).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
  expect(expandRulePatterns(['{a,b}'.repeat(20) + '/**']).length).toBeLessThanOrEqual(1000);
  expect(matchesRulePath('*a'.repeat(80) + 'b', 'a'.repeat(500))).toBe(false);
  expect(matchesRulePath('src/**/组件?.ts', 'src/深层/组件中.ts')).toBe(true);
});

test('invalid rule headers report diagnostics rather than entering active instructions', async () => {
  await fixture(async ({ root, config }) => {
    await put(join(root, '.ccpt/rules/bad.md'), '---\npaths: false\n---\nBAD_SCOPE_BODY');
    const result = await engineeringRuleContext(root, config); expect(result).toContain('Rule diagnostics'); expect(result).not.toContain('BAD_SCOPE_BODY');
  });
});
