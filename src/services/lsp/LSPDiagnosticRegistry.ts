import type { DiagnosticFile } from '../diagnosticTracking.js';

export type PendingLSPDiagnostic = { file: DiagnosticFile; serverName: string; receivedAt: number };
const pending = new Map<string, PendingLSPDiagnostic>();
const delivered = new Map<string, Set<string>>();
const keyFor = (file: DiagnosticFile): string => file.uri.replaceAll('\\', '/').toLowerCase();
const diagnosticId = (value: DiagnosticFile['diagnostics'][number]): string => `${value.severity}:${value.range.start.line}:${value.range.start.character}:${value.message}`;

export function registerPendingLSPDiagnostic(file: DiagnosticFile, serverName = 'lsp'): void {
  pending.set(keyFor(file), { file: structuredClone(file), serverName, receivedAt: Date.now() });
}

export function checkForLSPDiagnostics(): Array<{ file: DiagnosticFile; serverName: string }> {
  const output: Array<{ file: DiagnosticFile; serverName: string }> = [];
  for (const [key, item] of pending) {
    const already = delivered.get(key) ?? new Set<string>();
    const diagnostics = item.file.diagnostics.filter((diagnostic) => !already.has(diagnosticId(diagnostic)));
    if (diagnostics.length) {
      output.push({ file: { ...item.file, diagnostics: structuredClone(diagnostics) }, serverName: item.serverName });
      for (const diagnostic of diagnostics) already.add(diagnosticId(diagnostic));
      delivered.set(key, already);
    }
  }
  pending.clear();
  return output;
}

export function clearAllLSPDiagnostics(): void { pending.clear(); }
export function resetAllLSPDiagnosticState(): void { pending.clear(); delivered.clear(); }
export function clearDeliveredDiagnosticsForFile(fileUri: string): void { delivered.delete(keyFor({ uri: fileUri, diagnostics: [] })); }
export function getPendingLSPDiagnosticCount(): number { return pending.size; }
