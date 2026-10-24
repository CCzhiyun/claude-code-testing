import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, loadConfig, validateConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';

let root = '';
let previousHome: string | undefined;
let previousManaged: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccpt-config-'));
  previousHome = process.env.CCPT_HOME;
  previousManaged = process.env.CCPT_MANAGED_CONFIG;
  process.env.CCPT_HOME = join(root, 'home-state');
  process.env.CCPT_MANAGED_CONFIG = join(root, 'managed.json');
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  if (previousManaged === undefined) delete process.env.CCPT_MANAGED_CONFIG; else process.env.CCPT_MANAGED_CONFIG = previousManaged;
  await rm(root, { recursive: true, force: true });
});

describe('enterprise managed configuration', () => {
  test('applies managed policy after user and project settings', async () => {
    await writeJson(join(root, 'home-state', 'settings.json'), { policy: { mode: 'bypass', allowNetwork: true } });
    await writeJson(join(root, '.ccpt', 'settings.json'), { policy: { mode: 'normal', allowNetwork: true }, disabledPlugins: [] });
    await writeJson(join(root, 'managed.json'), { policy: { mode: 'restricted', allowNetwork: false }, agents: { maxConcurrent: 2 }, disabledPlugins: ['unapproved-pack'] });
    const config = await loadConfig(root);
    expect(config.policy.mode).toBe('restricted');
    expect(config.policy.allowNetwork).toBe(false);
    expect(config.agents.maxConcurrent).toBe(2);
    expect(config.disabledPlugins).toEqual(['unapproved-pack']);
    expect(config.policy.allowGitPush).toBe(false);
  });

  test('rejects invalid limits and network destinations before runtime', () => {
    const config = structuredClone(defaultConfig);
    config.agents.maxConcurrent = 0;
    expect(() => validateConfig(config)).toThrow('maxConcurrent');
    config.agents.maxConcurrent = 1;
    config.network.allowedHosts = ['https://not-a-host.example'];
    expect(() => validateConfig(config)).toThrow('Invalid allowed network host');
  });

  test('merges interactive UI preferences and validates model reasoning effort', async () => {
    delete process.env.CCPT_MANAGED_CONFIG;
    await writeJson(join(root, '.ccpt', 'settings.json'), { ui: { reduceMotion: true, showTips: false }, model: { reasoningEffort: 'max' } });
    const config = await loadConfig(root); expect(config.ui.reduceMotion).toBe(true); expect(config.ui.showTips).toBe(false); expect(config.ui.autoCompact).toBe(true); expect(config.model.reasoningEffort).toBe('max');
    const invalid = structuredClone(defaultConfig); invalid.model.reasoningEffort = 'invalid' as 'max'; expect(() => validateConfig(invalid)).toThrow('reasoningEffort');
    process.env.CCPT_MANAGED_CONFIG = join(root, 'managed.json');
  });

  test('maps Claude Code env, model aliases, permissions, context, and timeout into runtime configuration', async () => {
    delete process.env.CCPT_MANAGED_CONFIG;
    process.env.ANTHROPIC_AUTH_TOKEN = '';
    await writeJson(join(root, 'home-state', 'settings.json'), {
      settingsVersion: 3,
      env: {
        ANTHROPIC_AUTH_TOKEN: 'configured-test-token',
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-haiku',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-sonnet',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-opus',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
        API_TIMEOUT_MS: '3000000',
      },
      permissions: { allow: ['Bash(git status)'], deny: ['Bash(rm *)'] },
      model: 'opus', shell: 'powershell', autoUpdates: false, DISABLE_UPDATES: 1,
    });
    await writeJson(join(root, '.ccpt', 'settings.json'), { settingsVersion: 3, model: { provider: 'compatible', name: 'ccpt-model', baseUrl: 'http://127.0.0.1:11434/v1' } });
    try {
      const config = await loadConfig(root);
      expect(config.model.provider).toBe('anthropic');
      expect(config.model.name).toBe('glm-opus');
      expect(config.model.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
      expect(config.model.availableModels).toEqual(['glm-opus', 'glm-sonnet', 'glm-haiku']);
      expect(config.model.maxContextTokens).toBe(1_000_000);
      expect(config.network.timeoutMs).toBe(3_000_000);
      expect(config.policy.permissionRules.allow).toEqual(['Bash(git status)']);
      expect(config.policy.permissionRules.deny).toEqual(['Bash(rm *)']);
      expect((process.env as NodeJS.ProcessEnv).ANTHROPIC_AUTH_TOKEN).toBe('configured-test-token');
    } finally {
      await writeJson(join(root, 'home-state', 'settings.json'), { settingsVersion: 3 });
      await loadConfig(root);
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      process.env.CCPT_MANAGED_CONFIG = join(root, 'managed.json');
    }
  });
});
