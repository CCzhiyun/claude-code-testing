import type { PermissionMode } from '../types.js';
export interface SandboxProcessWrapper { command: string; args?: string[] }
export interface SandboxConfiguration { mode: Extract<PermissionMode, 'sandbox' | 'restricted'>; workspaceRoots: string[]; allowedCommands: string[]; allowedEnvironmentVariables: string[]; processWrapper?: SandboxProcessWrapper }
export interface SandboxExecutionRequest { executable: string; args: string[]; cwd: string; environment: Record<string, string>; timeoutMs: number }
export interface SandboxExecutionResult { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function assertSandboxConfiguration(value: SandboxConfiguration): void { if (!['sandbox', 'restricted'].includes(value.mode)) throw new Error('Sandbox mode must be sandbox or restricted'); if (!value.workspaceRoots.length) throw new Error('Sandbox requires at least one workspace root'); if (value.mode === 'sandbox' && !value.processWrapper?.command) throw new Error('Sandbox mode requires a process wrapper'); }
