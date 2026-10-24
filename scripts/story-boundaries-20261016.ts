// Executable acceptance contracts, not a production completeness claim.
// All files/models are synthetic and scoped to an owned temporary workspace.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { deepStrictEqual, ok, equal } from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { emitKeypressEvents, type Key } from 'node:readline';
import { loadUserBindings } from '../src/keybindings/loadUserBindings.js';
import { expandSkillInstructions, applySkillModes, applySkillVisibility, modelInvocableSkill, userInvocableSkill, skillCatalog, loadSkillsFromDirectories, skillToolNames, type Skill } from '../src/skills.js';
import { parseMarkdownDocument } from '../src/frontmatter.js';
import { validateAgentDefinition, agentPermissionMode, loadAgentsFromDirectories } from '../src/agents.js';
import { navigateSkills, renderSkillsManager, skillSettingsPatch, skillManagerItems } from '../src/components/skillsManager.js';
import type { SkillsDialogState } from '../src/components/commandDialogs.js';
import { stringWidth } from '../src/ink/stringWidth.js';
import { createProjectPlan, transitionProjectPlan, reviseProjectPlan, loadProjectPlan, type ProjectPlanStatus } from '../src/plans.js';
import { defaultConfig } from '../src/config.js';
import { spawnAgent, saveAgent, loadAgent, continueAgent } from '../src/agent.js';
import { createTeam, deleteTeam } from '../src/teamStore.js';
import { sendTeamMessage, readTeamMailbox, requestTeamShutdown, broadcastTeamMessage } from '../src/mailbox.js';
import { invokeUserSkill } from '../src/skillInvocation.js';
import { agentMemoryDirectory, writeAgentMemory, readAgentMemory } from '../src/agentMemory.js';
import { loadSession } from '../src/sessions.js';
import { repositoryContext } from '../src/context.js';

