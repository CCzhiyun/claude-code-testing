import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureProjectClaudeInstructions, ensureProjectSettings, ensureUserClaudeInstructions, ensureUserSettings, isWorkspaceTrusted, projectSettingsPath, revokeWorkspaceTrust, trustWorkspace, userClaudeInstructionsPath, userSettingsPath } from '../src/workspaceTrust.js';
import { repositoryContext } from '../src/context.js';
import { defaultConfig, loadConfig } from '../src/config.js';

let root = '';
let workspace = '';
let previousHome: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccpt-workspace-trust-'));
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'home');
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.CCPT_HOME;
  else process.env.CCPT_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

describe('workspace entry initialization and trust', () => {
  test('initializes user and project settings without overwriting preferences', async () => {
    expect(await ensureUserSettings()).toBe(userSettingsPath());
    const initialized = JSON.parse(await Bun.file(userSettingsPath()).text());
    expect(initialized.settingsVersion).toBe(3);
    expect(initialized.env).toEqual({});
    expect(initialized.model).toBeUndefined();
    expect(JSON.stringify(initialized)).not.toContain('bigmodel');
    expect(initialized.shell).toBe('powershell');
    await Bun.write(userSettingsPath(), JSON.stringify({ settingsVersion: 3, model: { name: 'kept-model' } }));
    await ensureUserSettings();
    expect(JSON.parse(await Bun.file(userSettingsPath()).text()).model.name).toBe('kept-model');

    expect(await ensureProjectSettings(workspace)).toBe(projectSettingsPath(workspace));
    const project = JSON.parse(await Bun.file(projectSettingsPath(workspace)).text());
    expect(project.settingsVersion).toBe(3);
    expect(project.policy.workspaceRoots).toEqual([workspace]);
  });

  test('company Responses defaults survive repeated startup without injecting GLM aliases', async () => {
    await mkdir(dirname(userSettingsPath()), { recursive: true });
    const settings = JSON.stringify({ model: { provider: 'compatible', apiProtocol: 'responses', name: 'gpt-6-luna', endpointUrl: 'https://company.example/responses/v1/responses', apiKeyEnv: 'AZURE_OPENAI_API_KEY' }, marketplaceEnabled: false }, null, 2);
    await Bun.write(userSettingsPath(), settings);
    await ensureUserSettings(); await ensureUserSettings();
    expect(await Bun.file(userSettingsPath()).text()).toBe(settings);
    const effective = await loadConfig(workspace);
    expect(effective.model.name).toBe('gpt-6-luna');
    expect(effective.model.apiProtocol).toBe('responses');
    expect(effective.model.endpointUrl).toBe('https://company.example/responses/v1/responses');
  });

  test('creates and loads user-level and project-level CLAUDE.md instructions', async () => {
    const userInstructions = await ensureUserClaudeInstructions();
    expect(userInstructions).toBe(userClaudeInstructionsPath());
    expect(dirname(userInstructions)).toBe(dirname(userSettingsPath()));
    const projectInstructions = await ensureProjectClaudeInstructions(workspace);
    await mkdir(join(workspace, '.ccpt', 'rules'), { recursive: true });
    await Bun.write(join(workspace, '.ccpt', 'rules', 'verification.md'), '# Verification Rule\nAlways run workspace checks.');
    await Bun.write(userInstructions, '# User Instructions\nAlways explain risky operations.');
    await Bun.write(projectInstructions, '# Project Instructions\nRun the project verification command.');
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [workspace];
    const context = await repositoryContext(workspace, config);
    expect(context).toContain('## User CLAUDE.md');
    expect(context).toContain('Always explain risky operations.');
    expect(context).toContain('## CLAUDE.md');
    expect(context).toContain('Run the project verification command.');
    expect(context).toContain('## Project rule: .ccpt/rules/verification.md');
    expect(context).toContain('Always run workspace checks.');
  });

  test('persists and revokes a trust decision per absolute workspace', async () => {
    expect(await isWorkspaceTrusted(workspace)).toBe(false);
    await trustWorkspace(workspace);
    expect(await isWorkspaceTrusted(workspace)).toBe(true);
    await revokeWorkspaceTrust(workspace);
    expect(await isWorkspaceTrusted(workspace)).toBe(false);
  });
});
