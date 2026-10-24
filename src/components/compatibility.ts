export type ComponentCompatibilityFamily = 'permissions' | 'messages' | 'agents' | 'prompt' | 'design-system' | 'mcp' | 'tasks' | 'selection' | 'feedback' | 'core';
const rules: ReadonlyArray<[ComponentCompatibilityFamily, RegExp]> = [
  ['permissions', /permission|approval|trust/i], ['messages', /message|transcript|conversation/i], ['agents', /agent|teammate|buddy/i],
  ['prompt', /prompt|input|composer/i], ['design-system', /design-system|logo|theme|color|text|box/i], ['mcp', /mcp|server/i],
  ['tasks', /task|todo|progress/i], ['selection', /select|picker|menu|list/i], ['feedback', /spinner|loading|status|error|warning|dialog|modal|toast/i],
];
export function classifyComponentReference(path: string): ComponentCompatibilityFamily { for (const [family, pattern] of rules) if (pattern.test(path)) return family; return 'core'; }
