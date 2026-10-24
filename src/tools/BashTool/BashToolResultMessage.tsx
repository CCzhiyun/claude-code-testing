import type { Out } from './BashTool.js';
export function BashToolResultMessage(output: Out): string { return [output.stdout.trim(), output.stderr.trim()].filter(Boolean).join('\n') || `Exited with code ${output.code}`; }
