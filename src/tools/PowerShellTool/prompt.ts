export function getDefaultTimeoutMs(): number { return 120_000; }
export function getMaxTimeoutMs(): number { return 600_000; }
export async function getPrompt(): Promise<string> { return 'Runs one allowlisted executable using PowerShell-style quoting without evaluating a PowerShell script. Pipelines, substitutions and compound statements are rejected.'; }
