import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import type { PlatformConfig } from './types.js';
import { executionSignal } from './executionControl.js';

export interface NetworkResponse { status: number; headers: IncomingHttpHeaders; text: string; body: Buffer }

interface RequestOptions { method?: string; headers?: Record<string, string>; body?: string; onData?: (chunk: Buffer) => void; onHeaders?: (status: number, headers: IncomingHttpHeaders) => void; collectBody?: boolean; maxResponseBytes?: number; deadlineMs?: number; signal?: AbortSignal }

function isLoopback(target: URL): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
}

function bypassProxy(target: URL): boolean {
  if (isLoopback(target)) return true;
  const entries = (process.env.NO_PROXY ?? process.env.no_proxy ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const hostname = target.hostname.toLowerCase();
  return entries.some((entry) => {
    if (entry === '*') return true;
    const host = entry.replace(/^\./, '').split(':')[0] ?? entry;
    return hostname === host || hostname.endsWith(`.${host}`);
  });
}

export async function readCaCertificates(path: string): Promise<string[]> {
  const content = await readFile(path, 'utf8');
  const certificates = content.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (!certificates.length || /PRIVATE KEY/.test(content)) throw new Error('CA file must contain PEM certificates only, not a private key');
  for (const certificate of certificates) new X509Certificate(certificate);
  return certificates;
}

async function tlsMaterial(config: PlatformConfig['network']): Promise<{ ca?: string[]; cert?: Buffer; key?: Buffer; rejectUnauthorized: boolean }> {
  const [ca, cert, key] = await Promise.all([
    config.caFile ? readCaCertificates(config.caFile) : undefined,
    config.clientCertFile ? readFile(config.clientCertFile) : undefined,
    config.clientKeyFile ? readFile(config.clientKeyFile) : undefined,
  ]);
  return { ...(ca ? { ca: [...tls.rootCertificates, ...ca] } : {}), ...(cert ? { cert } : {}), ...(key ? { key } : {}), rejectUnauthorized: config.rejectUnauthorized };
}

function collect(request: http.ClientRequest, timeoutMs: number, onData?: (chunk: Buffer) => void, options: RequestOptions = {}): Promise<NetworkResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const signal = options.signal ?? executionSignal();
    const onAbort = (): void => abort(new Error('Network request cancelled'));
    const cleanup = (): void => { clearTimeout(deadline); signal?.removeEventListener('abort', onAbort); };
    const deadline = options.deadlineMs ? setTimeout(() => abort(new Error('Network request deadline exceeded')), options.deadlineMs) : undefined;
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = (error: Error) => { fail(error); request.destroy(error); };
    request.setTimeout(timeoutMs, () => abort(new Error('Network request timed out')));
    request.on('response', (response) => {
      response.on('error', fail);
      try { options.onHeaders?.(response.statusCode ?? 0, response.headers); }
      catch (error) { abort(error instanceof Error ? error : new Error(String(error))); response.destroy(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        const value = Buffer.from(chunk); size += value.length;
        if (options.maxResponseBytes && size > options.maxResponseBytes) { abort(new Error('Network response exceeds size limit')); return; }
        if (options.collectBody !== false) chunks.push(value);
        try { onData?.(value); } catch (error) { abort(error instanceof Error ? error : new Error(String(error))); }
      });
      response.on('aborted', () => fail(new Error('Network response aborted')));
      response.on('end', () => { if (settled) return; settled = true; cleanup(); const body = Buffer.concat(chunks); resolve({ status: response.statusCode ?? 0, headers: response.headers, text: body.toString('utf8'), body }); });
    });
    request.on('error', fail);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function networkRequest(urlValue: string, options: RequestOptions, config: PlatformConfig['network']): Promise<NetworkResponse> {
  const signal = options.signal ?? executionSignal();
  signal?.throwIfAborted();
  const target = new URL(urlValue);
  if (!isLoopback(target) && config.allowedHosts.length > 0 && !config.allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    const host = target.hostname.toLowerCase();
    return allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) && host !== allowed.slice(2) : host === allowed;
  })) throw new Error(`Network host is not allowlisted: ${target.hostname}`);
  const proxy = config.proxyUrl && !bypassProxy(target) ? new URL(config.proxyUrl) : undefined;
  const material = await tlsMaterial(config);
  signal?.throwIfAborted();
  const method = options.method ?? 'GET';
  const headers = { ...(options.headers ?? {}), host: target.host, ...(options.body ? { 'content-length': String(Buffer.byteLength(options.body)) } : {}) };
  if (!proxy) {
    const client = target.protocol === 'https:' ? https : http;
    const request = client.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: `${target.pathname}${target.search}`, method, headers, ...(target.protocol === 'https:' ? material : {}) });
    const response = collect(request, config.timeoutMs, options.onData, options);
    if (options.body) request.write(options.body);
    request.end();
    return response;
  }
  const proxyClient = proxy.protocol === 'https:' ? https : http;
  const proxyAuthorization = proxy.username ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` : undefined;
  if (target.protocol === 'http:') {
    const request = proxyClient.request({ hostname: proxy.hostname, port: proxy.port || undefined, path: target.href, method, headers: { ...headers, ...(proxyAuthorization ? { 'proxy-authorization': proxyAuthorization } : {}) }, ...(proxy.protocol === 'https:' ? material : {}) });
    const response = collect(request, config.timeoutMs, options.onData, options);
    if (options.body) request.write(options.body);
    request.end();
    return response;
  }
  return new Promise<NetworkResponse>((resolve, reject) => {
    const connect = proxyClient.request({ hostname: proxy.hostname, port: proxy.port || undefined, method: 'CONNECT', path: `${target.hostname}:${target.port || 443}`, headers: { host: `${target.hostname}:${target.port || 443}`, ...(proxyAuthorization ? { 'proxy-authorization': proxyAuthorization } : {}) }, ...(proxy.protocol === 'https:' ? material : {}) });
    const cancelConnect = (): void => { connect.destroy(new Error('Proxy connection cancelled')); };
    signal?.addEventListener('abort', cancelConnect, { once: true });
    connect.on('close', () => signal?.removeEventListener('abort', cancelConnect));
    connect.setTimeout(config.timeoutMs, () => connect.destroy(new Error('Proxy connection timed out')));
    connect.on('connect', (response, socket) => {
      signal?.removeEventListener('abort', cancelConnect);
      if (signal?.aborted) { socket.destroy(); reject(new Error('Proxy connection cancelled')); return; }
      if (response.statusCode !== 200) { socket.destroy(); reject(new Error(`Proxy CONNECT failed (${response.statusCode ?? 0})`)); return; }
      const secure = tls.connect({ socket, servername: target.hostname, ...material });
      const request = https.request({ hostname: target.hostname, port: target.port || 443, path: `${target.pathname}${target.search}`, method, headers, agent: false, createConnection: () => secure });
      const result = collect(request, config.timeoutMs, options.onData, options);
      if (options.body) request.write(options.body);
      request.end();
      result.then(resolve, reject);
    });
    connect.on('error', reject);
    if (signal?.aborted) cancelConnect();
    connect.end();
  });
}

export async function networkJson<T>(url: string, options: RequestOptions, config: PlatformConfig['network']): Promise<{ status: number; headers: IncomingHttpHeaders; value: T; text: string }> {
  const response = await networkRequest(url, options, config);
  let value: T;
  try { value = JSON.parse(response.text) as T; }
  catch { throw new Error(`Expected JSON response (${response.status}): ${response.text.slice(0, 1_000)}`); }
  return { ...response, value };
}
