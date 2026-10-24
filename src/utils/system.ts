import { spawn } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { withTimeout } from './async.js';

export interface ProcessResult { command: string; args: string[]; cwd?: string; stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; ok: boolean }

export async function execFileNoThrow(command: string, args: readonly string[] = [], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; input?: string; maximumOutput?: number } = {}): Promise<ProcessResult> {
  const maximum = options.maximumOutput ?? 2_000_000;
  const operation = new Promise<ProcessResult>((finish) => {
    const child = spawn(command, [...args], { ...(options.cwd ? { cwd: options.cwd } : {}), env: options.env ?? process.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < maximum) stdout += chunk.toString().slice(0, maximum - stdout.length); });
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < maximum) stderr += chunk.toString().slice(0, maximum - stderr.length); });
    child.once('error', (error) => finish({ command, args: [...args], ...(options.cwd ? { cwd: options.cwd } : {}), stdout, stderr: `${stderr}${error.message}`, code: null, signal: null, ok: false }));
    child.once('close', (code, signal) => finish({ command, args: [...args], ...(options.cwd ? { cwd: options.cwd } : {}), stdout, stderr, code, signal, ok: code === 0 }));
    if (options.input !== undefined) child.stdin.end(options.input); else child.stdin.end();
  });
  return options.timeout ? withTimeout(operation, options.timeout, `${command} timed out after ${options.timeout}ms`) : operation;
}

export function mergeEnvironment(...layers: ReadonlyArray<NodeJS.ProcessEnv | undefined>): NodeJS.ProcessEnv { const output: NodeJS.ProcessEnv = {}; for (const layer of layers) for (const [key, value] of Object.entries(layer ?? {})) if (value === undefined) delete output[key]; else output[key] = value; return output; }
export function pickEnvironment(environment: NodeJS.ProcessEnv, allowed: Iterable<string>): NodeJS.ProcessEnv { const output: NodeJS.ProcessEnv = {}; for (const key of allowed) if (environment[key] !== undefined) output[key] = environment[key]; return output; }
export function validateEnvironment(environment: NodeJS.ProcessEnv): string[] { const errors: string[] = []; for (const [key, value] of Object.entries(environment)) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`Invalid environment name: ${key}`); if (value?.includes('\u0000')) errors.push(`Environment value contains NUL: ${key}`); } return errors; }
export function redactEnvironment(environment: NodeJS.ProcessEnv, pattern = /token|secret|password|credential|api.?key|authorization/i): NodeJS.ProcessEnv { return Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, pattern.test(key) && value ? '[REDACTED]' : value])); }

export async function detectRepository(start = process.cwd()): Promise<{ root: string; gitDirectory: string } | undefined> {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, '.git');
    try {
      const details = await stat(candidate);
      if (details.isDirectory()) return { root: current, gitDirectory: candidate };
      if (details.isFile()) { const text = await readFile(candidate, 'utf8'); const match = text.match(/^gitdir:\s*(.+)$/m); if (match) return { root: current, gitDirectory: resolve(current, match[1]!.trim()) }; }
    } catch {}
    const parent = dirname(current); if (parent === current) return undefined; current = parent;
  }
}

export async function git(args: readonly string[], cwd = process.cwd()): Promise<ProcessResult> { return execFileNoThrow('git', args, { cwd, timeout: 30_000 }); }
export async function gitDiff(cwd = process.cwd(), staged = false): Promise<string> { const result = await git(['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--'], cwd); if (!result.ok) throw new Error(result.stderr.trim() || 'git diff failed'); return result.stdout; }
export function parseGitConfig(value: string): Record<string, string> { const output: Record<string, string> = {}; let section = ''; for (const raw of value.split(/\r?\n/)) { const line = raw.trim(); const header = line.match(/^\[([^\]]+)\]$/); if (header) { section = header[1]!.replace(/\s+"([^"]+)"$/, '.$1').toLowerCase(); continue; } const separator = line.indexOf('='); if (separator > 0 && !line.startsWith('#') && !line.startsWith(';')) output[`${section ? `${section}.` : ''}${line.slice(0, separator).trim().toLowerCase()}`] = line.slice(separator + 1).trim(); } return output; }
export function repositorySlug(remote: string): string | undefined { const match = remote.trim().replace(/\.git$/, '').match(/(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?[^/:]+[:/]([^/]+\/[^/]+)$/); return match?.[1]; }

export function redactSecrets(value: string): string { return value.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[REDACTED]').replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]').replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]'); }
export function safeUrl(value: string, allowedProtocols: readonly string[] = ['https:', 'http:']): URL { const url = new URL(value); if (!allowedProtocols.includes(url.protocol)) throw new Error(`Unsupported URL protocol: ${url.protocol}`); if (url.username || url.password) throw new Error('Credentials in URLs are not allowed'); return url; }
export function isPrivateHost(hostname: string): boolean { const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); return host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host); }
export function assertPublicUrl(value: string): URL { const url = safeUrl(value, ['https:']); if (isPrivateHost(url.hostname)) throw new Error(`Private network destination is not allowed: ${url.hostname}`); return url; }
export function proxyForUrl(value: string, environment = process.env): string | undefined { const url = new URL(value); const noProxy = (environment.NO_PROXY ?? environment.no_proxy ?? '').split(',').map((entry) => entry.trim()).filter(Boolean); if (noProxy.some((entry) => url.hostname === entry || (entry.startsWith('.') && url.hostname.endsWith(entry)))) return undefined; return url.protocol === 'https:' ? environment.HTTPS_PROXY ?? environment.https_proxy ?? environment.HTTP_PROXY ?? environment.http_proxy : environment.HTTP_PROXY ?? environment.http_proxy; }
export function userAgent(name: string, version: string, platform = process.platform, architecture = process.arch): string { return `${name}/${version} (${platform}; ${architecture}; Node/${process.versions.node})`; }

export async function ensureReadable(path: string): Promise<string> { await access(path); return path; }
export function pathRoot(path: string): string { return parse(resolve(path)).root; }
