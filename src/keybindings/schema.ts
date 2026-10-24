export const KEYBINDING_CONTEXTS = ['Global', 'Chat', 'Autocomplete', 'Confirmation', 'Help', 'Transcript', 'HistorySearch', 'Task', 'ThemePicker', 'Settings', 'Tabs', 'Attachments', 'Footer', 'MessageSelector', 'DiffDialog', 'ModelPicker', 'Select', 'Plugin'] as const;
export type KeybindingContextName = typeof KEYBINDING_CONTEXTS[number];

export interface KeybindingBlock { context: KeybindingContextName; bindings: Record<string, string | null> }
export interface KeybindingsFile { $schema?: string; $docs?: string; bindings: KeybindingBlock[] }
