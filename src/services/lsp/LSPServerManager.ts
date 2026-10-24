import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PlatformConfig } from '../../types.js';
import { createLSPServerInstance, type LSPServerInstance } from './LSPServerInstance.js';

export type LSPServerManager = {
  initialize(): Promise<void>; shutdown(): Promise<void>;
  getServerForFile(filePath: string): LSPServerInstance | undefined;
  ensureServerStarted(filePath: string): Promise<LSPServerInstance | undefined>;
  sendRequest<T>(filePath: string, method: string, params: unknown): Promise<T | undefined>;
  getAllServers(): Map<string, LSPServerInstance>;
  openFile(filePath: string, content?: string): Promise<void>; changeFile(filePath: string, content: string): Promise<void>;
  saveFile(filePath: string): Promise<void>; closeFile(filePath: string): Promise<void>; isFileOpen(filePath: string): boolean;
};

export function createLSPServerManager(platform: PlatformConfig, workspace: string): LSPServerManager {
  const servers = new Map<string, LSPServerInstance>(); const extensions = new Map<string, string[]>(); const opened = new Map<string, { server: string; version: number }>();
  const uri = (file: string) => pathToFileURL(resolve(file)).href;
  return {
    async initialize() {
      for (const [name, config] of Object.entries(platform.lspServers)) {
        const instance = createLSPServerInstance(name, config, workspace, platform); servers.set(name, instance);
        for (const extension of config.extensions) extensions.set(extension.toLowerCase(), [...(extensions.get(extension.toLowerCase()) ?? []), name]);
        instance.onRequest('workspace/configuration', (params) => Array.isArray((params as { items?: unknown[] })?.items) ? (params as { items: unknown[] }).items.map(() => null) : []);
      }
    },
    async shutdown() { await Promise.allSettled([...servers.values()].map((server) => server.stop())); opened.clear(); servers.clear(); extensions.clear(); },
    getServerForFile(file) { const name = extensions.get(extname(file).toLowerCase())?.[0]; return name ? servers.get(name) : undefined; },
    async ensureServerStarted(file) { const server = this.getServerForFile(file); if (server) await server.start(); return server; },
    async sendRequest<T>(file: string, method: string, params: unknown) { const server = await this.ensureServerStarted(file); return server?.sendRequest<T>(method, params); },
    getAllServers: () => new Map(servers),
    async openFile(file, content) { const server = await this.ensureServerStarted(file); if (!server) return; const text = content ?? await readFile(file, 'utf8'); const documentUri = uri(file); server.sendNotification('textDocument/didOpen', { textDocument: { uri: documentUri, languageId: server.languageId(file), version: 1, text } }); opened.set(documentUri, { server: server.name, version: 1 }); },
    async changeFile(file, content) { const server = await this.ensureServerStarted(file); if (!server) return; const documentUri = uri(file); const current = opened.get(documentUri); if (!current) { await this.openFile(file, content); return; } const version = current.version + 1; server.sendNotification('textDocument/didChange', { textDocument: { uri: documentUri, version }, contentChanges: [{ text: content }] }); opened.set(documentUri, { server: server.name, version }); },
    async saveFile(file) { const state = opened.get(uri(file)); const server = state ? servers.get(state.server) : undefined; server?.sendNotification('textDocument/didSave', { textDocument: { uri: uri(file) } }); },
    async closeFile(file) { const documentUri = uri(file); const state = opened.get(documentUri); const server = state ? servers.get(state.server) : undefined; server?.sendNotification('textDocument/didClose', { textDocument: { uri: documentUri } }); opened.delete(documentUri); },
    isFileOpen: (file) => opened.has(uri(file)),
  };
}
