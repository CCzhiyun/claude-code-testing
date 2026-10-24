import { basename, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { homeStateDir, projectStateDir } from '../paths.js';
import { parseMarkdownDocument } from '../frontmatter.js';

export interface OutputStyleConfig {
  name: string;
  description: string;
  prompt: string;
  source: 'user' | 'project';
  path: string;
  keepCodingInstructions?: boolean;
}

async function loadDirectory(directory: string, source: OutputStyleConfig['source']): Promise<OutputStyleConfig[]> {
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const output: OutputStyleConfig[] = [];
  for (const name of names.filter((item) => item.toLowerCase().endsWith('.md')).sort()) {
    const path = join(directory, name);
    try {
      const document = parseMarkdownDocument(await readFile(path, 'utf8'));
      const fallback = basename(name, '.md');
      const styleName = typeof document.attributes.name === 'string' ? document.attributes.name : fallback;
      const firstText = document.body.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#'))?.trim();
      const description = typeof document.attributes.description === 'string' ? document.attributes.description : firstText ?? `Custom ${styleName} output style`;
      const rawKeep = document.attributes['keep-coding-instructions'];
      output.push({ name: styleName, description, prompt: document.body, source, path, ...(typeof rawKeep === 'boolean' ? { keepCodingInstructions: rawKeep } : {}) });
    } catch { /* One malformed style must not hide the remaining catalog. */ }
  }
  return output;
}

export async function getOutputStyleDirStyles(cwd: string): Promise<OutputStyleConfig[]> {
  const [user, project] = await Promise.all([
    loadDirectory(join(homeStateDir(), 'output-styles'), 'user'),
    loadDirectory(join(projectStateDir(cwd), 'output-styles'), 'project'),
  ]);
  const byName = new Map(user.map((style) => [style.name.toLowerCase(), style]));
  for (const style of project) byName.set(style.name.toLowerCase(), style);
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function selectOutputStyle(cwd: string, name?: string): Promise<OutputStyleConfig | undefined> {
  if (!name) return undefined;
  return (await getOutputStyleDirStyles(cwd)).find((style) => style.name.toLowerCase() === name.toLowerCase());
}

export function clearOutputStyleCaches(): void { /* Loader is deliberately uncached so /reload observes edits immediately. */ }
