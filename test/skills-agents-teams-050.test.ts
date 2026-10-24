import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, validateConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { loadPlatform } from '../src/platform.js';
import { loadSkillsFromDirectories, expandSkillInstructions, skillCatalog, modelInvocableSkill, userInvocableSkill } from '../src/skills.js';
import { parseMarkdownDocument } from '../src/frontmatter.js';
import { loadAgentsFromDirectories, agentPermissionMode } from '../src/agents.js';
import { spawnAgent, continueAgent, loadAgent, saveAgent, listAgents } from '../src/agent.js';
import { invokeUserSkill } from '../src/skillInvocation.js';
import { loadSession } from '../src/sessions.js';
import { createTeam, listTeams, deleteTeam } from '../src/teamStore.js';
import { sendTeamMessage, readTeamMailbox, broadcastTeamMessage, requestTeamShutdown } from '../src/mailbox.js';
import { agentMemoryDirectory, writeAgentMemory, readAgentMemory, listAgentMemory } from '../src/agentMemory.js';
import { loadProjectPlan, transitionProjectPlan } from '../src/plans.js';
import { navigateSkills, skillSettingsPatch } from '../src/components/skillsManager.js';
import type { SkillsDialogState } from '../src/components/commandDialogs.js';

const tool = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content = 'FIXTURE-DONE', calls?: unknown[]) => Response.json({ choices: [{ message: calls ? { content: null, tool_calls: calls } : { content } }], usage: { prompt_tokens: 200, completion_tokens: 20 } });
async function fixture(run: (f: { root: string; state: string; config: typeof defaultConfig; requests: any[]; skill: (name: string, front: string, body: string) => Promise<void> }) => Promise<void>, handler?: (body: any, index: number) => Response | Promise<Response>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-050-')); const state = join(root, 'state'); const previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = state; const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) { const body = await request.json(); requests.push(body); return handler ? handler(body, requests.length) : reply(); } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 8000 };
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.agents.maxTurns = 6;
  config.skillsDirectories = [join(root, '.ccpt', 'skills')]; config.agentsDirectories = [join(root, '.ccpt', 'agents')]; config.pluginDirectories = []; config.hooks = []; config.disableBundledSkills = true;
  const skill = async (name: string, front: string, body: string) => { await mkdir(join(config.skillsDirectories[0]!, name), { recursive: true }); await writeFile(join(config.skillsDirectories[0]!, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} workflow\n${front}\n---\n${body}`); };
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  try { await run({ root, state, config, requests, skill }); }
  finally { server.stop(true); if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
}

test('Skills parse YAML string lists, folded descriptions and literal argument placeholders without code execution', async () => {
  expect(parseMarkdownDocument('---\ndescription: >\n  First line\n  second line\nallowed-tools:\n  - Read\n  - Grep\n---\nBody').attributes).toEqual({ description: 'First line second line', 'allowed-tools': ['Read', 'Grep'] });
  expect(() => parseMarkdownDocument('---\n__proto__: bad\n---\nBody')).toThrow('Unsafe');
  expect(() => parseMarkdownDocument('---\nnested:\n  tools: Read\n---\nBody')).toThrow('Unsupported nested');
  await fixture(async ({ config, skill }) => {
    await skill('compare', 'allowed-tools:\n  - Read\n  - Grep\nargument-hint: <first> <second>\nuser-invocable: false', 'Compare $0 and $ARGUMENTS[1]. All=$ARGUMENTS. !`do-not-run`');
    const loaded = await loadSkillsFromDirectories(config.skillsDirectories); expect(loaded.errors).toEqual([]);
    const definition = loaded.skills[0]!; expect(definition.tools).toEqual(['read_file', 'search_text']); expect(userInvocableSkill(definition)).toBe(false); expect(modelInvocableSkill(definition)).toBe(true);
    expect(expandSkillInstructions(definition, '"one path" two')).toBe('Compare one path and two. All="one path" two. !`do-not-run`');
    expect(expandSkillInstructions({ ...definition, instructions: 'Check this.' }, 'three')).toContain('ARGUMENTS: three');
    await skill('bad', 'allowed-tools: Bash(git *)', 'Bad'); expect((await loadSkillsFromDirectories(config.skillsDirectories)).errors.join()).toContain('exact tool names');
  });
});

test('four Skill visibility states, conservative alias/frontmatter policies and bundled-disable are real registry controls', async () => {
  await fixture(async ({ root, config, skill }) => {
    for (const name of ['one', 'named', 'human', 'hidden']) await skill(name, '', 'Rules');
    await skill('mandatory-manual', 'disable-model-invocation: true', 'Manual only');
    config.skillOverrides = { named: 'name-only', human: 'user-invocable-only', hidden: 'off' }; config.skillModes = { 'mandatory-manual': 'auto' };
    const platform = await loadPlatform(root, config);
    expect(skillCatalog(platform.skills).split('\n').sort()).toEqual(['- named', '- one: one workflow']);
    expect(platform.skills.filter(userInvocableSkill).map((skill) => skill.name)).toEqual(expect.arrayContaining(['one', 'named', 'human', 'mandatory-manual']));
    expect(platform.skills.some((skill) => skill.name === 'hidden' || skill.path.startsWith('bundled:'))).toBe(false);
    expect(platform.skills.find((skill) => skill.name === 'mandatory-manual')?.mode).toBe('manual');
    config.skillOverrides = { one: 'invalid' as any }; expect(() => validateConfig(config)).toThrow('skillOverrides');
  });
});

test('Skills panel Space cycles visibility and Escape saves the four-state settings patch', () => {
  const panel: SkillsDialogState = { type: 'skills', selected: 0, expanded: false, skills: [{ name: 'review', source: 'project', path: 'SKILL.md', instructions: 'Review', description: 'Review', visibility: 'on' }] };
  navigateSkills(panel, 'space'); expect(panel.pendingOverrides?.review).toBe('name-only');
  expect(navigateSkills(panel, 'escape')).toBe('save');
  expect(skillSettingsPatch(panel, [], {}, { other: 'off' }).skillOverrides).toEqual({ other: 'off', review: 'name-only' });
  navigateSkills(panel, 'space'); expect(panel.pendingOverrides?.review).toBe('user-invocable-only');
  navigateSkills(panel, 'space'); expect(panel.pendingOverrides?.review).toBe('off');
  navigateSkills(panel, 'space'); expect(panel.pendingOverrides?.review).toBe('on');
});

test('inline Skill preserves multi-turn session and its tool ceiling expires on the next ordinary human turn', async () => {
  await fixture(async ({ root, config, requests, skill }) => {
    await skill('explain', 'disable-model-invocation: true\nallowed-tools: Read', 'EXPLICIT-INLINE $ARGUMENTS');
    const lead = await spawnAgent({ goal: 'Remember blue architect', cwd: root, config, background: false, isolation: 'none' });
    const invoked = await invokeUserSkill({ name: 'explain', args: 'the layout', cwd: root, config, agentId: lead.id });
    expect(invoked.forked).toBe(false); expect(invoked.agent.id).toBe(lead.id); expect(invoked.agent.sessionId).toBe(lead.sessionId);
    expect(requests[1].messages.some((m: any) => m.content === 'Remember blue architect')).toBe(true);
    expect(requests[1].messages[0].content).toContain('EXPLICIT-INLINE the layout'); expect(requests[1].tools.map((t: any) => t.function.name)).toEqual(['read_file']);
    await continueAgent(lead.id, 'Now write a test', { config });
    expect(requests[2].messages[0].content).not.toContain('EXPLICIT-INLINE'); expect(requests[2].tools.some((t: any) => t.function.name === 'write_file')).toBe(true);
    expect((await loadSession(lead.sessionId)).messages.length).toBe(6);
  });
});

test('fork Skill uses independent specialist context and inherited capability ceiling without replacing lead state', async () => {
  await fixture(async ({ root, config, requests, skill }) => {
    await skill('investigate', 'context: fork\nagent: reviewer\nallowed-tools: Read Write', 'FORK-RULE $0');
    config.agentDefinitions = { reviewer: { description: 'Review', prompt: 'SPECIALIST', tools: ['read_file', 'write_file'], permissionMode: 'bypass', model: 'inherit', maxTurns: 99 } };
    const lead = await spawnAgent({ goal: 'LEAD-PRIVATE-HISTORY', cwd: root, config, allowedTools: ['read_file'], background: false, isolation: 'none' });
    const before = await loadSession(lead.sessionId);
    const result = await invokeUserSkill({ name: 'investigate', args: 'code', cwd: root, config, agentId: lead.id });
    expect(result.forked).toBe(true); expect(result.agent.parentId).toBe(lead.id); expect(result.agent.sessionId).not.toBe(lead.sessionId);
    expect(result.agent.teamSessionId).toBe(lead.sessionId); expect(requests[1].tools.map((t: any) => t.function.name)).toEqual(['read_file']);
    expect(JSON.stringify(requests[1])).not.toContain('LEAD-PRIVATE-HISTORY'); expect(requests[1].messages[0].content).toContain('SPECIALIST');
    expect((await loadSession(lead.sessionId)).messages).toEqual(before.messages);
    expect(agentPermissionMode('restricted', 'bypass')).toBe('restricted'); expect(agentPermissionMode('sandbox', 'normal')).toBe('sandbox');
  });
});

test('dynamic Skill activation narrows tools immediately, including later calls in the same batch', async () => {
  await fixture(async ({ root, config, requests, skill }) => {
    await skill('read-only', 'allowed-tools: Read', 'Read only.');
    const lead = await spawnAgent({ goal: 'Inspect safely', cwd: root, config, background: false, isolation: 'none' });
    expect(lead.status).toBe('completed'); expect(requests[1].tools.map((t: any) => t.function.name)).toEqual(['read_file']);
    expect(requests[1].messages.find((m: any) => m.tool_call_id === 'write').content).toContain('not enabled');
    await expect(access(join(root, 'escape.txt'))).rejects.toThrow();
  }, (_, n) => n === 1 ? reply('', [tool('activate', 'skill', { skill: 'read-only' }), tool('write', 'write_file', { path: 'escape.txt', content: 'bad' })]) : reply());
});

test('model-invoked fork Skill runs a real specialist and returns its result without replacing the lead', async () => {
  let leadQueries = 0;
  await fixture(async ({ root, config, requests, skill }) => {
    config.agentDefinitions = { reviewer: { description: 'Review', prompt: 'FORK-SPECIALIST', tools: ['read_file'] } };
    await skill('investigate', 'context: fork\nagent: reviewer\nallowed-tools: Read', 'INSPECT $0');
    const lead = await spawnAgent({ goal: 'Delegate investigation', cwd: root, config, background: false, isolation: 'none' });
    expect(lead.status).toBe('completed');
    const child = (await listAgents()).find((agent) => agent.parentId === lead.id)!; expect(child.status).toBe('completed');
    expect(requests[1].messages[0].content).toContain('INSPECT code'); expect(requests[1].tools.map((t: any) => t.function.name)).toEqual(['read_file']);
    expect(requests[2].messages.find((message: any) => message.tool_call_id === 'fork').content).toContain('SPECIALIST-RESULT');
    await skill('unknown-profile', 'context: fork\nagent: missing', 'Fail closed');
    await expect(invokeUserSkill({ name: 'unknown-profile', cwd: root, config, agentId: lead.id })).rejects.toThrow('Unknown Skill Agent');
  }, (body) => {
    if (body.messages[0].content.includes('FORK-SPECIALIST')) return reply('SPECIALIST-RESULT');
    return ++leadQueries === 1 ? reply('', [tool('fork', 'skill', { skill: 'investigate', args: 'code' })]) : reply();
  });
});

test('Agent memory tool writes engineering knowledge, returns results, and read-only Plan rejects updates', async () => {
  await fixture(async ({ root, config, requests }) => {
    config.agentDefinitions = { tester: { description: 'Test', prompt: 'Tester', memory: 'project', tools: ['agent_memory'] } };
    const agent = await spawnAgent({ goal: 'Remember testing conventions', role: 'tester', cwd: root, config, background: false, isolation: 'none' });
    expect(agent.status).toBe('completed'); expect(await readAgentMemory(agentMemoryDirectory(root, { name: 'tester', memory: 'project' }))).toBe('ISOLATED-TESTS');
    expect(requests[1].messages.find((message: any) => message.tool_call_id === 'remember').content).not.toContain('Error');
    await continueAgent(agent.id, 'Read-only research', { config, planMode: true });
    expect(requests[3].messages.find((message: any) => message.tool_call_id === 'denied').content).toContain('Plan');
    expect(await readAgentMemory(agentMemoryDirectory(root, { name: 'tester', memory: 'project' }))).toBe('ISOLATED-TESTS');
  }, (_, n) => n === 1 ? reply('', [tool('remember', 'agent_memory', { action: 'write', key: 'MEMORY', value: 'ISOLATED-TESTS' })]) : n === 3 ? reply('', [tool('denied', 'agent_memory', { action: 'write', key: 'MEMORY', value: 'UNAPPROVED' })]) : reply());
});

test('disk Agent JSON and Markdown share validation, including memory scope, permission and maxTurns', async () => {
  await fixture(async ({ config }) => {
    const directory = config.agentsDirectories[0]!; await mkdir(directory, { recursive: true });
    await writeJson(join(directory, 'bad.json'), { name: 'bad', description: 'bad', prompt: 'bad', tools: 'ALL', maxTurns: -1 });
    await writeFile(join(directory, 'bad-md.md'), '---\nname: bad-md\ndescription: bad\npermissionMode: surprise\n---\nBody');
    await writeFile(join(directory, 'good.md'), '---\nname: good\ndescription: Good\nmemory: project\nmodel: inherit\ntools:\n  - Read\nbackground: false\nmaxTurns: 4\n---\nGood');
    const loaded = await loadAgentsFromDirectories([directory]); expect(loaded.errors).toHaveLength(2); expect(loaded.agents[0]?.memory).toBe('project'); expect(loaded.agents[0]?.tools).toEqual(['read_file']);
  });
});

test('specialist memory is workspace-qualified, bounded, path-safe, and preloaded in subsequent Agent requests', async () => {
  await fixture(async ({ root, config, requests }) => {
    config.agentDefinitions = { tester: { description: 'Test', prompt: 'Testing specialist', memory: 'project' } };
    const profile = { name: 'tester', memory: 'project' as const }; const directory = agentMemoryDirectory(root, profile);
    await writeAgentMemory(directory, 'MEMORY', 'TEST-PATTERN\nUse isolated fixtures.'); expect(await listAgentMemory(directory)).toEqual(['MEMORY']); expect(await readAgentMemory(directory)).toContain('TEST-PATTERN');
    expect(agentMemoryDirectory(root, { name: 'tester', memory: 'user' })).not.toBe(agentMemoryDirectory(join(root, 'second'), { name: 'tester', memory: 'user' }));
    expect(agentMemoryDirectory(root, { name: 'tester', memory: 'local' })).toContain('agent-memory-local');
    await expect(writeAgentMemory(directory, '../secret', 'bad')).rejects.toThrow('simple name'); await expect(writeAgentMemory(directory, 'big', 'x'.repeat(25001))).rejects.toThrow('25 KB');
    await expect(writeAgentMemory(directory, 'credentials', '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----')).rejects.toThrow();
    const agent = await spawnAgent({ goal: 'Write tests', role: 'tester', cwd: root, config, isolation: 'none', background: false }); expect(agent.status).toBe('completed'); expect(requests[0].messages[0].content).toContain('TEST-PATTERN');
  });
});

test('Plan submission pauses, persists complete tool-result boundaries and cannot self-approve or edit', async () => {
  await fixture(async ({ root, config, requests }) => {
    const lead = await spawnAgent({ goal: 'Plan a change', planMode: true, cwd: root, config, background: false, isolation: 'none' });
    expect(lead.status).toBe('waiting_for_input'); expect(lead.planMode).toBe(true); expect(lead.pendingPlanId).toBeTruthy();
    const plan = await loadProjectPlan(root, lead.pendingPlanId!); expect(plan.status).toBe('pending_approval');
    const session = await loadSession(lead.sessionId); const last = session.messages.at(-1)!.content as any[];
    expect(last.map((block) => block.tool_use_id)).toEqual(['plan', 'write']); expect(last[1].content).toContain('Not executed');
    await expect(continueAgent(lead.id, 'Execute', { config, planId: plan.id })).rejects.toThrow('approved');
    const revised = await continueAgent(lead.id, 'Research more', { config, planMode: false }); expect(revised.planMode).toBe(true); expect(requests[1].tools.some((t: any) => t.function.name === 'write_file')).toBe(false);
    const child = await spawnAgent({ goal: 'Research independently', cwd: root, config, parentId: lead.id, planMode: false, background: false, isolation: 'none' });
    expect(child.planMode).toBe(true); expect(requests[2].tools.some((t: any) => t.function.name === 'write_file')).toBe(false);
    await expect(access(join(root, 'no-approval.txt'))).rejects.toThrow();
    await transitionProjectPlan(root, plan.id, 'approved');
    const execution = await continueAgent(lead.id, 'Now execute approved plan', { config, planId: plan.id }); expect(execution.planMode).toBe(false); expect(requests[3].tools.some((t: any) => t.function.name === 'write_file')).toBe(true);
  }, (_, n) => n === 1 ? reply('', [tool('plan', 'exit_plan_mode', { plan: '# Safe Plan\n\n1. Inspect files\n2. Implement change\n3. Test it' }), tool('write', 'write_file', { path: 'no-approval.txt', content: 'bad' })]) : reply());
});

test('named Teams bind actual session membership, preserve unread inbox, block cross-team authorization and active cleanup', async () => {
  await fixture(async ({ root, state, config }) => {
    const lead = await spawnAgent({ goal: 'Lead task', cwd: root, config, background: false, isolation: 'none' });
    const child = await spawnAgent({ goal: 'Child task', cwd: root, config, parentId: lead.id, background: false, isolation: 'none' });
    const outsider = await spawnAgent({ goal: 'Other task', cwd: root, config, background: false, isolation: 'none' });
    const team = await createTeam('Engineering', lead.id); expect(team.teamSessionId).toBe(lead.sessionId); expect((await createTeam('Second label', lead.id)).id).toBe(team.id);
    await writeJson(join(state, 'teams', `${team.id}.orchestration.json`), { teamId: team.id }); expect(await listTeams()).toHaveLength(1);
    await expect(createTeam('Illegal', child.id)).rejects.toThrow('root lead');
    const broadcast = await broadcastTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: lead.id, content: 'Shared evidence, not authorization' }); expect(broadcast.delivered).toHaveLength(1); expect(broadcast.failed).toEqual([]);
    await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id, markRead: false }); expect(await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id, markRead: false })).toHaveLength(1);
    await expect(sendTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: outsider.id, content: 'bad' })).rejects.toThrow('outside team');
    await expect(sendTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: child.id, toAgentId: lead.id, kind: 'permission_response', content: 'approved' })).rejects.toThrow('cannot grant');
    await expect(requestTeamShutdown({ teamSessionId: lead.sessionId, fromAgentId: child.id, toAgentId: lead.id })).rejects.toThrow('root lead');
    child.status = 'waiting_for_input'; await saveAgent(child, true); await expect(deleteTeam(team.id)).rejects.toThrow('active Agent');
    await requestTeamShutdown({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: child.id }); expect((await loadAgent(child.id)).status).toBe('cancelled');
    expect((await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id, markRead: false })).some((message) => message.kind === 'shutdown_request')).toBe(false);
    expect((await continueAgent(child.id, 'Resume after human request', { config })).status).toBe('completed');
    await deleteTeam(team.id); expect(await listTeams()).toHaveLength(0); expect((await loadSession(child.sessionId)).messages.length).toBeGreaterThan(0);
  });
});

test('root lead shutdown cancels active model inference via the real worker controller and records an acknowledgement', async () => {
  let slow = false;
  await fixture(async ({ root, config, requests }) => {
    const lead = await spawnAgent({ goal: 'Lead task', cwd: root, config, background: false, isolation: 'none' }); slow = true;
    const running = spawnAgent({ goal: 'Long task', cwd: root, config, parentId: lead.id, background: false, isolation: 'none' });
    const deadline = Date.now() + 6000; let member: any;
    while (Date.now() < deadline) { member = (await listAgents()).find((agent) => agent.parentId === lead.id); if (member?.status === 'working' && requests.length > 1) break; await Bun.sleep(20); }
    expect(member?.status).toBe('working'); await requestTeamShutdown({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: member.id });
    const finished = await running; expect(finished.status).toBe('cancelled');
    expect((await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: lead.id, unreadOnly: false, markRead: false })).some((message) => message.content.includes('Shutdown acknowledged'))).toBe(true);
    slow = false; expect((await continueAgent(finished.id, 'Human explicitly resumes', { config })).status).toBe('completed');
  }, async () => { if (slow) await Bun.sleep(1500); return reply(); });
}, 20000);
