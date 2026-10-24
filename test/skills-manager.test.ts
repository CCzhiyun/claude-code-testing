import { describe, expect, test } from 'bun:test';
import { defaultConfig, validateConfig } from '../src/config.js';
import { enabledSkills, selectSkills, type Skill } from '../src/skills.js';
import { navigateSkills, renderSkillsManager, skillEnabled, skillManagerItems, skillSettingsPatch } from '../src/components/skillsManager.js';
import { permissionDialogEntries, renderPermissionsDialog, type SkillsDialogState, type PermissionsDialogState } from '../src/components/commandDialogs.js';
import { stripAnsi } from '../src/tui/presentation.js';
import { stringWidth } from '../src/ink/stringWidth.js';

const state = (): SkillsDialogState => ({ type: 'skills', selected: 0, expanded: false, query: '', pending: {}, skills: [
  { name: 'z-review', description: 'Review code', source: 'project', path: 'z/SKILL.md', instructions: 'Review carefully.', enabled: true },
  { name: 'a-test', description: 'Test code', source: 'plugin', path: 'a/SKILL.md', instructions: 'Test carefully.', enabled: true, locked: true },
] });

describe('Skill management and permission search', () => {
  test('searches before toggling, stages changes and preserves unrelated disabled settings', () => {
    const panel = state();
    navigateSkills(panel, '', '/'); navigateSkills(panel, '', 'review');
    expect(skillManagerItems(panel).map((skill) => skill.name)).toEqual(['z-review']);
    navigateSkills(panel, 'return');
    expect(panel.pending).toEqual({});
    navigateSkills(panel, 'space', ' ');
    expect(skillEnabled(panel, skillManagerItems(panel)[0]!)).toBe(false);
    expect(panel.skills[0]?.enabled).toBe(true);
    expect(navigateSkills(panel, 'return')).toBe('save');
    expect(skillSettingsPatch(panel, ['unavailable-skill'])).toEqual({ disabledSkills: ['unavailable-skill', 'z-review'] });
    expect(navigateSkills(panel, 'escape')).toBe('close');
  });

  test('plugin-owned definitions cannot be individually toggled; refresh cannot discard pending changes', () => {
    const panel = state();
    navigateSkills(panel, 'space', ' ');
    expect(panel.pending).toEqual({});
    expect(panel.status).toContain('/plugin');
    navigateSkills(panel, 'down'); navigateSkills(panel, 'space', ' ');
    expect(navigateSkills(panel, '', 'r')).toBeUndefined();
    expect(panel.status).toContain('pending');
    navigateSkills(panel, '', 't'); expect(panel.sort).toBe('source');
    navigateSkills(panel, '', 'v'); expect(panel.expanded).toBe(true);
    navigateSkills(panel, 'escape'); expect(panel.expanded).toBe(false);
  });

  test('disabled definitions cannot be selected through a plugin alias or explicit request', () => {
    const skills: Skill[] = [
      { name: 'review', description: 'Review', source: 'plugin', path: 'same/SKILL.md', instructions: 'Rules' },
      { name: 'team:review', description: 'Review', source: 'plugin', path: 'same/SKILL.md', instructions: 'Rules' },
      { name: 'test', description: 'Test', source: 'project', path: 'other/SKILL.md', instructions: 'Rules' },
    ];
    const active = enabledSkills(skills, ['TEAM:REVIEW']);
    expect(active.map((skill) => skill.name)).toEqual(['test']);
    expect(selectSkills(active, 'review code', ['review'])).toHaveLength(0);
    const config = structuredClone(defaultConfig); config.disabledSkills = [''];
    expect(() => validateConfig(config)).toThrow('disabledSkills');
  });

  test('skill and permission long lists keep selected items visible within terminal width', () => {
    const panel = state();
    panel.skills = Array.from({ length: 30 }, (_, index) => ({ ...panel.skills[0]!, name: `skill-${String(index).padStart(2, '0')}` }));
    navigateSkills(panel, 'end');
    const skillScreen = renderSkillsManager(panel, 70, 24);
    expect(stripAnsi(skillScreen.join('\n'))).toContain('skill-29');
    expect(skillScreen.every((line) => stringWidth(line) <= 70)).toBe(true);
    const config = structuredClone(defaultConfig);
    config.policy.permissionRules.allow = Array.from({ length: 30 }, (_, index) => `Read(file-${index})`);
    const permissions: PermissionsDialogState = { type: 'permissions', tab: 'Allow', selected: 29, adding: false, input: '' };
    expect(stripAnsi(renderPermissionsDialog(config, permissions, 70, 24).join('\n'))).toContain('file-29');
    permissions.query = 'file-29'; permissions.selected = 0;
    expect(permissionDialogEntries(config, permissions)).toEqual([{ value: 'Read(file-29)', index: 29 }]);
    permissions.query = 'missing';
    expect(permissionDialogEntries(config, permissions)).toEqual([]);
  });
});
