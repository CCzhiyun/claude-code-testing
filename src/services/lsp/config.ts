import { extname, resolve } from 'node:path';
import type { LspServerConfig, PlatformConfig } from '../../types.js';

export function selectLspServer(config: PlatformConfig, filePath: string, requestedName?: string): [string, LspServerConfig] {
  if (requestedName) {
    const requested = config.lspServers[requestedName];
    if (!requested) throw new Error(`Unknown LSP server: ${requestedName}`);
    return [requestedName, requested];
  }
  const extension = extname(resolve(filePath)).toLowerCase();
  const match = Object.entries(config.lspServers).find(([, server]) => server.extensions.some((item) => item.toLowerCase() === extension));
  if (!match) throw new Error(`No LSP server is configured for ${extension || 'this file type'}`);
  return match;
}
