import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildMagicDocsUpdatePrompt } from './prompts.js';

const MAGIC_DOC_HEADER_PATTERN = /^#\s*MAGIC\s+DOC:\s*(.+)$/im;
const ITALICS_PATTERN = /^[_*](.+?)[_*]\s*$/;
const trackedMagicDocs = new Map<string, { path: string }>();

export function clearTrackedMagicDocs(): void { trackedMagicDocs.clear(); }

export function detectMagicDocHeader(content: string): { title: string; instructions?: string } | null {
  const match = MAGIC_DOC_HEADER_PATTERN.exec(content);
  if (!match?.[1]) return null;
  const afterHeader = content.slice((match.index ?? 0) + match[0].length);
  const nextLine = /^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/.exec(afterHeader)?.[1];
  const instructions = nextLine ? ITALICS_PATTERN.exec(nextLine)?.[1]?.trim() : undefined;
  return { title: match[1].trim(), ...(instructions ? { instructions } : {}) };
}

export function registerMagicDoc(filePath: string): void {
  const path = resolve(filePath);
  if (!trackedMagicDocs.has(path)) trackedMagicDocs.set(path, { path });
}

export function getTrackedMagicDocs(): string[] { return [...trackedMagicDocs.keys()]; }

export async function updateTrackedMagicDocs(update: (input: { path: string; prompt: string; currentContent: string }) => Promise<void>): Promise<{ updated: string[]; removed: string[] }> {
  const updated: string[] = [];
  const removed: string[] = [];
  for (const doc of [...trackedMagicDocs.values()]) {
    let content: string;
    try { content = await readFile(doc.path, 'utf8'); }
    catch { trackedMagicDocs.delete(doc.path); removed.push(doc.path); continue; }
    const detected = detectMagicDocHeader(content);
    if (!detected) { trackedMagicDocs.delete(doc.path); removed.push(doc.path); continue; }
    const prompt = await buildMagicDocsUpdatePrompt(content, doc.path, detected.title, detected.instructions);
    await update({ path: doc.path, prompt, currentContent: content });
    updated.push(doc.path);
  }
  return { updated, removed };
}

export async function initMagicDocs(options: { enabled?: boolean; onRead?: (listener: (path: string, content: string) => void) => void } = {}): Promise<void> {
  if (options.enabled === false) return;
  options.onRead?.((path, content) => { if (detectMagicDocHeader(content)) registerMagicDoc(path); });
}
