export function getDefaultTimeoutMs(): number { return 120_000; }
export function getMaxTimeoutMs(): number { return 600_000; }
export function getSimplePrompt(): string { return 'Runs one allowlisted executable with parsed arguments. Shell operators, redirections and compound commands are rejected by enterprise policy.'; }
export async function getPrompt(): Promise<string> { return getSimplePrompt(); }
