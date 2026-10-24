import type { SkillsDialogItem, SkillsDialogState } from './commandDialogs.js';
import { truncateTerminal, tuiTheme } from '../tui/presentation.js';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function skillManagerItems(state: SkillsDialogState): SkillsDialogItem[] {
  const query = (state.query ?? '').toLowerCase().trim();
  return state.skills.filter((skill) => !query || `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query))
    .sort((a, b) => (state.sort === 'source' ? a.source.localeCompare(b.source) : 0) || a.name.localeCompare(b.name));
}

export function skillEnabled(state: SkillsDialogState, skill: SkillsDialogItem): boolean {
  return state.pending?.[skill.name] ?? skill.enabled ?? true;
}

export function skillSettingsPatch(state: SkillsDialogState, current: string[] = [], modes: Record<string, 'auto' | 'manual' | 'disabled'> = {}, overrides: Record<string, import('../skills.js').SkillVisibility> = {}): { disabledSkills: string[]; skillModes?: typeof modes; skillOverrides?: typeof overrides } {
  const disabled = new Map(current.map((name) => [name.toLowerCase(), name]));
  for (const skill of state.skills) {
    if (skill.locked || skill.disableModelInvocation || state.pending?.[skill.name] === undefined) continue;
    if (state.pending[skill.name]) disabled.delete(skill.name.toLowerCase());
    else disabled.set(skill.name.toLowerCase(), skill.name);
  }
  const updates = { ...modes };
  for (const skill of state.skills) {
    if (skill.locked || skill.disableModelInvocation) continue;
    const mode = state.pendingModes?.[skill.name];
    if (mode) { for (const key of Object.keys(updates)) if (key.toLowerCase() === skill.name.toLowerCase()) delete updates[key]; updates[skill.name] = mode; }
    if (state.pending?.[skill.name] === true) { disabled.delete(skill.name.toLowerCase()); if (updates[skill.name] === 'disabled') updates[skill.name] = 'auto'; }
  }
  const visibilityUpdates = { ...overrides };
  for (const [name, mode] of Object.entries(state.pendingOverrides ?? {})) {
    if (state.skills.find((skill) => skill.name === name)?.locked || state.skills.find((skill) => skill.name === name)?.disableModelInvocation) continue;
    for (const key of Object.keys(visibilityUpdates)) if (key.toLowerCase() === name.toLowerCase()) delete visibilityUpdates[key];
    visibilityUpdates[name] = mode;
  }
  return { disabledSkills: [...disabled.values()].sort(), ...(Object.keys(updates).length ? { skillModes: updates } : {}), ...(Object.keys(visibilityUpdates).length ? { skillOverrides: visibilityUpdates } : {}) };
}

export function navigateSkills(state: SkillsDialogState, key: string, text = '', ctrl = false): 'close' | 'save' | 'refresh' | undefined {
  const items = skillManagerItems(state);
  const selected = items[state.selected];
  if (key === 'escape') {
    if (state.expanded) { state.expanded = false; state.detailScroll = 0; }
    else if (state.searching) { if (state.query) { state.query = ''; state.selected = 0; } else state.searching = false; }
    else return Object.keys(state.pendingOverrides ?? {}).length ? 'save' : 'close';
    return;
  }
  if (state.expanded) {
    if (key === 'return' || key === 'enter') { state.expanded = false; state.detailScroll = 0; }
    else if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key)) {
      const maximum = Math.max(0, (selected?.instructions ?? '').split('\n').length - 1);
      const delta = key === 'up' ? -1 : key === 'pageup' ? -8 : key === 'pagedown' ? 8 : 1;
      state.detailScroll = key === 'home' ? 0 : key === 'end' ? maximum : Math.max(0, Math.min(maximum, (state.detailScroll ?? 0) + delta));
    }
    return;
  }
  if (state.searching) {
    if (['return', 'enter', 'down'].includes(key)) state.searching = false;
    else if (key === 'backspace') { state.query = [...graphemes.segment(state.query ?? '')].slice(0, -1).map(part => part.segment).join(''); state.selected = 0; }
    else if (!ctrl && text && !/[\u0000-\u001f\u007f]/.test(text)) { state.query = (state.query ?? '') + text; state.selected = 0; }
    return;
  }
  if (ctrl && key === 'r' || text === 'r') {
    if (Object.keys(state.pending ?? {}).length || Object.keys(state.pendingModes ?? {}).length || Object.keys(state.pendingOverrides ?? {}).length) state.status = 'Save or cancel pending changes before refreshing.';
    else return 'refresh';
  } else if (text === '/') { state.searching = true; }
  else if (text === 't') { state.sort = state.sort === 'source' ? 'name' : 'source'; state.selected = 0; }
  else if (text === 'v' && selected) { state.expanded = true; state.detailScroll = 0; }
  else if (text === 'm' && selected && !selected.locked && !selected.disableModelInvocation) {
    state.pendingModes ??= {}; state.pending ??= {};
    state.pendingModes[selected.name] = (state.pendingModes[selected.name] ?? selected.mode) === 'manual' ? 'auto' : 'manual';
    state.pending[selected.name] = true;
  }
  else if (['return', 'enter'].includes(key)) return 'save';
  else if ((key === 'space' || text === ' ') && selected) {
    if (selected.disableModelInvocation) state.status = 'Locked by author: user-only. The author disabled automatic model invocation.';
    else if (selected.locked) state.status = 'This Skill is managed by its plugin. Use /plugin to manage it.';
    else if (selected.visibility !== undefined) {
      const cycle = ['on', 'name-only', 'user-invocable-only', 'off'] as const;
      state.pendingOverrides ??= {}; state.pending ??= {};
      const next = cycle[(cycle.indexOf(state.pendingOverrides[selected.name] ?? selected.visibility) + 1) % cycle.length]!;
      state.pendingOverrides[selected.name] = next; state.pending[selected.name] = next !== 'off'; delete state.status;
    } else { state.pending ??= {}; state.pending[selected.name] = !skillEnabled(state, selected); delete state.status; }
  } else if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key)) {
    const maximum = Math.max(0, items.length - 1);
    const delta = key === 'up' ? -1 : key === 'pageup' ? -8 : key === 'pagedown' ? 8 : 1;
    state.selected = key === 'home' ? 0 : key === 'end' ? maximum : Math.max(0, Math.min(maximum, state.selected + delta));
  }
}

export function renderSkillsManager(state: SkillsDialogState, width: number, height: number): string[] {
  const items = skillManagerItems(state);
  const selected = items[state.selected];
  const lines = [`${tuiTheme.bold}Skills${tuiTheme.reset}`, `${state.skills.length} definitions · sort: ${state.sort ?? 'name'}`, `⌕ ${state.query || 'Search skills…'}${state.searching ? ' [typing]' : ''}`, ''];
  const room = Math.max(1, height - 11);
  if (!state.skills.length) lines.push('No skills found', 'Create a project Skill at:', state.workspaceDirectory ?? '.ccpt/skills/<name>/SKILL.md', 'Only the current trusted workspace is scanned automatically.');
  else if (!items.length) lines.push('No skills match this search.');
  else if (state.expanded && selected) {
    lines.push(selected.name, selected.description, selected.path);
    lines.push(...selected.instructions.split('\n').slice(state.detailScroll ?? 0, (state.detailScroll ?? 0) + Math.max(1, room - 2)));
  } else {
    const start = Math.max(0, state.selected - room + 1);
    for (let index = start; index < Math.min(items.length, start + room); index++) {
      const skill = items[index]!;
      const enabled = skillEnabled(state, skill);
      const mode = skill.visibility !== undefined ? state.pendingOverrides?.[skill.name] ?? skill.visibility : enabled ? state.pendingModes?.[skill.name] ?? (skill.mode === 'manual' ? 'manual' : 'auto') : 'disabled';
      lines.push(`${index === state.selected ? '>' : ' '} ${skill.disableModelInvocation ? '[author]' : skill.locked ? '[locked]' : '        '} ${skill.disableModelInvocation ? 'user-only' : mode} [${skill.source}] ${skill.name} · ~${Math.ceil(skill.instructions.length / 4)} tok`);
    }
    if (selected) lines.push(selected.description, `${selected.context ?? 'inline'} · ${selected.userInvocable === false ? 'model-only' : 'slash enabled'}${selected.argumentHint ? ` · ${selected.argumentHint}` : ''}`, selected.path);
  }
  if (state.status) lines.push(state.status);
  lines.push('', state.expanded ? '↑/↓ scroll · Enter/Esc back' : state.searching ? 'Type to search · Enter select · Esc clear/back' : 'Space cycle visibility · Enter save · / search · t sort · v view', 'm auto/manual · r to refresh · Esc to close (saves visibility changes)');
  return lines.slice(0, height).map((line) => truncateTerminal(line, width));
}
