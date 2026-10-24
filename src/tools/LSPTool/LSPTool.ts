import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const LSPTool: ToolDefinition = buildTool({
  name: 'lsp',
  description: 'Query a configured language server for definitions, references, hover details, symbols, implementations, and call hierarchy.',
  input_schema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol', 'workspaceSymbol', 'goToImplementation', 'prepareCallHierarchy', 'incomingCalls', 'outgoingCalls'] },
      file_path: { type: 'string' }, line: { type: 'number' }, character: { type: 'number' }, query: { type: 'string' }, server: { type: 'string' },
    },
    required: ['operation', 'file_path'],
  },
});