const project = resolve(import.meta.dir, '..');
const output = join(project, '.ccpt/story-fixes-20261016/evidence');
const root = await mkdtemp(join(tmpdir(), 'ccpt-story-boundary-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid temporary root');
for (const key of Object.keys(process.env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(key)) delete process.env[key];
process.env.CCPT_HOME = join(root, 'home');
process.env.CCPT_API_KEY = 'synthetic-boundary-key';
type Result = { id: string; area: string; contract: string; status: 'pass' | 'fail'; ms: number; error?: string };
const results: Result[] = [];
async function check(id: string, area: string, contract: string, run: () => unknown | Promise<unknown>) {
  const start = performance.now();
  try { await run(); results.push({ id, area, contract, status: 'pass', ms: Math.round(performance.now() - start) }); }
  catch (error) { results.push({ id, area, contract, status: 'fail', ms: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) }); }
}
async function rejects(run: () => unknown | Promise<unknown>, pattern?: RegExp) {
  let caught: unknown; try { await run(); } catch (e) { caught = e; }
  ok(caught, 'Expected rejection, but operation succeeded');
  if (pattern) ok(pattern.test(String(caught)), `Unexpected error: ${String(caught)}`);
}
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };
const skill: Skill = { name: 'fixture', path: join(root, 'SKILL.md'), description: 'Synthetic skill', source: 'project', instructions: '$0|$ARGUMENTS[1]|$ARGUMENTS' };
const panel = (count: number): SkillsDialogState => ({ type: 'skills', selected: 0, expanded: false, skills: Array.from({ length: count }, (_, i) => ({ ...skill, name: `skill-${String(i).padStart(3, '0')}`, instructions: '中文 e\u0301 👩‍💻\n'.repeat(20), visibility: 'on' })) });
const requests: any[] = [];
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const body = await request.json() as any; requests.push(body);
  return Response.json({ id: `resp_boundary_${requests.length}`, object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'SYNTHETIC_OK' }] }], usage: { input_tokens: 20, output_tokens: 2 } });
} });
try {
  const argumentCases: Array<[string, string, string]> = [
    // Current official Skills contract: missing indexed placeholders remain literal.
    ['empty', '', '$0|$ARGUMENTS[1]|'], ['one', 'one', 'one|$ARGUMENTS[1]|one'], ['two', 'one two', 'one|two|one two'],
    ['double-quoted', '"one path" two', 'one path|two|"one path" two'],
    ['single-quoted', "'one path' two", "one path|two|'one path' two"],
    ['empty-quoted', '"" next', '|next|"" next'], ['unicode', '"中文 参数" 😀', '中文 参数|😀|"中文 参数" 😀'],
    ['combining', 'e\u0301 👩‍💻', 'e\u0301|👩‍💻|e\u0301 👩‍💻'], ['spaces', '  one   two ', 'one|two|  one   two '],
    ['shell-literal', '$(SHOULD_NOT_RUN); `literal`', '$(SHOULD_NOT_RUN);|`literal`|$(SHOULD_NOT_RUN); `literal`'],
  ];
  for (const [id, args, expected] of argumentCases) await check(`SK-ARGS-${id}`, 'skills-arguments', 'Literal positional substitution without shell evaluation', () => equal(expandSkillInstructions(skill, args), expected));
  for (const count of [0, 1, 2, 63, 64, 65, 1000]) await check(`SK-ARGS-count-${count}`, 'skills-arguments', 'First/last/out-of-range positions remain deterministic', () => {
    const args = Array.from({ length: count }, (_, i) => `p${i}`).join(' ');
    equal(expandSkillInstructions({ ...skill, instructions: `$0/$ARGUMENTS[${Math.max(0, count - 1)}]/$${count}` }, args), `${count ? 'p0' : '$0'}/${count ? `p${count - 1}` : '$ARGUMENTS[0]'}/$${count}`);
  });
  for (const size of [64, 65, 10_000, 100_000]) await check(`SK-ARGS-size-${size}`, 'skills-arguments', 'Large Unicode argument remains intact', () => equal(expandSkillInstructions({ ...skill, instructions: '$ARGUMENTS' }, '中'.repeat(size)).length, size));
  await check('SK-ARGS-no-placeholder', 'skills-arguments', 'Arguments appended when no placeholder exists', () => equal(expandSkillInstructions({ ...skill, instructions: 'Body' }, 'x'), 'Body\n\nARGUMENTS: x'));

  const visibilities = ['on', 'name-only', 'user-invocable-only', 'off'] as const;
  for (const manual of [false, true]) for (const user of [false, true]) for (const visibility of visibilities) {
    await check(`SK-POLICY-${manual}-${user}-${visibility}`, 'skills-policy', 'User settings never relax author invocation restrictions', () => {
      const s = applySkillVisibility([{ ...skill, disableModelInvocation: manual, userInvocable: user }], { fixture: visibility })[0]!;
      equal(modelInvocableSkill(s), !manual && !['off', 'user-invocable-only'].includes(visibility));
      equal(userInvocableSkill(s), user && visibility !== 'off');
      equal(skillCatalog([s]).includes('Synthetic skill'), modelInvocableSkill(s) && visibility !== 'name-only');
    });
  }
  const modes = ['auto', 'manual', 'disabled'] as const;
  for (const a of modes) for (const b of modes) await check(`SK-ALIAS-MODE-${a}-${b}`, 'skills-policy', 'Canonical-file aliases use most restrictive mode', () => {
    const items = applySkillModes([skill, { ...skill, name: 'alias' }], [], { fixture: a, ALIAS: b });
    const expected = modes[Math.max(modes.indexOf(a), modes.indexOf(b))]; ok(items.every(s => s.mode === expected));
  });
  for (const a of visibilities) for (const b of visibilities) await check(`SK-ALIAS-VIS-${a}-${b}`, 'skills-policy', 'Canonical-file aliases cannot bypass visibility', () => ok(applySkillVisibility([skill, { ...skill, name: 'alias' }], { fixture: a, ALIAS: b }).every(s => s.visibility === visibilities[Math.max(visibilities.indexOf(a), visibilities.indexOf(b))])));
  for (const bad of ['Bash(git *)', '../Read', 'Read;Write', 'Read\u0000', '$(id)', '*']) await check(`SK-TOOL-${JSON.stringify(bad)}`, 'skills-policy', 'Tool metadata rejects pattern/executable names', () => rejects(() => skillToolNames([bad])));

  const skillDir = join(root, 'definitions/skills');
  let file = 0;
  async function loadSkillText(text: string) { const path = join(skillDir, `fixture-${file++}.md`); await put(path, text); return loadSkillsFromDirectories([path]); }
  for (const name of ['x', 'a'.repeat(64), 'a'.repeat(65), '-bad', '../escape', '中文', 'a:b', 'a_b.c-d']) await check(`SK-NAME-${name.length}-${file}`, 'skills-definition', 'Definition name obeys the 1..64 safe-character contract', async () => {
    const result = await loadSkillText(`---\nname: ${name}\n---\nBody`); equal(result.skills.length, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name) ? 1 : 0);
  });
  for (const key of ['disable-model-invocation', 'user-invocable']) for (const value of ['true', 'false', '"false"', '0', 'null', '[true]']) await check(`SK-BOOL-${key}-${value}`, 'skills-definition', 'Invocation flags accept booleans only', async () => equal((await loadSkillText(`---\n${key}: ${value}\n---\nBody`)).skills.length, ['true', 'false'].includes(value) ? 1 : 0));
  for (const key of ['__proto__', 'constructor', 'prototype']) await check(`YAML-UNSAFE-${key}`, 'frontmatter', 'Reject prototype pollution keys', () => rejects(() => parseMarkdownDocument(`---\n${key}: x\n---\nBody`)));
  await check('YAML-nested', 'frontmatter', 'Reject unsupported nested frontmatter explicitly', () => rejects(() => parseMarkdownDocument('---\nnested:\n  secret: x\n---\nBody')));
  await check('YAML-crlf', 'frontmatter', 'CRLF has equivalent boolean semantics', () => equal(parseMarkdownDocument('---\r\nuser-invocable: false\r\n---\r\nBody').attributes['user-invocable'], false));
  await check('YAML-unterminated-fail-closed', 'frontmatter', 'Malformed header containing author restrictions must be rejected, not treated as unrestricted body', async () => equal((await loadSkillText('---\ndisable-model-invocation: true\nBody without terminator')).skills.length, 0));
  await check('YAML-duplicate-security-key', 'frontmatter', 'Duplicate author restriction keys must be diagnosed, not silently overwritten', async () => equal((await loadSkillText('---\ndisable-model-invocation: true\ndisable-model-invocation: false\n---\nBody')).skills.length, 0));
  await check('YAML-quoted-comma-list', 'frontmatter', 'A quoted comma stays inside one YAML list item', () => deepStrictEqual(parseMarkdownDocument('---\nitems: ["a,b", "c"]\n---\nBody').attributes.items, ['a,b', 'c']));
  await check('SK-empty-body', 'skills-definition', 'Empty instruction body is diagnosed', async () => equal((await loadSkillText('---\nname: empty\n---\n')).skills.length, 0));
  for (const field of ['disallowed-tools: Write', 'paths: [src/api/**]']) await check(`SK-unsupported-${field.split(':')[0]}`, 'skills-definition', 'Security-significant unsupported metadata is enforced or diagnosed', async () => {
    const result = await loadSkillText(`---\n${field}\n---\nBody`);
    ok(result.errors.length || result.skills.some(s => field.startsWith('paths') ? 'paths' in s : 'disallowedTools' in s), 'Accepted but silently dropped metadata');
  });

  for (const count of [0, 1, 2, 19, 100]) for (const key of ['up', 'down', 'pageup', 'pagedown', 'home', 'end']) await check(`UI-NAV-${count}-${key}`, 'skills-ui', 'Selection stays in bounds for empty/short/multi-page lists', () => {
    const state = panel(count); for (let i = 0; i < 30; i++) navigateSkills(state, key); ok(state.selected >= 0 && state.selected <= Math.max(0, count - 1));
    if (count) ok(renderSkillsManager(state, 80, 24).some(line => line.includes(state.skills[state.selected]!.name)), 'Selected row is visible');
  });
  for (const width of [0, 1, 8, 20, 40, 80]) for (const height of [1, 5, 10, 24]) await check(`UI-SIZE-${width}-${height}`, 'skills-ui', 'Rendering respects width/height even in very small terminals', () => {
    const lines = renderSkillsManager(panel(19), width, height); ok(lines.length <= height); ok(lines.every(line => stringWidth(line) <= width));
  });
  await check('UI-search-empty-enter', 'skills-ui', 'Enter from zero-match search never edits a hidden row', () => {
    const state = panel(19); state.query = '不存在😀'; state.searching = true; navigateSkills(state, 'return'); navigateSkills(state, 'space'); equal(skillManagerItems(state).length, 0); equal(state.pendingOverrides, undefined);
  });
  await check('UI-search-emoji-backspace', 'skills-ui', 'Backspace removes one complete emoji code point', () => { const state = panel(1); state.searching = true; state.query = 'a😀'; navigateSkills(state, 'backspace'); equal(state.query, 'a'); });
  await check('UI-search-grapheme-backspace', 'skills-ui', 'Backspace does not split a composed grapheme', () => { const state = panel(1); state.searching = true; state.query = 'a👩‍💻'; navigateSkills(state, 'backspace'); equal(state.query, 'a'); });
  await check('UI-lock', 'skills-ui', 'Plugin-locked row cannot change mode/visibility', () => { const state = panel(1); state.skills[0]!.locked = true; navigateSkills(state, 'space'); navigateSkills(state, '', 'm'); equal(state.pendingOverrides, undefined); equal(state.pendingModes, undefined); });
  await check('UI-preserve-unrelated-settings', 'skills-ui', 'Saving one override preserves unrelated rules', () => { const state = panel(1); navigateSkills(state, 'space'); equal(skillSettingsPatch(state, ['other'], { other: 'manual' }, { other: 'off' }).skillOverrides?.other, 'off'); });
  for (const [label, sequence, expected] of [['escape', '\u001b', 'chat:interrupt'], ['shift-tab', '\u001b[Z', 'permission:cycleMode'], ['ctrl-c', '\u0003', 'chat:interrupt']] as const) await check(`UI-RAW-${label}`, 'raw-terminal-keybindings', 'Default binding accepts actual readline key metadata rather than a hand-built key object', async () => {
    const input = new PassThrough(); emitKeypressEvents(input); const resolver = await loadUserBindings(root);
    const key = await new Promise<{ text: string; key: Key }>((resolveKey, rejectKey) => {
      const deadline = setTimeout(() => rejectKey(new Error('No keypress event received')), 2000);
      input.once('keypress', (text: string | undefined, key: Key) => { clearTimeout(deadline); resolveKey({ text: text ?? '', key }); }); input.write(sequence);
    });
    input.end(); const actual = resolver.resolve(key.text, key.key, ['Chat']);
    deepStrictEqual(actual, { type: 'match', action: expected }, `Raw key metadata: ${JSON.stringify(key.key)}`);
  });

  const agentBase = { name: 'fixture', description: 'Description', prompt: 'Prompt' };
  for (const maxTurns of [-1, 0, 1, 2, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) await check(`AG-TURNS-${String(maxTurns)}`, 'agent-definition', 'maxTurns is a positive safe integer', async () => {
    const valid = Number.isSafeInteger(maxTurns) && maxTurns > 0;
    if (valid) validateAgentDefinition({ ...agentBase, maxTurns }); else await rejects(() => validateAgentDefinition({ ...agentBase, maxTurns }));
  });
  const permissions = ['bypass', 'acceptEdits', 'normal', 'sandbox', 'restricted'] as const;
  for (const parent of permissions) for (const child of permissions) await check(`AG-PERM-${parent}-${child}`, 'agent-permissions', 'Child profile cannot promote parent privilege', () => equal(agentPermissionMode(parent, child), permissions[Math.max(permissions.indexOf(parent), permissions.indexOf(child))]));
  await check('AG-plan-mode', 'agent-definition', 'Documented Plan definition can be loaded safely', async () => {
    const path = join(root, 'agents/planner.md'); await put(path, '---\nname: planner\ndescription: Research\npermissionMode: plan\n---\nRead only'); equal((await loadAgentsFromDirectories([path])).agents.length, 1);
  });
  await check('AG-recursive-md', 'agent-definition', 'Markdown definitions in nested categories are discovered', async () => {
    const path = join(root, 'nested-agents'); await put(join(path, 'category/reviewer.md'), '---\nname: nested-reviewer\ndescription: Review\n---\nRead'); ok((await loadAgentsFromDirectories([path])).agents.some(a => a.name === 'nested-reviewer'));
  });

  const transitions: Record<ProjectPlanStatus, ProjectPlanStatus[]> = { drafting: ['pending_approval', 'cancelled'], pending_approval: ['approved', 'changes_requested', 'rejected', 'cancelled'], changes_requested: ['drafting', 'pending_approval', 'rejected', 'cancelled'], approved: ['executing', 'cancelled'], executing: ['blocked', 'completed', 'failed', 'cancelled'], blocked: ['executing', 'cancelled'], completed: [], failed: ['executing', 'cancelled'], rejected: ['drafting', 'cancelled'], cancelled: [] };
  const paths: Record<ProjectPlanStatus, ProjectPlanStatus[]> = { drafting: [], pending_approval: ['pending_approval'], changes_requested: ['pending_approval', 'changes_requested'], approved: ['pending_approval', 'approved'], executing: ['pending_approval', 'approved', 'executing'], blocked: ['pending_approval', 'approved', 'executing', 'blocked'], completed: ['pending_approval', 'approved', 'executing', 'completed'], failed: ['pending_approval', 'approved', 'executing', 'failed'], rejected: ['pending_approval', 'rejected'], cancelled: ['cancelled'] };
  const planCwd = join(root, 'plans-workspace');
  for (const from of Object.keys(transitions) as ProjectPlanStatus[]) for (const to of Object.keys(transitions) as ProjectPlanStatus[]) await check(`PL-TRANS-${from}-${to}`, 'plan-state', 'All persisted status pairs follow the declared state machine', async () => {
    const p = await createProjectPlan({ cwd: planCwd, request: 'Synthetic state test', content: '# Plan\n- [ ] Inspect', status: 'drafting' });
    for (const status of paths[from]) await transitionProjectPlan(planCwd, p.id, status);
    if (from === to || transitions[from].includes(to)) equal((await transitionProjectPlan(planCwd, p.id, to)).status, to);
    else { await rejects(() => transitionProjectPlan(planCwd, p.id, to), /Cannot transition/); equal((await loadProjectPlan(planCwd, p.id)).status, from); }
  });
  await check('PL-concurrent-stale-approval', 'plan-state', 'Only one concurrent approval using the same version succeeds', async () => {
    const p = await createProjectPlan({ cwd: planCwd, request: 'Race', content: '# Race' }); const actions = await Promise.allSettled([1, 2].map(() => transitionProjectPlan(planCwd, p.id, 'approved', { expectedVersion: p.version })));
    equal(actions.filter(a => a.status === 'fulfilled').length, 1); equal(actions.filter(a => a.status === 'rejected').length, 1);
  });
  for (const content of ['', ' ', '\n\t']) await check(`PL-EMPTY-${JSON.stringify(content)}`, 'plan-state', 'Empty plan cannot enter approval queue', () => rejects(() => createProjectPlan({ cwd: planCwd, request: 'Empty', content })));
  await check('PL-revise-approved', 'plan-state', 'Approved plan cannot be edited without a new approval lifecycle', async () => { const p = await createProjectPlan({ cwd: planCwd, request: 'Approved', content: '# Initial' }); await transitionProjectPlan(planCwd, p.id, 'approved'); await rejects(() => reviseProjectPlan(planCwd, p.id, '# Changed')); });

  const config = structuredClone(defaultConfig); const workspace = join(root, 'runtime'); await mkdir(workspace, { recursive: true });
  config.model = { ...config.model, provider: 'openai', apiProtocol: 'responses', responsesTransport: 'native', name: 'fixture', endpointUrl: `http://127.0.0.1:${server.port}/responses` };
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 8000 };
  config.policy.workspaceRoots = [workspace]; config.agents.defaultIsolation = 'none'; config.agents.maxTurns = 2; config.agents.maxPerSession = 20;
  config.pluginDirectories = []; config.skillsDirectories = [join(workspace, '.ccpt/skills')]; config.agentsDirectories = []; config.disableBundledSkills = true; config.hooks = [];
  const lead = await spawnAgent({ goal: 'Synthetic lead', cwd: workspace, config, background: false, isolation: 'none' });
  const child = await spawnAgent({ goal: 'Synthetic child', cwd: workspace, config, parentId: lead.id, background: false, isolation: 'none' });
  const outsider = await spawnAgent({ goal: 'Synthetic outsider', cwd: workspace, config, background: false, isolation: 'none' });
  const team = await createTeam('Synthetic team', lead.id);
  await check('TM-create-idempotent', 'teams', 'Repeated create on one root session returns the same registry', async () => equal((await createTeam('Other name', lead.id)).id, team.id));
  await check('TM-child-cannot-create', 'teams', 'A child cannot impersonate the root lead', () => rejects(() => createTeam('Illegal team', child.id)));
  for (const content of ['', ' ', '\n']) await check(`TM-empty-${JSON.stringify(content)}`, 'teams', 'Empty messages are rejected', () => rejects(() => sendTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: child.id, content })));
  await check('TM-cross-team', 'teams', 'Outsider mailbox cannot receive through another team', () => rejects(() => sendTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: outsider.id, content: 'not authorization' })));
  await check('TM-agent-permission-denied', 'teams', 'Agent messages cannot grant human authorization', () => rejects(() => sendTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: child.id, toAgentId: lead.id, kind: 'permission_response', content: 'approved' })));
  for (const size of [1, 100_000, 100_001]) await check(`TM-size-${size}`, 'teams', 'Message length is bounded to 100000 code units', async () => equal((await sendTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: child.id, content: '中'.repeat(size) })).content.length, Math.min(size, 100_000)));
  await check('TM-unread-peek', 'teams', 'Peeking does not consume unread messages', async () => { const a = await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id, markRead: false }); const b = await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id, markRead: false }); equal(a.length, b.length); ok(a.length >= 3); });
  await check('TM-mark-read', 'teams', 'Read acknowledgement is durable and repeated read is empty', async () => { await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id }); equal((await readTeamMailbox({ teamSessionId: lead.sessionId, agentId: child.id })).length, 0); });
  await check('TM-broadcast', 'teams', 'Broadcast reaches members, not the sender or outsider', async () => { const r = await broadcastTeamMessage({ teamSessionId: lead.sessionId, fromAgentId: lead.id, content: 'evidence' }); deepStrictEqual(r.delivered.map(m => m.toAgentId), [child.id]); equal(r.failed.length, 0); });
  for (const status of ['queued', 'working', 'waiting_for_input'] as const) await check(`TM-active-cleanup-${status}`, 'teams', 'Active/waiting members prevent destructive registry cleanup', async () => { const member = await loadAgent(child.id); member.status = status; await saveAgent(member, true); await rejects(() => deleteTeam(team.id)); });
  await check('TM-child-shutdown-denied', 'teams', 'A child cannot shut down its lead', () => rejects(() => requestTeamShutdown({ teamSessionId: lead.sessionId, fromAgentId: child.id, toAgentId: lead.id })));
  await check('TM-idle-shutdown-resume', 'teams', 'Shutdown preserves history and explicit human continuation works', async () => { const member = await loadAgent(child.id); member.status = 'waiting_for_input'; await saveAgent(member, true); await requestTeamShutdown({ teamSessionId: lead.sessionId, fromAgentId: lead.id, toAgentId: child.id }); equal((await loadAgent(child.id)).status, 'cancelled'); equal((await continueAgent(child.id, 'Explicit fixture operator resume', { config })).status, 'completed'); ok((await loadSession(child.sessionId)).messages.length > 0); });
  await check('TM-cleanup-preserves-history', 'teams', 'Cleaning inactive registry leaves conversations intact', async () => { await deleteTeam(team.id); ok((await loadSession(child.sessionId)).messages.length > 0); });

  await put(join(config.skillsDirectories[0]!, 'sticky/SKILL.md'), '---\nname: sticky\ndescription: Explicit lifecycle fixture\ndisable-model-invocation: true\nallowed-tools: Read\n---\nSTORY_BOUNDARY_STICKY. Retain throughout conversation.');
  await check('SK-inline-body-next-turn', 'skills-runtime', 'Inline body survives next ordinary turn while tool ceiling expires separately', async () => {
    const n = requests.length; const result = await invokeUserSkill({ name: 'sticky', args: 'First fixture', cwd: workspace, config, agentId: lead.id }); await continueAgent(result.agent.id, 'Continue without a new Skill', { config });
    ok(JSON.stringify(requests[n]).includes('STORY_BOUNDARY_STICKY')); ok(JSON.stringify(requests[n + 1]).includes('STORY_BOUNDARY_STICKY'), 'Second request dropped Skill body');
  });
  await check('SK-inline-ceiling-expires', 'skills-runtime', 'One-turn read-only ceiling expires without granting permanent permissions', () => { const last = requests.at(-1); ok(last.tools.some((t: any) => t.name === 'write_file')); });
  await check('RL-scoped-before-read', 'rules', 'Path-scoped rule is not injected before accessing a matching file', async () => { await put(join(workspace, '.ccpt/rules/api-only.md'), '---\npaths: [src/api/**/*.ts]\n---\nBOUNDARY_API_RULE'); ok(!(await repositoryContext(workspace, config)).includes('BOUNDARY_API_RULE')); });
  for (const size of [24_999, 25_000, 25_001]) await check(`MEMORY-bytes-${size}`, 'agent-memory', 'Memory enforces the exact 25KB UTF-8 byte boundary', async () => { const directory = agentMemoryDirectory(workspace, { name: 'reviewer', memory: 'project' }); if (size <= 25_000) { await writeAgentMemory(directory, 'MEMORY', 'x'.repeat(size)); equal((await readAgentMemory(directory)).length, size); } else await rejects(() => writeAgentMemory(directory, 'MEMORY', 'x'.repeat(size))); });
  for (const key of ['../escape', 'a/b', 'a'.repeat(65), '', 'x\u0000']) await check(`MEMORY-key-${JSON.stringify(key)}`, 'agent-memory', 'Memory keys cannot traverse directories', () => rejects(() => writeAgentMemory(join(root, 'memory'), key, 'engineering convention')));

  const failures = results.filter(r => r.status === 'fail');
  const report = { date: '2026-10-16', scope: 'CCPT public functions + synthetic loopback runtime; not reference binary or company deployment', total: results.length, passed: results.length - failures.length, failed: failures.length, modelRequests: requests.length, results };
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'boundary-results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'boundary-results.md'), '# Boundary acceptance results\n\n' + `Total ${report.total}; pass ${report.passed}; fail ${report.failed}. Failures are preserved acceptance gaps, not passing assertions.\n\n` + '| ID | Area | Result | Contract / error |\n| --- | --- | --- | --- |\n' + results.map(r => `| ${r.id.replaceAll('|', '\\|')} | ${r.area} | ${r.status} | ${(r.contract + (r.error ? ': ' + r.error : '')).replaceAll('|', '\\|').replaceAll('\n', ' ')} |`).join('\n') + '\n');
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
