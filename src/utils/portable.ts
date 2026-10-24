import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { delimiter, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export function stableStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  const normalizeValue = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (Array.isArray(item)) return item.map(normalizeValue);
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, normalizeValue(entry)]));
  };
  return JSON.stringify(normalizeValue(value), null, space);
}

export function parseJson<T>(value: string, fallback?: T): T {
  try { return JSON.parse(value) as T; }
  catch (error) { if (arguments.length > 1) return fallback as T; throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

export async function readJsonFile<T>(path: string, fallback?: T): Promise<T> {
  try { return parseJson<T>(await readFile(path, 'utf8')); }
  catch (error) { if (arguments.length > 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return fallback as T; throw error; }
}

export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> { await writeFileAtomic(path, `${stableStringify(value, 2)}\n`); }

export interface FrontmatterResult { attributes: Record<string, string | boolean | number>; body: string }

export function parseFrontmatter(value: string): FrontmatterResult {
  if (!value.startsWith('---\n') && !value.startsWith('---\r\n')) return { attributes: {}, body: value };
  const normalized = value.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { attributes: {}, body: value };
  const attributes: Record<string, string | boolean | number> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1 || line.trimStart().startsWith('#')) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    attributes[key] = /^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return { attributes, body: normalized.slice(end + 5) };
}

export function substituteArguments(template: string, args: readonly string[], named: Readonly<Record<string, string>> = {}): string {
  return template.replace(/\$\{([^}]+)\}|\$(\d+)|\$ARGUMENTS\b/g, (_match, key: string | undefined, index: string | undefined) => {
    if (key) return named[key] ?? '';
    if (index) return args[Math.max(0, Number(index) - 1)] ?? '';
    return args.join(' ');
  });
}

export function shellQuote(value: string, platform: 'posix' | 'powershell' = 'posix'): string {
  if (platform === 'powershell') return `'${value.replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function splitShellWords(value: string): string[] {
  const output: string[] = []; let current = ''; let quote: string | undefined; let escaped = false;
  for (const character of value.trim()) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = undefined; else current += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) { if (current) { output.push(current); current = ''; } } else current += character;
  }
  if (quote) throw new Error(`Unclosed ${quote} quote`);
  if (escaped) current += '\\';
  if (current) output.push(current);
  return output;
}

export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function fingerprint(value: unknown, length = 16): string { return sha256(stableStringify(value)).slice(0, Math.max(4, length)); }
export function taggedId(prefix: string): string { const clean = prefix.replace(/[^a-z0-9_-]/gi, '').replace(/_+$/, ''); if (!clean) throw new Error('ID prefix is required'); return `${clean}_${randomUUID().replace(/-/g, '')}`; }

export function normalizePortablePath(path: string): string { return normalize(path).split(sep).join('/'); }
export function resolveWithin(root: string, candidate: string): string { const base = resolve(root); const target = resolve(base, candidate); const relative = target.slice(base.length); if (target !== base && (!relative.startsWith(sep) || relative.includes(`..${sep}`))) throw new Error(`Path escapes workspace: ${candidate}`); return target; }
export function toPlatformPath(path: string): string { return process.platform === 'win32' ? path.replace(/\//g, '\\') : path.replace(/\\/g, '/'); }
export function expandHome(path: string): string { return path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path; }
export function cacheDirectory(app = 'ccpt'): string { return process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, app) : process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, app, 'cache') : join(homedir(), '.cache', app); }
export function configDirectory(app = 'ccpt'): string { return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, app) : process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, app) : join(homedir(), '.config', app); }
export function temporaryPath(name = 'ccpt'): string { return join(tmpdir(), `${name}-${process.pid}-${randomUUID()}`); }

export async function pathExists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
export async function isReadableFile(path: string): Promise<boolean> { try { const details = await stat(path); await access(path, fsConstants.R_OK); return details.isFile(); } catch { return false; } }
export async function findExecutable(name: string, environment = process.env): Promise<string | undefined> {
  const extensions = process.platform === 'win32' ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  const candidates = isAbsolute(name) || name.includes('/') || name.includes('\\') ? [name] : (environment.PATH ?? '').split(delimiter).filter(Boolean).flatMap((directory) => extensions.map((extension) => join(directory, process.platform === 'win32' && !extensions.some((item) => name.toUpperCase().endsWith(item)) ? `${name}${extension}` : name)));
  for (const candidate of candidates) if (await isReadableFile(candidate)) return candidate;
  return undefined;
}

export function parseDuration(value: string | number): number {
  if (typeof value === 'number') { if (!Number.isFinite(value) || value < 0) throw new Error('Invalid duration'); return value; }
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]?.toLowerCase() ?? 'ms']!);
}

export function formatBriefTimestamp(value: number | Date, now = Date.now()): string {
  const timestamp = value instanceof Date ? value.getTime() : value;
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function escapeXml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
export function stripMarkdown(value: string): string { return value.replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1').replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/[*_~]/g, '').trim(); }
