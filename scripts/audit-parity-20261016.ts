// Behavioral gap audit, not a feature-completeness score. Loopback fixtures only.
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { loadConfig } from '../src/config.js';
import { repositoryContext } from '../src/context.js';
import { loadPlatform } from '../src/platform.js';
import { loadAgentsFromDirectories } from '../src/agents.js';
import { loadSkillsFromDirectories } from '../src/skills.js';
import { invokeUserSkill } from '../src/skillInvocation.js';
import { continueAgent } from '../src/agent.js';
import { loadSession } from '../src/sessions.js';
import { NATIVE_COMMANDS } from '../src/commands/catalog.js';
import { LOCAL_WORKFLOW_COMMANDS } from '../src/commands/localWorkflows.js';

const project = resolve(import.meta.dir, '..');
const output = join(project, '.ccpt/audit-20261016');
const root = await mkdtemp(join(tmpdir(), 'ccpt-parity-gaps-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid audit fixture root');
const home = join(root, 'home'), workspace = join(root, 'workspace');
for (const name of Object.keys(process.env)) if (/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CCPT_)/.test(name)) delete process.env[name];
process.env.CCPT_HOME = home;
const text = async (path: string, content: string): Promise<void> => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content); };
const findings: Array<{ id: string; status: 'gap-confirmed' | 'not-reproduced'; detail: string }> = [];
const finding = (id: string, missing: boolean, detail: string) => findings.push({ id, status: missing ? 'gap-confirmed' : 'not-reproduced', detail });
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  await mkdir(workspace, { recursive: true });
  await text(join(home, 'settings.json'), JSON.stringify({ model: { provider: 'openai', apiProtocol: 'responses', name: 'fixture', endpointUrl: 'http://127.0.0.1:9/responses' }, marketplaceEnabled: false, disableBundledSkills: true, network: { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true }, agents: { defaultIsolation: 'none', maxTurns: 3 } }));
  await text(join(home, 'skills/global-audit/SKILL.md'), '---\nname: global-audit\ndescription: Synthetic global skill\n---\nGLOBAL_SKILL_MARKER');
  await text(join(home, 'agents/global-reviewer.md'), '---\nname: global-reviewer\ndescription: Synthetic global agent\n---\nRead synthetic files only.');
  await text(join(home, 'rules/global.md'), 'GLOBAL_RULE_MARKER');
  await text(join(workspace, '.ccpt/rules/api-only.md'), '---\npaths:\n  - "src/api/**/*.ts"\n---\nPATH_SCOPED_RULE_MARKER');
  let config = await loadConfig(workspace);
  const context = await repositoryContext(workspace, config);
  finding('RULE-01', context.includes('PATH_SCOPED_RULE_MARKER') && context.includes('paths:'), 'Path-scoped rule and its frontmatter are injected at startup before any matching file is accessed.');
  finding('RULE-02', !context.includes('GLOBAL_RULE_MARKER'), 'User-level rules directory is not loaded by repositoryContext.');
  const platform = await loadPlatform(workspace, config);
  finding('SCOPE-01', !platform.skills.some(s => s.name === 'global-audit'), 'User-level skills are not discovered by the default registry.');
  finding('SCOPE-02', !platform.agents.some(a => a.name === 'global-reviewer'), 'User-level agents are not discovered by the default registry.');

  const agentRoot = join(workspace, '.ccpt/agents');
  await text(join(agentRoot, 'nested/reviewer.md'), '---\nname: nested-reviewer\ndescription: Nested synthetic agent\n---\nRead fixture only.');
  const nested = await loadAgentsFromDirectories([agentRoot]);
  finding('AGENT-01', !nested.agents.some(a => a.name === 'nested-reviewer'), 'Recursive arbitrary Markdown agent files are not discovered; the loader expects AGENT.md for a subdirectory.');
  await text(join(agentRoot, 'planner.md'), '---\nname: planner\ndescription: Read-only planner\npermissionMode: plan\n---\nResearch only.');
  const planned = await loadAgentsFromDirectories([agentRoot]);
  finding('AGENT-02', !planned.agents.some(a => a.name === 'planner') && planned.errors.some(e => e.includes('permissionMode')), 'permissionMode: plan in an agent definition is rejected rather than translated into the runtime Plan constraint.');
  await text(join(agentRoot, 'advanced.md'), '---\nname: advanced\ndescription: Synthetic advanced fields\neffort: low\nomitClaudeMd: true\nautoCompactWindow: 100000\ninitialPrompt: First task\n---\nRead fixture only.');
  const advanced = (await loadAgentsFromDirectories([agentRoot])).agents.find(a => a.name === 'advanced') as unknown as Record<string, unknown>;
  finding('AGENT-03', !!advanced && ['effort', 'omitClaudeMd', 'autoCompactWindow', 'initialPrompt'].every(k => !(k in advanced)), 'These advanced fields are silently dropped from Markdown definitions.');

  const skillRoot = join(workspace, '.ccpt/skills');
  await text(join(skillRoot, 'scoped/SKILL.md'), '---\nname: scoped\ndescription: Synthetic scoped restriction\npaths:\n  - "src/api/**/*.ts"\ndisallowed-tools: Write\n---\nDo not execute; metadata fixture only.');
  const scoped = (await loadSkillsFromDirectories([skillRoot])).skills.find(s => s.name === 'scoped') as unknown as Record<string, unknown>;
  finding('SKILL-01', !!scoped && !('disallowedTools' in scoped) && !('disallowed-tools' in scoped), 'Skill disallowed-tools is ignored; no deny ceiling is propagated from that field.');
  finding('SKILL-02', !!scoped && !('paths' in scoped), 'Skill paths metadata is ignored instead of gating automatic discovery/activation.');

  const requests: any[] = [];
  server = Bun.serve({ port: 0, async fetch(req) { requests.push(await req.json()); return Response.json({ id: `resp_audit_${requests.length}`, object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'AUDIT_REPLY' }] }], usage: { input_tokens: 10, output_tokens: 2 } }); } });
  await text(join(skillRoot, 'sticky/SKILL.md'), '---\nname: sticky\ndescription: Explicit synthetic lifecycle test\ndisable-model-invocation: true\nallowed-tools: Read\n---\nSTICKY_SKILL_BODY_MARKER. Keep this convention throughout the task.');
  config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`;
  let agent = (await invokeUserSkill({ name: 'sticky', args: 'First synthetic task', cwd: workspace, config })).agent;
  agent = await continueAgent(agent.id, 'Continue the synthetic task without invoking a new skill.', { config });
  const persisted = await loadSession(agent.sessionId);
  const initiallyPresent = String(requests[0]?.instructions ?? '').includes('STICKY_SKILL_BODY_MARKER');
  const nextCarriesBody = JSON.stringify(requests[1]).includes('STICKY_SKILL_BODY_MARKER');
  finding('SKILL-03', initiallyPresent && !nextCarriesBody && !JSON.stringify(persisted.messages).includes('STICKY_SKILL_BODY_MARKER'), 'Inline skill body exists only in the first request system prompt, not in persisted history or the next ordinary turn. Tool ceilings correctly expire separately.');

  const tui = await readFile(join(project, 'src/tui.ts'), 'utf8');
  const workflowNames = new Set(LOCAL_WORKFLOW_COMMANDS.map(command => command.name));
  const tests = await readdir(join(project, 'test'));
  const testContents = await Promise.all(tests.filter(name => name.endsWith('.test.ts')).map(async file => ({ file, source: await readFile(join(project, 'test', file), 'utf8') })));
  const mentionsCommand = (source: string, name: string): boolean => new RegExp("(?:^|[\\s'\"`])" + name + "(?=$|[\\s'\"`\\\\])").test(source);
  const commands = NATIVE_COMMANDS.map(command => ({ ...command,
    routeEvidence: tui.includes(`case '${command.name}'`) ? 'explicit-tui-case' : workflowNames.has(command.name) ? 'local-workflow' : 'requires-manual-review',
    // A literal occurrence links a test file; it is NOT proof that every interaction branch was exercised.
    staticTestReferences: testContents.filter(test => mentionsCommand(test.source, command.name)).map(test => test.file),
    individualEndToEndParity: 'not-claimed',
  }));
  const report = { date: '2026-10-16', reference: '2.1.301', application: '0.51.0', network: 'loopback only',
    checks: findings.length, confirmedGaps: findings.filter(f => f.status === 'gap-confirmed').length,
    findings, nativeCommandCount: commands.length, commands };
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'parity-findings.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'command-audit.md'), '# Native command audit (static references, not individual E2E certification)\n\n| Command | Route evidence | Linked test files |\n| --- | --- | --- |\n' + commands.map(c => `| ${c.name} | ${c.routeEvidence} | ${c.staticTestReferences.join(', ') || 'none'} |`).join('\n') + '\n');
  console.log(JSON.stringify({ ...report, commands: undefined }, null, 2));
} finally {
  server?.stop(true);
  await rm(root, { recursive: true, force: true });
}
