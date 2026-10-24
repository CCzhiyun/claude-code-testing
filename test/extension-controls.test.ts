import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, validateConfig } from '../src/config.js';
import { enabledSkills, selectSkills, loadSkillsFromDirectories, type Skill } from '../src/skills.js';
import { discoverPlugins, computePluginDigest, installPlugin } from '../src/plugins.js';
import { loadPlatform } from '../src/platform.js';
import { getLimitedSkillToolCommands } from '../src/tools/SkillTool/prompt.js';
import { navigateSkills, skillSettingsPatch } from '../src/components/skillsManager.js';
import type { SkillsDialogState } from '../src/components/commandDialogs.js';

test('manual skills require explicit invocation and cannot escape via aliases', () => {
  const skills: Skill[] = ['review', 'team:review'].map((name) => ({ name, path: 'same/SKILL.md', description: '', instructions: 'rules', source: 'plugin' }));
  const active = enabledSkills(skills, [], { 'team:review': 'manual' });
  expect(selectSkills(active, 'review this code')).toHaveLength(0);
  expect(selectSkills(active, 'review', ['review'])).toHaveLength(1);
  expect(enabledSkills(skills, ['review'], { 'team:review': 'auto' })).toHaveLength(0);
  expect(enabledSkills(skills, [], { review: 'disabled', 'team:review': 'auto' })).toHaveLength(0);
});

test('manual frontmatter is respected by platform and model tool catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-manual-skill-'));
  await writeFile(join(root, 'review.md'), '---\nname: review\ndisable-model-invocation: true\n---\nReview the code.');
  expect((await loadSkillsFromDirectories([root])).skills[0]?.mode).toBe('manual');
  const config = structuredClone(defaultConfig); config.skillsDirectories = [root];
  expect((await loadPlatform(root, config)).skills.find((s) => s.name === 'review')?.mode).toBe('manual');
  expect((await getLimitedSkillToolCommands(root, config)).some((s) => s.name === 'review')).toBe(false);
});

test('UI stages and saves manual mode without changing unrelated skills', () => {
  const panel: SkillsDialogState = { type: 'skills', selected: 0, expanded: false, skills: [{ name: 'review', description: '', path: 'x', source: 'project', instructions: '', enabled: false }], pending: {} };
  navigateSkills(panel, 'm', 'm');
  expect(skillSettingsPatch(panel, ['review', 'other'], { another: 'manual' })).toEqual({ disabledSkills: ['other'], skillModes: { another: 'manual', review: 'manual' } });
  expect(navigateSkills(panel, 'r', 'r')).toBeUndefined();
});

test('external digest locks reject tampering before contributions are activated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-plugin-lock-'));
  const plugin = join(root, 'team'); await mkdir(plugin);
  await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ name: 'team', version: '1.0.0', contributes: { commands: [{ name: 'review', description: 'Review', prompt: 'Review code' }] } }));
  const config = structuredClone(defaultConfig); config.pluginDirectories = [root]; config.requirePluginLocks = true;
  expect((await discoverPlugins(config)).plugins).toHaveLength(0);
  config.pluginLocks = { team: { version: '1.0.0', digest: await computePluginDigest(plugin) } };
  expect((await discoverPlugins(config)).plugins).toHaveLength(1);
  await writeFile(join(plugin, 'extra.js'), 'tampered');
  const platform = await loadPlatform(root, config);
  expect(platform.plugins).toHaveLength(0);
  expect(platform.commands.some((c) => c.plugin === 'team')).toBe(false);
  expect(platform.diagnostics.some((d) => d.message.includes('SHA-256'))).toBe(true);
  await expect(installPlugin(plugin, root, '../escape')).rejects.toThrow('destination name');
});

test('invalid extension policy fails validation', () => {
  const config = structuredClone(defaultConfig);
  config.skillModes = { review: 'invalid' as 'auto' };
  expect(() => validateConfig(config)).toThrow('skillModes');
  delete config.skillModes; config.pluginLocks = { team: { version: '1.0.0', digest: 'abc' } };
  expect(() => validateConfig(config)).toThrow('pluginLocks');
});
