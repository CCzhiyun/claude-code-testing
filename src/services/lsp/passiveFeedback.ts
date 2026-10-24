import { fileURLToPath } from 'node:url';
import type { Diagnostic, DiagnosticFile } from '../diagnosticTracking.js';
import { registerPendingLSPDiagnostic } from './LSPDiagnosticRegistry.js';
import type { LSPServerManager } from './LSPServerManager.js';

type PublishDiagnosticsParams = { uri: string; diagnostics: Array<{ message: string; severity?: number; range: Diagnostic['range']; source?: string; code?: string | number }> };
const severity = (value?: number): Diagnostic['severity'] => value === 2 ? 'Warning' : value === 3 ? 'Info' : value === 4 ? 'Hint' : 'Error';
export function formatDiagnosticsForAttachment(params: PublishDiagnosticsParams): DiagnosticFile[] {
  let uri = params.uri; try { if (uri.startsWith('file://')) uri = fileURLToPath(uri); } catch { /* Preserve malformed server URI. */ }
  return [{ uri, diagnostics: params.diagnostics.map((item) => ({ message: item.message, severity: severity(item.severity), range: item.range, ...(item.source ? { source: item.source } : {}), ...(item.code !== undefined ? { code: String(item.code) } : {}) })) }];
}
export type HandlerRegistrationResult = { totalServers: number; successCount: number; registrationErrors: Array<{ serverName: string; error: string }>; diagnosticFailures: Map<string, { count: number; lastError: string }> };
export function registerLSPNotificationHandlers(manager: LSPServerManager): HandlerRegistrationResult {
  const servers = manager.getAllServers(); const registrationErrors: Array<{ serverName: string; error: string }> = []; const diagnosticFailures = new Map<string, { count: number; lastError: string }>(); let successCount = 0;
  for (const [serverName, server] of servers) {
    try { server.onNotification('textDocument/publishDiagnostics', (params) => { try { for (const file of formatDiagnosticsForAttachment(params as PublishDiagnosticsParams)) registerPendingLSPDiagnostic(file, serverName); diagnosticFailures.delete(serverName); } catch (error) { const message = error instanceof Error ? error.message : String(error); const old = diagnosticFailures.get(serverName)?.count ?? 0; diagnosticFailures.set(serverName, { count: old + 1, lastError: message }); } }); successCount += 1; }
    catch (error) { registrationErrors.push({ serverName, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { totalServers: servers.size, successCount, registrationErrors, diagnosticFailures };
}
