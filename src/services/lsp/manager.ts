import { resolve } from 'node:path';
import type { PlatformConfig } from '../../types.js';
import { protectPath } from '../../policy.js';
import { LSPClient } from './LSPClient.js';
import { selectLspServer } from './config.js';

export type LSPOperation = 'goToDefinition' | 'findReferences' | 'hover' | 'documentSymbol' | 'workspaceSymbol' | 'goToImplementation' | 'prepareCallHierarchy' | 'incomingCalls' | 'outgoingCalls';

export interface LSPRequest {
  operation: LSPOperation;
  filePath: string;
  line?: number;
  character?: number;
  query?: string;
  server?: string;
}

export async function executeLspRequest(request: LSPRequest, cwd: string, config: PlatformConfig): Promise<unknown> {
  const path = protectPath(resolve(cwd, request.filePath), config);
  const [name, server] = selectLspServer(config, path, request.server);
  const client = new LSPClient();
  await client.connect(name, server, cwd, config);
  try {
    const document = await client.openDocument(path, server.languageId);
    const position = { line: Math.max(0, (request.line ?? 1) - 1), character: Math.max(0, (request.character ?? 1) - 1) };
    const textDocument = { uri: document.uri };
    switch (request.operation) {
      case 'goToDefinition': return await client.request('textDocument/definition', { textDocument, position });
      case 'findReferences': return await client.request('textDocument/references', { textDocument, position, context: { includeDeclaration: true } });
      case 'hover': return await client.request('textDocument/hover', { textDocument, position });
      case 'documentSymbol': return await client.request('textDocument/documentSymbol', { textDocument });
      case 'workspaceSymbol': return await client.request('workspace/symbol', { query: request.query ?? '' });
      case 'goToImplementation': return await client.request('textDocument/implementation', { textDocument, position });
      case 'prepareCallHierarchy': return await client.request('textDocument/prepareCallHierarchy', { textDocument, position });
      case 'incomingCalls':
      case 'outgoingCalls': {
        const prepared = await client.request('textDocument/prepareCallHierarchy', { textDocument, position });
        const item = Array.isArray(prepared) ? prepared[0] : prepared;
        if (!item) return [];
        return await client.request(`callHierarchy/${request.operation}`, { item });
      }
    }
  } finally {
    await client.close();
  }
}
