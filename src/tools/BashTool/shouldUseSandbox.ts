export type SandboxInput = { command?: string; dangerouslyDisableSandbox?: boolean; permissionMode?: string };
export function shouldUseSandbox(input: Partial<SandboxInput>): boolean { return !input.dangerouslyDisableSandbox && input.permissionMode !== 'bypass'; }
