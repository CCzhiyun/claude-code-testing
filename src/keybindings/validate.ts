import { KEYBINDING_CONTEXTS, type KeybindingsFile } from './schema.js';
import { parseChord } from './parser.js';

export function validateKeybindings(value: unknown): asserts value is KeybindingsFile {
  if (!value || typeof value !== 'object' || !Array.isArray((value as KeybindingsFile).bindings)) throw new Error('keybindings.json must contain a bindings array');
  for (const block of (value as KeybindingsFile).bindings) {
    if (!KEYBINDING_CONTEXTS.includes(block.context)) throw new Error(`Invalid keybinding context: ${String(block.context)}`);
    if (!block.bindings || typeof block.bindings !== 'object' || Array.isArray(block.bindings)) throw new Error(`Bindings for ${block.context} must be an object`);
    for (const [chord, action] of Object.entries(block.bindings)) {
      const parsed = parseChord(chord);
      if (parsed.length === 0 || parsed.some((key) => !key.key)) throw new Error(`Invalid keybinding chord: ${chord}`);
      if (action !== null && typeof action !== 'string') throw new Error(`Invalid action for ${chord}`);
    }
  }
}
