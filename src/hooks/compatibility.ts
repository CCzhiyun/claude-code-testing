export type HookCompatibilityFamily = 'notifications' | 'permissions' | 'input' | 'history' | 'timing' | 'terminal' | 'commands' | 'tools' | 'settings' | 'plugins' | 'skills' | 'tasks' | 'agents' | 'sessions' | 'ide' | 'remote' | 'voice' | 'data' | 'lifecycle';
const rules: ReadonlyArray<[HookCompatibilityFamily, RegExp]> = [
  ['notifications', /notifs|notification|banner|warning|hint/i], ['permissions', /permission|CanUseTool/i], ['input', /input|paste|typeahead|suggestion|copy|keybinding/i], ['history', /history/i], ['timing', /timeout|elapsed|minDisplay|doublePress|blink/i],
  ['terminal', /terminal|virtualScroll|Vim|exitOnCtrl/i], ['commands', /command/i], ['tools', /mergedTools|diff/i], ['settings', /setting|dynamicConfig/i], ['plugins', /plugin|marketplace/i], ['skills', /skill/i],
  ['tasks', /task|scheduled/i], ['agents', /swarm|teammate|mailbox|inbox|away|background/i], ['sessions', /session|assistantHistory|mainLoop/i], ['ide', /IDE|Ide|PrStatus|Lsp/i], ['remote', /remote|directConnect|SSH|teleport|replBridge/i], ['voice', /voice/i], ['data', /memory|logMessages|fileSuggestions|queueProcessor/i],
];
export function classifyHookReference(path: string): HookCompatibilityFamily { for (const [family, pattern] of rules) if (pattern.test(path)) return family; return 'lifecycle'; }
