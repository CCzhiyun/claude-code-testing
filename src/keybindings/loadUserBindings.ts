import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectStateDir } from '../paths.js';
import { defaultBindings } from './defaultBindings.js';
import { parseBindings } from './parser.js';
import { KeybindingResolver } from './resolver.js';
import type { KeybindingsFile } from './schema.js';
import { validateKeybindings } from './validate.js';

export async function loadUserBindings(cwd: string): Promise<KeybindingResolver> {
  let user: KeybindingsFile = { bindings: [] };
  try {
    const value: unknown = JSON.parse(await readFile(join(projectStateDir(cwd), 'keybindings.json'), 'utf8'));
    validateKeybindings(value);
    user = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return new KeybindingResolver([...parseBindings(defaultBindings, 'default'), ...parseBindings(user.bindings, 'user')]);
}
