import { scanSecrets } from './secretScanner.js';
export function assertTeamMemorySafe(content: string): void { const findings = scanSecrets(content); if (findings.length) throw new Error(`Team memory contains ${findings.length} possible secret(s): ${[...new Set(findings.map((finding) => finding.type))].join(', ')}`); }
export function redactTeamMemorySecrets(content: string): string { let output = content; for (const finding of scanSecrets(content).reverse()) output = `${output.slice(0, finding.start)}[redacted:${finding.type}]${output.slice(finding.end)}`; return output; }
