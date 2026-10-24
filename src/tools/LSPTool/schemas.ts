import type { LSPOperation, LSPRequest } from '../../services/lsp/manager.js';

export const lspOperations: LSPOperation[] = ['goToDefinition', 'findReferences', 'hover', 'documentSymbol', 'workspaceSymbol', 'goToImplementation', 'prepareCallHierarchy', 'incomingCalls', 'outgoingCalls'];

export function parseLspInput(input: Record<string, unknown>): LSPRequest {
  const operation = String(input.operation ?? '') as LSPOperation;
  if (!lspOperations.includes(operation)) throw new Error(`Invalid LSP operation: ${operation}`);
  if (typeof input.file_path !== 'string' || !input.file_path) throw new Error('file_path must be a non-empty string');
  const line = input.line === undefined ? 1 : Number(input.line);
  const character = input.character === undefined ? 1 : Number(input.character);
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) throw new Error('line and character must be positive 1-based integers');
  return {
    operation,
    filePath: input.file_path,
    line,
    character,
    ...(typeof input.query === 'string' ? { query: input.query } : {}),
    ...(typeof input.server === 'string' ? { server: input.server } : {}),
  };
}
