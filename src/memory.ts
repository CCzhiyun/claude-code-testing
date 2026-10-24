import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from './paths.js';

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key)) throw new Error('Memory key may contain only letters, numbers, dot, dash, and underscore');
  return key;
}

export async function setMemory(scope: string, key: string, value: string): Promise<void> {
  const directory = join(homeStateDir(), 'memory', safeKey(scope));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${safeKey(key)}.md`), value, { mode: 0o600 });
}

export async function getMemory(scope: string, key: string): Promise<string> {
  return readFile(join(homeStateDir(), 'memory', safeKey(scope), `${safeKey(key)}.md`), 'utf8');
}

export async function listMemory(scope: string): Promise<string[]> {
  try {
    return (await readdir(join(homeStateDir(), 'memory', safeKey(scope))))
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function memoryContext(scope: string, limit = 20_000): Promise<string> {
  const keys = await listMemory(scope);
  const parts: string[] = [];
  for (const key of keys) parts.push(`# ${key}\n${await getMemory(scope, key)}`);
  return parts.join('\n\n').slice(0, limit);
}
