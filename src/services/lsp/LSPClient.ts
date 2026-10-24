import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LspServerConfig, PlatformConfig } from '../../types.js';
import { authorizeCommand, protectPath } from '../../policy.js';
import { modelCredentialNames, sanitizedEnvironment } from '../../environment.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class LSPClient {
  #process: ChildProcessWithoutNullStreams | undefined;
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #pending = new Map<number, PendingRequest>();
  #notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  #requestHandlers = new Map<string, (params: unknown) => unknown | Promise<unknown>>();

  async connect(name: string, server: LspServerConfig, workspace: string, config: PlatformConfig): Promise<void> {
    authorizeCommand(server.command, server.args ?? [], config);
    const cwd = protectPath(resolve(server.cwd ?? workspace), config);
    const wrapper = config.policy.processWrapper;
    this.#process = spawn(wrapper ?? server.command, wrapper ? [server.command, ...(server.args ?? [])] : server.args ?? [], {
      cwd,
      env: sanitizedEnvironment(config.policy.mode, {}, config.policy.allowedEnvironmentVariables, modelCredentialNames(config)),
      shell: false,
      windowsHide: true,
      stdio: 'pipe',
    });
    this.#process.stdout.on('data', (chunk: Buffer) => this.#receive(chunk));
    this.#process.stdin.on('error', () => { /* The server may close immediately after the exit notification. */ });
    this.#process.stderr.on('data', () => { /* Drain language-server diagnostics. */ });
    this.#process.on('exit', () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`LSP server ${name} exited`));
      }
      this.#pending.clear();
    });
    await new Promise<void>((resolvePromise, reject) => {
      this.#process?.once('spawn', resolvePromise);
      this.#process?.once('error', reject);
    });
    const rootUri = pathToFileURL(resolve(workspace)).href;
    await this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'ccpt', version: '1.0.0' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: resolve(workspace).split(/[\\/]/).pop() ?? 'workspace' }],
      capabilities: {
        textDocument: { definition: {}, references: {}, hover: {}, documentSymbol: {}, implementation: {}, callHierarchy: {} },
        workspace: { symbol: {} },
      },
      initializationOptions: server.initializationOptions ?? {},
    });
    this.notify('initialized', {});
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (!this.#process) throw new Error('LSP client is not connected');
    const id = this.#nextId++;
    this.#send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolvePromise, reject, timer });
    });
  }

  notify(method: string, params: unknown): void { this.#send({ jsonrpc: '2.0', method, params }); }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.#notificationHandlers.get(method) ?? new Set();
    handlers.add(handler);
    this.#notificationHandlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  onRequest(method: string, handler: (params: unknown) => unknown | Promise<unknown>): () => void {
    this.#requestHandlers.set(method, handler);
    return () => { if (this.#requestHandlers.get(method) === handler) this.#requestHandlers.delete(method); };
  }

  async openDocument(filePath: string, languageId: string): Promise<{ uri: string; text: string }> {
    const path = resolve(filePath);
    const text = await readFile(path, 'utf8');
    const uri = pathToFileURL(path).href;
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    return { uri, text };
  }

  async close(): Promise<void> {
    if (!this.#process) return;
    try { await this.request('shutdown', null, 2_000); } catch { /* Terminate an unresponsive server below. */ }
    this.notify('exit', null);
    this.#process.kill();
    this.#process = undefined;
  }

  #send(message: unknown): void {
    if (!this.#process || this.#process.stdin.destroyed) return;
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.#process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.#process.stdin.write(body);
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (true) {
      const separator = this.#buffer.indexOf('\r\n\r\n');
      if (separator < 0) return;
      const headers = this.#buffer.subarray(0, separator).toString('ascii');
      const match = headers.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!match?.[1]) { this.#buffer = this.#buffer.subarray(separator + 4); continue; }
      const length = Number(match[1]);
      const bodyStart = separator + 4;
      if (this.#buffer.length < bodyStart + length) return;
      const body = this.#buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.#buffer = this.#buffer.subarray(bodyStart + length);
      let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
      try { message = JSON.parse(body) as typeof message; } catch { continue; }
      if (message.id !== undefined && !message.method) {
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? 'LSP error'));
        else pending.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        const handler = this.#requestHandlers.get(message.method);
        void Promise.resolve(handler ? handler(message.params) : null)
          .then((result) => this.#send({ jsonrpc: '2.0', id: message.id, result }))
          .catch((error) => this.#send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }));
      } else if (message.method) {
        for (const handler of this.#notificationHandlers.get(message.method) ?? []) {
          try { handler(message.params); } catch { /* Isolate passive notification handlers. */ }
        }
      }
    }
  }
}
