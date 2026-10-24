export type CommandCompatibilityFamily = 'core' | 'agents' | 'session' | 'configuration' | 'integration' | 'workspace' | 'account';

const families: ReadonlyArray<[CommandCompatibilityFamily, RegExp]> = [
  ['agents', /agent|task|team|worktree|plan|background|branch/i],
  ['session', /session|resume|rename|compact|clear|context|memory|rewind|checkpoint|export/i],
  ['configuration', /config|permission|model|output-style|rate-limit|privacy|status|usage|doctor/i],
  ['integration', /mcp|plugin|hook|ide|github|remote|skill/i],
  ['workspace', /add-dir|diff|init|review|release|security/i],
  ['account', /login|logout|account|billing|extra-usage/i],
];

export function classifyCommandReference(path: string): CommandCompatibilityFamily {
  for (const [family, pattern] of families) if (pattern.test(path)) return family;
  return 'core';
}
