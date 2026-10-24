import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectStateDir } from '../paths.js';

export interface ExternalEditorOptions {
  cwd: string;
  editor?: string;
  previousResponse?: string;
  run?: (command: string, args: string[]) => SpawnSyncReturns<Buffer>;
}

function splitEditor(value: string): { command: string; args: string[] } {
  const parts = value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
  const command = parts.shift();
  if (!command) throw new Error('External editor command is empty');
  return { command, args: parts };
}

export async function editPromptExternally(input: string, options: ExternalEditorOptions): Promise<string> {
  const directory = join(projectStateDir(options.cwd), 'tmp');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `prompt-${randomUUID()}.md`);
  const context = options.previousResponse ? `# --- CCPT previous response (read-only context) ---\n${options.previousResponse.split(/\r?\n/).map((line) => `# ${line}`).join('\n')}\n# --- end CCPT context ---\n\n` : '';
  await writeFile(path, `${context}${input}`, { mode: 0o600 });
  try {
    const selected = options.editor ?? process.env.VISUAL ?? process.env.EDITOR ?? (process.platform === 'win32' ? 'notepad.exe' : 'vi');
    const invocation = splitEditor(selected);
    const result = options.run?.(invocation.command, [...invocation.args, path]) ?? spawnSync(invocation.command, [...invocation.args, path], { cwd: options.cwd, stdio: 'inherit', windowsHide: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`External editor exited with code ${result.status ?? 'unknown'}`);
    let edited = await readFile(path, 'utf8');
    if (options.previousResponse) edited = edited.replace(/^# --- CCPT previous response \(read-only context\) ---\r?\n[\s\S]*?^# --- end CCPT context ---\r?\n?/m, '');
    return edited.replace(/^\s*\n/, '').replace(/\s+$/, '');
  } finally {
    await rm(path, { force: true });
  }
}
