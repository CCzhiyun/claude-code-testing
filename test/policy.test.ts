import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorizeCommand, protectPath } from '../src/policy.js';
import { defaultConfig } from '../src/config.js';
import { sanitizedEnvironment } from '../src/environment.js';
import { executeTool } from '../src/tooling.js';
import { repositoryContext } from '../src/context.js';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentic-policy-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, '.env'), 'TOP_SECRET=never-index-this\n');
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('enterprise policy', () => {
  test('permits workspace paths and blocks paths outside roots', () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    expect(protectPath(join(root, 'src'), config)).toBe(join(root, 'src'));
    expect(() => protectPath(tmpdir(), config)).toThrow('outside permitted workspace');
  });

  test('protects credential-like paths', () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    expect(() => protectPath(join(root, '.env'), config)).toThrow('Protected path');
  });

  test('enforces restricted and allowlist command modes', () => {
    const config = structuredClone(defaultConfig);
    expect(() => authorizeCommand('git', ['status'], config)).not.toThrow();
    expect(() => authorizeCommand('powershell', ['-Command', 'Get-ChildItem'], config)).toThrow('not allowlisted');
    config.policy.mode = 'restricted';
    expect(() => authorizeCommand('git', ['status'], config)).toThrow('disabled in restricted mode');
  });

  test('fails closed in sandbox mode without a process wrapper', () => {
    const config = structuredClone(defaultConfig);
    config.policy.mode = 'sandbox';
    expect(() => authorizeCommand('git', ['status'], config)).toThrow('requires an enterprise processWrapper');
    config.policy.processWrapper = 'enterprise-launcher';
    expect(() => authorizeCommand('git', ['status'], config)).not.toThrow();
  });

  test('blocks a symbolic-link escape from the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'agentic-outside-'));
    const link = join(root, 'linked-outside');
    await writeFile(join(outside, 'data.txt'), 'outside');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    expect(() => protectPath(join(link, 'data.txt'), config)).toThrow('outside permitted workspace');
    await rm(link, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test('removes credentials from tool and hook environments', () => {
    process.env.TEST_SECRET_TOKEN = 'must-not-leak';
    process.env.TEST_HARMLESS_VALUE = 'visible';
    const environment = sanitizedEnvironment('normal');
    expect(environment.TEST_SECRET_TOKEN).toBeUndefined();
    expect(environment.TEST_HARMLESS_VALUE).toBe('visible');
    delete process.env.TEST_SECRET_TOKEN;
    delete process.env.TEST_HARMLESS_VALUE;
  });

  test('uses an explicit environment allowlist in restricted modes', () => {
    process.env.TEST_HARMLESS_VALUE = 'not-implicitly-visible';
    process.env.TEST_EXPLICIT_VALUE = 'visible';
    const environment = sanitizedEnvironment('restricted', {}, ['TEST_EXPLICIT_VALUE']);
    expect(environment.TEST_HARMLESS_VALUE).toBeUndefined();
    expect(environment.TEST_EXPLICIT_VALUE).toBe('visible');
    delete process.env.TEST_HARMLESS_VALUE;
    delete process.env.TEST_EXPLICIT_VALUE;
  });

  test('excludes protected files from listing, search, reads, and repository context', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    const previousHome = process.env.CCPT_HOME;
    process.env.CCPT_HOME = join(root, 'state');
    const context = { cwd: root, agentId: 'agent_1234567890abcdef', sessionId: 'session_1234567890abcdef', depth: 0, config };
    try {
      const listed = await executeTool('list_files', {}, context, async () => 'unused');
      const searched = await executeTool('search_text', { query: 'never-index-this' }, context, async () => 'unused');
      expect(listed.content).not.toContain('.env');
      expect(searched.content).toBe('No matches');
      await expect(executeTool('read_file', { path: '.env' }, context, async () => 'unused')).rejects.toThrow('Protected path');
      expect(await repositoryContext(root, config)).not.toContain('.env');
    } finally {
      if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
    }
  });

  test('requires explicit policy grants for push and pull-request creation', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    const context = { cwd: root, agentId: 'agent_1234567890abcdef', sessionId: 'session_1234567890abcdef', depth: 0, config };
    await expect(executeTool('git_push', {}, context, async () => 'unused')).rejects.toThrow('Git push is disabled by policy');
    await expect(executeTool('create_draft_pr', { title: 'Test', body: 'Test' }, context, async () => 'unused')).rejects.toThrow('Pull request creation is disabled by policy');
  });
});
