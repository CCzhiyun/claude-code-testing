export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogOption { level?: LogLevel; file?: string; json?: boolean }
export interface StructuredLog { timestamp: string; level: LogLevel; message: string; context?: Record<string, unknown> }
