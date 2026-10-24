import { cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function installVsCodeExtension(version: string): Promise<string> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(moduleDirectory, '..');
  const source = join(packageRoot, 'vscode-extension');
  const extensionsRoot = process.env.VSCODE_EXTENSIONS ?? join(homedir(), '.vscode', 'extensions');
  const target = join(extensionsRoot, `ccpt-vscode-${version}`);
  await mkdir(extensionsRoot, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
  return target;
}
