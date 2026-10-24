import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LspServerConfig, PlatformConfig } from '../../types.js';
import { LSPClient } from './LSPClient.js';

export type LSPServerInstance = {
  name: string;
  config: LspServerConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendRequest<T>(method: string, params: unknown): Promise<T>;
  sendNotification(method: string, params: unknown): void;
  onNotification(method: string, handler: (params: unknown) => void): () => void;
  onRequest(method: string, handler: (params: unknown) => unknown | Promise<unknown>): () => void;
  isStarted(): boolean;
  languageId(filePath: string): string;
};

export function createLSPServerInstance(name: string, server: LspServerConfig, workspace: string, platform: PlatformConfig): LSPServerInstance {
  const client = new LSPClient(); let started = false;
  return {
    name, config: server,
    async start() { if (!started) { await client.connect(name, server, workspace, platform); started = true; } },
    async stop() { if (started) await client.close(); started = false; },
    async sendRequest<T>(method: string, params: unknown) { if (!started) throw new Error(`LSP server ${name} is not started`); return await client.request(method, params) as T; },
    sendNotification(method, params) { if (!started) throw new Error(`LSP server ${name} is not started`); client.notify(method, params); },
    onNotification: (method, handler) => client.onNotification(method, handler),
    onRequest: (method, handler) => client.onRequest(method, handler),
    isStarted: () => started,
    languageId(filePath) { const extension = extname(filePath).toLowerCase(); return server.languageId || extension.slice(1) || 'plaintext'; },
  };
}

export function textDocumentIdentifier(filePath: string): { uri: string } { return { uri: pathToFileURL(resolve(filePath)).href }; }
