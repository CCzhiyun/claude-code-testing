export const isInteractiveTerminal = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);
export function formatShortcut(keys: string[]): string { return keys.map((key) => key.length === 1 ? key.toUpperCase() : key.replace(/^./, (value) => value.toUpperCase())).join('+'); }
