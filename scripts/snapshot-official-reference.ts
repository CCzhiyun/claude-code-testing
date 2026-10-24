// Archive public reference data only. Never executes downloaded content or reads credentials.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dir, '../.ccpt/reference-docs/2026-10-16');
await mkdir(root, { recursive: true });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function markdownHeadings(source: string) {
  let fence = '';
  return source.split('\n').flatMap((line, i) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; return []; }
    if (fence) return [];
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    return match ? [{ line: i + 1, level: match[1]!.length, title: match[2]! }] : [];
  });
}
if (process.argv.includes('--reindex')) {
  const saved = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  for (const entry of saved.entries) if (entry.status === 'downloaded') {
    const content = await readFile(join(root, entry.file), 'utf8');
    if (hash(content) !== entry.sha256) throw new Error(`Snapshot hash mismatch: ${entry.file}`);
    entry.headings = markdownHeadings(content);
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(saved, null, 2));
  await writeFile(join(root, 'page-index.md'), '# Official documentation snapshot\n\n| Page | Snapshot | Status | Headings |\n| --- | --- | --- | --- |\n' + saved.entries.map((entry: any) => `| [${entry.title}](${entry.url}) | ${entry.file ?? ''} | ${entry.status} | ${entry.headings?.length ?? 0} |`).join('\n'));
  console.log(JSON.stringify({ verifiedPages: saved.entries.length, headings: saved.entries.reduce((n: number, entry: any) => n + (entry.headings?.length ?? 0), 0) }));
  process.exit(0);
}
async function download(url: string): Promise<{ text: string; finalUrl: string; contentType: string }> {
  const target = new URL(url);
  if (target.hostname !== 'code.claude.com' && !(target.hostname === 'raw.githubusercontent.com' && target.pathname === '/anthropics/claude-code/main/CHANGELOG.md')) throw new Error('Unexpected reference origin');
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.1' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const final = new URL(response.url); if (!['code.claude.com', 'raw.githubusercontent.com'].includes(final.hostname) && !(target.pathname === '/docs/en/claude-tag.md' && final.hostname === 'claude.com' && final.pathname.startsWith('/docs/claude-tag'))) throw new Error('Unexpected redirect origin');
      const text = await response.text(); if (Buffer.byteLength(text) > 8_000_000) throw new Error('Reference exceeds archive limit');
      if (/<!doctype html/i.test(text.slice(0, 300)) && final.hostname !== 'claude.com') throw new Error('HTML returned instead of Markdown');
      return { text, finalUrl: response.url, contentType: response.headers.get('content-type') ?? '' };
    } catch (e) { error = e; }
  }
  throw error;
}
const indexUrl = 'https://code.claude.com/docs/llms.txt';
const index = await download(indexUrl); await writeFile(join(root, 'llms.txt'), index.text);
const links = new Map<string, { title: string; url: string; summary: string }>();
for (const match of index.text.matchAll(/^- \[([^\]]+)\]\((https:\/\/code\.claude\.com\/docs\/en\/[^)]+\.md)\):?\s*(.*)$/gm)) links.set(match[2]!, { title: match[1]!, url: match[2]!, summary: match[3] ?? '' });
if (!links.size) throw new Error('Official index contained no parseable documentation links');
const previous = process.argv.includes('--retry-failed') ? JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) : undefined;
const pages = [...links.values()].filter(page => !previous || previous.entries.some((entry: any) => entry.url === page.url && entry.status === 'failed'));
type Entry = { title: string; url: string; summary: string; status: 'downloaded' | 'failed'; file?: string; sha256?: string; bytes?: number; contentType?: string; finalUrl?: string; error?: string; headings?: Array<{ line: number; title: string; level: number }> };
const entries: Entry[] = previous ? previous.entries.filter((entry: Entry) => entry.status !== 'failed') : []; let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const page = pages[cursor++]; if (!page) return;
    const file = new URL(page.url).pathname.replace('/docs/en/', 'pages/');
    try {
      const value = await download(page.url); await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), value.text);
      const headings = markdownHeadings(value.text);
      entries.push({ ...page, status: 'downloaded', file, sha256: hash(value.text), bytes: Buffer.byteLength(value.text), finalUrl: value.finalUrl, contentType: value.contentType, headings });
    } catch (e) { entries.push({ ...page, status: 'failed', error: String(e) }); }
    console.log(JSON.stringify({ page: page.title, status: entries.at(-1)!.status, complete: entries.length, total: pages.length }));
  }
}));
const cachedChangelog = previous ? await readFile(join(root, 'official-repository-CHANGELOG.md'), 'utf8') : undefined;
if (cachedChangelog && hash(cachedChangelog) !== previous.changelog.sha256) throw new Error('Cached changelog hash mismatch');
const changelog = cachedChangelog ? { text: cachedChangelog, finalUrl: previous.changelog.url, contentType: 'text/plain' } : await download('https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md');
await writeFile(join(root, 'official-repository-CHANGELOG.md'), changelog.text);
const releases: Array<{ id: string; version: string; line: number; text: string; status: 'not-reviewed' }> = [];
let version = '', releaseCounter = 0;
for (const [i, line] of changelog.text.split('\n').entries()) {
  const m = /^##\s+(?:v)?(\d+\.\d+\.\d+)/.exec(line);
  if (m) { version = m[1]!; releaseCounter = 0; }
  if (version && /^-\s/.test(line)) releases.push({ id: `REL-${version}-${String(++releaseCounter).padStart(3, '0')}`, version, line: i + 1, text: line.slice(2), status: 'not-reviewed' });
  else if (releases.length && /^\s+\S/.test(line)) releases.at(-1)!.text += '\n' + line.trim();
}
entries.sort((a, b) => a.url.localeCompare(b.url));
const manifest = { fetchedAt: new Date().toISOString(), index: { url: indexUrl, sha256: hash(index.text) }, publicReferenceOnly: true, redistributionAuthorization: 'not-assumed; archive excluded from npm files',
  pages: entries.length, downloaded: entries.filter(e => e.status === 'downloaded').length, failed: entries.filter(e => e.status === 'failed').length,
  changelog: { url: changelog.finalUrl, sha256: hash(changelog.text), versions: new Set(releases.map(r => r.version)).size, entries: releases.length, newest: releases[0]?.version, ...(cachedChangelog ? { reusedVerifiedSnapshotFrom: previous.fetchedAt } : {}) }, entries };
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(root, 'release-ledger.json'), JSON.stringify(releases, null, 2));
await writeFile(join(root, 'release-ledger.md'), '# Official release entry ledger — not yet feature certification\n\n| ID | Source line | Review status | Entry |\n| --- | --- | --- | --- |\n' + releases.map(r => `| ${r.id} | ${r.line} | ${r.status} | ${r.text.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`).join('\n'));
await writeFile(join(root, 'page-index.md'), '# Official documentation snapshot\n\n| Page | Snapshot | Status | Headings |\n| --- | --- | --- | --- |\n' + entries.map(e => `| [${e.title}](${e.url}) | ${e.file ?? ''} | ${e.status} | ${e.headings?.length ?? 0} |`).join('\n'));
console.log(JSON.stringify({ ...manifest, entries: undefined }, null, 2));
if (manifest.failed) process.exitCode = 1;
