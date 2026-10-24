export type NativeCommandCategory = 'session' | 'agent' | 'workspace' | 'configuration' | 'integration' | 'interface';

export interface NativeCommandDefinition {
  name: `/${string}`;
  description: string;
  category: NativeCommandCategory;
  argument?: string;
  aliases?: readonly `/${string}`[];
}

const command = (name: `/${string}`, description: string, category: NativeCommandCategory, argument?: string, aliases?: readonly `/${string}`[]): NativeCommandDefinition => ({
  name, description, category, ...(argument ? { argument } : {}), ...(aliases?.length ? { aliases } : {}),
});

export const NATIVE_COMMANDS: readonly NativeCommandDefinition[] = [
  command('/advisor', 'Analyze the project and recommend the safest next action', 'workspace', '[request]'),
  command('/add-dir', 'Add a permitted working directory', 'workspace', '<path>'),
  command('/agent', 'List or run a specialized Agent', 'agent', '[name] [goal]'),
  command('/artifacts', 'List governed engineering artifacts', 'workspace'),
  command('/agents', 'Inspect, attach, stop, clean or recover Agent work', 'agent', '[attach|wait|cancel|merge|cleanup|recovery-list] [id]'),
  command('/background', 'Start a background agent', 'agent', '<goal>'),
  command('/brief', 'Produce a concise engineering brief', 'workspace', '[request]'),
  command('/brainstorm', 'Discuss requirements and compare designs without editing code', 'workspace', '[request]', ['/brainstorming']),
  command('/questions', 'Reopen the active question or permission picker', 'session'),
  command('/resolve-conflict','Review and explicitly choose ours/theirs/working/deletion with retained backups','workspace','<path>'),
  command('/undo-conflict','Review and restore exact original conflict bytes; blocks newer edits/staging/HEAD changes','workspace','<conflict_ID>'),
  command('/branch', 'Fork and switch conversation without sending a prompt', 'session', '[name]', ['/fork']),
  command('/clear', 'Start fresh; optionally name the conversation being left', 'session', '[name]', ['/new', '/reset']),
  command('/checkpoint', 'Create or list recoverable code checkpoints', 'session', '[list|file ...]'),
  command('/color', 'Select terminal colors or accessibility mode', 'interface', '[name]'),
  command('/commit', 'Prepare a focused commit from current changes', 'workspace', '[message guidance]'),
  command('/commit-push-pr', 'Validate, commit, push and prepare a pull request', 'workspace', '[request]'),
  command('/compact', 'Compact the active conversation context', 'session'),
  command('/config', 'Open the interactive settings dashboard', 'configuration'),
  command('/context', 'Show active session context usage', 'session'),
  command('/channels', 'List authenticated event channels', 'integration'),
  command('/coordinator', 'Enable or disable coordinator-only orchestration', 'agent', '[on|off]'),
  command('/copy', 'Copy the latest response to the terminal clipboard', 'interface'),
  command('/cost', 'Open context and persistent usage statistics', 'session'),
  command('/diff', 'Show the current Git diff summary', 'workspace'),
  command('/doctor', 'Run diagnostics or export a redacted local bundle', 'configuration', '[export filename]'),
  command('/wakeups', 'Inspect or cancel persistent scheduled wakeups', 'session', '[cancel id]'),
  command('/endpoint', 'Show or set the model API endpoint', 'configuration', '[url]'),
  command('/endpoint-url', 'Show or set a complete model request URL', 'configuration', '[url]'),
  command('/effort', 'Adjust model reasoning effort', 'configuration', '[low|medium|high|xhigh|max|auto]'),
  command('/exit', 'Close CCPT', 'interface', undefined, ['/quit']),
  command('/export', 'Export full conversation including archived history', 'session', '[path.md|path.json]'),
  command('/fast', 'Toggle fast model service tier', 'configuration', '[on|off]'),
  command('/files', 'Open workspace file completion', 'workspace'),
  command('/focus', 'Toggle outcome-focused conversation view', 'interface'),
  command('/goal', 'Manage a versioned persistent goal; pause/block does not grant execution', 'session', '[set <objective>|pause <reason>|block <reason>|resume|complete|cancel]'),
  command('/goal-run', 'Prepare and review budgeted approved-Plan workflows; explicit version-bound human confirmation', 'session', '[list|prepare|show ID|start ID|resume ID feedback|recover ID|cancel ID]'),
  command('/help', 'Show keyboard and command help', 'interface', undefined, ['/?']),
  command('/hooks', 'Show active lifecycle Hooks', 'integration'),
  command('/insights', 'Show personal Agent usage and cost insights', 'session'),
  command('/init', 'Initialize the extension workspace', 'workspace'),
  command('/ide', 'Install the bundled VS Code extension', 'integration', 'install'),
  command('/keybindings', 'Create or inspect project keybindings', 'configuration'),
  command('/max-context', 'Show or set the model context budget', 'configuration', '[tokens]'),
  command('/mcp', 'Manage MCP servers and notification listeners', 'integration', '[watch <server> [milliseconds]|watches|events <id>|stop <id>]'),
  command('/memory', 'List persistent memory keys', 'session', '[scope]'),
  command('/mode', 'Show or set the permission mode', 'configuration', '[default|acceptEdits|plan|bypassPermissions]'),
  command('/model', 'Select the active session model', 'configuration', '[name]'),
  command('/plugin', 'Manage Plugins and Marketplaces', 'integration', '[install|update|uninstall|enable|disable|marketplace]'),
  command('/permissions', 'Manage rules, recent denials and session approvals', 'configuration', '[mode|recent|reset]'),
  command('/output-style', 'List or select an output style', 'interface', '[name]'),
  command('/plan', 'Create, review, execute or recover a persistent plan', 'workspace', '[request|list|show ID|approve ID [--background]|execute ID|changes ID feedback|recover ID]'),
  command('/privacy-settings', 'Open privacy and policy configuration', 'configuration'),
  command('/reload', 'Reload Plugins, Skills, Agents, Hooks and MCP', 'integration'),
  command('/reload-plugins', 'Reload the complete extension registry', 'integration'),
  command('/reload-skills', 'Reload the complete extension registry', 'integration'),
  command('/release-notes', 'Show release highlights and the product guide path', 'interface'),
  command('/rename', 'Rename the active session', 'session', '<title>'),
  command('/review', 'Review current changes for correctness and risk', 'workspace', '[scope]'),
  command('/routines', 'List autonomous routines and run history', 'agent'),
  command('/search', 'Search the current conversation transcript', 'interface', '<query>'),
  command('/sandbox-toggle', 'Toggle sandbox permission mode', 'configuration'),
  command('/security-review', 'Run a security-focused code review', 'workspace', '[scope]'),
  command('/settings', 'Open the editable settings tab', 'configuration'),
  command('/rewind', 'Restore a checkpoint', 'session', '[checkpoint-id] [conversation]'),
  command('/resume', 'Browse or resume a saved session', 'session', '[session-id-or-name]', ['/continue']),
  command('/replay','Inspect an explicitly captured runtime journal without executing tools','session','[session-id] [cursor] [--include-text]'),
  command('/sessions', 'List resumable sessions', 'session'),
  command('/session', 'List resumable sessions', 'session'),
  command('/summary', 'Summarize the active project and work state', 'session', '[focus]'),
  command('/skills', 'Browse, inspect or run reusable skills', 'integration', '[name] [request]'),
  command('/teams', 'Inspect team members, plans, shared tasks and durable inbox', 'agent', '[members|plans|create|spawn|inbox|send|broadcast|shutdown|cleanup]'),
  command('/status', 'Open runtime status; use agent for the active record', 'agent', '[agent]'),
  command('/stats', 'Open runtime and Agent statistics', 'session'),
  command('/surface', 'Inspect external IDE, desktop, cloud, browser and runner adapters', 'integration', '[health [name]]'),
  command('/tasks', 'List and manage background Agent and shell tasks', 'agent', '[output|stop|claim] [id]'),
  command('/notifications', 'Inspect local notifications without marking them read', 'interface', '[offset|read <id> <version>]'),
  command('/terminal-setup', 'Show terminal-specific multiline and keybinding setup', 'interface'),
  command('/team', 'Discover or message Agent teammates', 'agent', '[members|plans|inbox|send <agent-id> <message>]'),
  command('/theme', 'Select terminal colors or accessibility mode', 'interface', '[dark|light|dark-daltonized|light-daltonized|ansi|none]'),
  command('/usage', 'Show context and activity statistics', 'session'),
  command('/ultraplan', 'Build a dependency-aware multi-Agent plan', 'workspace', '[request]'),
  command('/voice', 'Show voice-input availability and dependencies', 'interface'),
  command('/vim', 'Enable or disable Vim input mode', 'interface', '[on|off]'),
  command('/worktree', 'Start an isolated worktree agent', 'workspace', '<goal>'),
] as const;

const byName = new Map<string, NativeCommandDefinition>();
for (const definition of NATIVE_COMMANDS) {
  byName.set(definition.name, definition);
  for (const alias of definition.aliases ?? []) byName.set(alias, definition);
}

export function resolveNativeCommand(name: string): NativeCommandDefinition | undefined {
  const normalized = name.startsWith('/') ? name.toLowerCase() : `/${name.toLowerCase()}`;
  return byName.get(normalized);
}

export function searchNativeCommands(query: string, limit = 12): NativeCommandDefinition[] {
  const normalized = query.trim().toLowerCase().replace(/^\//, '');
  const score = (item: NativeCommandDefinition): number => {
    const name = item.name.slice(1);
    if (name === normalized) return 0;
    if (name.startsWith(normalized)) return 1;
    if (name.includes(normalized)) return 2;
    if (item.description.toLowerCase().includes(normalized)) return 3;
    return 4;
  };
  return NATIVE_COMMANDS.filter((item) => !normalized || score(item) < 4).sort((left, right) => score(left) - score(right) || left.name.localeCompare(right.name)).slice(0, Math.max(0, limit));
}
