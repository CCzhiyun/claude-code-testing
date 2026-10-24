import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, loadConfig } from '../src/config.js';
import { loadPlatform } from '../src/platform.js';
import { computePluginDigest, loadPluginAt } from '../src/plugins.js';
import { createAgentScaffold, createMcpScaffold, createPluginScaffold, createSkillScaffold, initializePlatform, installFoundationPlugin } from '../src/scaffold.js';
import { inspectMcpServer } from '../src/mcp.js';
import { listProjectPlans, projectPlansDirectory, saveProjectPlan } from '../src/plans.js';
import { writeJson } from '../src/storage.js';

let workspace = '';

beforeAll(async () => { workspace = await mkdtemp(join(tmpdir(), 'ccpt-platform-')); });
afterAll(async () => { await rm(workspace, { recursive: true, force: true }); });

describe.serial('extension platform registry', () => {
  test('uses the trusted workspace as the complete extension and plan boundary', async () => {
    const project = join(workspace, 'trusted-workspace-skills');
    const state = join(workspace, 'user-skill-state');
    await mkdir(join(state, 'skills', 'workspace-review'), { recursive: true });
    await writeFile(join(state, 'skills', 'workspace-review', 'SKILL.md'), '---\nname: workspace-review\ndescription: User fallback.\n---\nUse the user fallback.\n');
    await mkdir(join(state, 'agents-definitions'), { recursive: true });
    await writeFile(join(state, 'agents-definitions', 'global-agent.md'), '---\nname: global-agent\ndescription: Must not cross workspace boundaries.\n---\nNever load this agent.\n');
    await mkdir(join(state, 'plugins', 'global-plugin'), { recursive: true });
    await writeFile(join(state, 'plugins', 'global-plugin', 'plugin.json'), JSON.stringify({ schemaVersion: 1, name: 'global-plugin', version: '1.0.0', contributes: {} }));
    await writeJson(join(state, 'settings.json'), {
      skillsDirectories: [join(state, 'skills')],
      agentsDirectories: [join(state, 'agents-definitions')],
      pluginDirectories: [join(state, 'plugins')],
    });
    const previous = process.env.CCPT_HOME;
    process.env.CCPT_HOME = state;
    try {
      const skillPath = await createSkillScaffold(project, 'workspace-review');
      const agentPath = await createAgentScaffold(project, 'workspace-reviewer');
      await writeJson(join(project, '.ccpt', 'agents', 'agent_0123456789abcdef.json'), { id: 'agent_0123456789abcdef', goal: 'Runtime task record', status: 'failed' });
      expect(skillPath).toBe(join(project, '.ccpt', 'skills', 'workspace-review', 'SKILL.md'));
      expect(agentPath).toBe(join(project, '.ccpt', 'agents', 'workspace-reviewer', 'AGENT.md'));
      await expect(access(join(project, '.claude'))).rejects.toThrow();
      // Explicit global roots now require user approval instead of being silently
      // ignored. Removing the unapproved selections restores workspace-only loading.
      await expect(loadPlatform(project)).rejects.toThrow('directory is not approved');
      await writeJson(join(state, 'settings.json'), {});
      const platform = await loadPlatform(project);
      const skill = platform.skills.find((item) => item.name === 'workspace-review');
      expect(skill?.source).toBe('project');
      expect(skill?.path).toBe(skillPath);
      expect(platform.skills.some((item) => item.path.startsWith(join(state, 'skills')))).toBe(false);
      expect(platform.agents.map((item) => item.name)).toEqual(['workspace-reviewer']);
      expect(platform.diagnostics.some((item) => item.source.includes('agent_0123456789abcdef.json'))).toBe(false);
      expect(platform.agents[0]?.source).toBe('project');
      expect(platform.plugins).toHaveLength(0);
      expect(platform.config.skillsDirectories.some((path) => path.startsWith(state))).toBe(false);
      expect(platform.config.agentsDirectories.some((path) => path.startsWith(state))).toBe(false);
      expect(platform.config.pluginDirectories.some((path) => path.startsWith(state))).toBe(false);
      expect(platform.diagnostics.some((item) => item.component === 'skill' && item.message.includes('shadowed'))).toBe(false);
      const planPath = await saveProjectPlan(project, '# Plan\n\n1. Inspect\n2. Implement\n3. Verify', 'workspace review');
      expect(planPath.startsWith(projectPlansDirectory(project))).toBe(true);
      expect(await listProjectPlans(project)).toContain(planPath.split(/[\\/]/).at(-1)!);
      await writeJson(join(project, '.ccpt', 'settings.json'), { skillsDirectories: ['../outside'] });
      await expect(loadConfig(project)).rejects.toThrow('must stay inside the trusted workspace');
    } finally {
      if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous;
    }
  });

  test('loads and namespaces plugin contributions into the runtime', async () => {
    const pluginRoot = join(workspace, 'extensions', 'quality-pack');
    await mkdir(join(pluginRoot, 'skills', 'review'), { recursive: true });
    await mkdir(join(pluginRoot, 'agents', 'reviewer'), { recursive: true });
    await writeFile(join(pluginRoot, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review code quality.\n---\n\nVerify the diff.\n');
    await writeFile(join(pluginRoot, 'agents', 'reviewer', 'AGENT.md'), '---\nname: reviewer\ndescription: Independent reviewer.\ntools: [read_file, search_text]\nskills: [review]\nmaxTurns: 7\n---\n\nReview without modifying files.\n');
    await writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
      schemaVersion: 1,
      name: 'quality-pack',
      version: '1.0.0',
      contributes: {
        skills: ['./skills'],
        agents: ['./agents'],
        commands: [{ name: 'quality', description: 'Run quality review', prompt: 'Review {args}', agent: 'reviewer', skills: ['review'] }],
        hooks: [{ event: 'TaskCompleted', command: 'node scripts/report.mjs' }],
        mcpServers: { knowledge: { transport: 'stdio', command: 'node', args: ['mcp/server.mjs'] } },
      },
    }));
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [workspace];
    config.pluginDirectories = [join(workspace, 'extensions')];
    const platform = await loadPlatform(workspace, config);
    expect(platform.skills.map((item) => item.name)).toContain('quality-pack:review');
    expect(platform.agents.map((item) => item.name)).toContain('quality-pack:reviewer');
    expect(platform.agents.find((item) => item.name === 'quality-pack:reviewer')?.skills).toEqual(['quality-pack:review']);
    expect(platform.commands[0]?.name).toBe('/quality');
    expect(platform.commands[0]?.agent).toBe('quality-pack:reviewer');
    expect(platform.config.mcpServers['quality-pack.knowledge']?.cwd).toBe(pluginRoot);
    expect(platform.config.hooks).toHaveLength(1);
  });

  test('rejects contribution paths that escape a plugin', async () => {
    const root = join(workspace, 'invalid-plugin');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'plugin.json'), JSON.stringify({ schemaVersion: 1, name: 'invalid-pack', version: '1.0.0', contributes: { skills: ['../outside'] } }));
    await expect(loadPluginAt(root)).rejects.toThrow('escapes its root');
  });

  test('verifies plugin integrity and supports centrally disabled plugins', async () => {
    const extensionRoot = join(workspace, 'integrity-extensions');
    const root = join(extensionRoot, 'signed-pack');
    await mkdir(join(root, 'skills', 'sample'), { recursive: true });
    await writeFile(join(root, 'skills', 'sample', 'SKILL.md'), '---\nname: sample\ndescription: Sample skill.\n---\nUse it.\n');
    const manifest = { schemaVersion: 1, name: 'signed-pack', version: '1.0.0', contributes: { skills: ['./skills'] } };
    await writeFile(join(root, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const digest = await computePluginDigest(root);
    await writeFile(join(root, 'plugin.json'), `${JSON.stringify({ ...manifest, integrity: { algorithm: 'sha256', digest } }, null, 2)}\n`);
    expect((await loadPluginAt(root)).name).toBe('signed-pack');
    await writeFile(join(root, 'skills', 'sample', 'SKILL.md'), 'tampered');
    await expect(loadPluginAt(root)).rejects.toThrow('integrity check failed');
    delete (manifest as { integrity?: unknown }).integrity;
    await writeFile(join(root, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const config = structuredClone(defaultConfig);
    config.pluginDirectories = [extensionRoot];
    config.disabledPlugins = ['signed-pack'];
    expect((await loadPlatform(workspace, config)).plugins).toHaveLength(0);
  });

  test('generated team plugin and MCP server are immediately usable', async () => {
    const project = join(workspace, 'generated');
    await mkdir(project, { recursive: true });
    await initializePlatform(project);
    await createPluginScaffold(project, 'team-kit');
    const platform = await loadPlatform(project);
    expect(platform.plugins.some((item) => item.name === 'team-kit')).toBe(true);
    expect(platform.commands.some((item) => item.name === '/team-review')).toBe(true);
    await createMcpScaffold(project, 'sample-tools');
    const config = await loadConfig(project);
    const server = config.mcpServers['sample-tools'];
    expect(server).toBeDefined();
    const result = await inspectMcpServer('sample-tools', server!, config);
    expect(JSON.stringify(result)).toContain('echo');
  });

  test('installs editable foundation engineering workflows', async () => {
    const project = join(workspace, 'foundation');
    await mkdir(project, { recursive: true });
    await installFoundationPlugin(project);
    const platform = await loadPlatform(project);
    expect(platform.commands.map((item) => item.name)).toEqual(expect.arrayContaining(['/review', '/security-review', '/verify', '/debug', '/simplify', '/run', '/batch']));
    expect(platform.agents.map((item) => item.name)).toContain('ccpt-foundation:reviewer');
    expect(platform.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  });
});
