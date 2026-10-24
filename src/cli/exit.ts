export class CliExit extends Error { constructor(readonly exitCode: number, message: string) { super(message); this.name = 'CliExit'; } }
export function exitCodeFor(error: unknown): number { if (error instanceof CliExit) return error.exitCode; const code = (error as NodeJS.ErrnoException | undefined)?.code; return code === 'EACCES' || code === 'EPERM' ? 3 : code === 'ENOENT' ? 4 : 1; }
