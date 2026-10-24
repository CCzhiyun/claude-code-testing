import type { KeybindingBlock } from './schema.js';

export const defaultBindings: KeybindingBlock[] = [
  { context: 'Global', bindings: { 'ctrl+d': 'app:exit', 'ctrl+l': 'app:redraw', 'ctrl+o': 'transcript:toggle', 'ctrl+t': 'app:toggleTasks', 'ctrl+b': 'task:background', 'shift+tab': 'permission:cycleMode' } },
  { context: 'Chat', bindings: { 'ctrl+c': 'chat:interrupt', 'ctrl+u': 'chat:cancel', 'ctrl+r': 'history:search', 'ctrl+s': 'chat:stash', 'ctrl+f': 'transcript:search', 'ctrl+p': 'file:search', 'ctrl+j': 'chat:newline', 'ctrl+g': 'chat:externalEditor', 'ctrl+x ctrl+e': 'chat:externalEditor', 'ctrl+x ctrl+k': 'chat:killAgents', 'ctrl+v': 'chat:imagePaste', 'alt+v': 'chat:imagePaste', 'alt+p': 'chat:modelPicker', 'alt+t': 'chat:thinkingToggle', 'alt+o': 'chat:fastMode', escape: 'chat:interrupt', enter: 'chat:submit', 'shift+enter': 'chat:newline', up: 'history:previous', down: 'history:next', left: 'chat:left', right: 'chat:right', home: 'chat:home', end: 'chat:end', backspace: 'chat:backspace', delete: 'chat:delete', tab: 'autocomplete:accept', pageup: 'transcript:pageUp', pagedown: 'transcript:pageDown' } },
];
