export function isGitInternalPathPS(arg: string): boolean { return /(?:^|[\\/])\.git(?:[\\/]|$)/i.test(arg.replace(/^['"]|['"]$/g, '')); }
export function isDotGitPathPS(arg: string): boolean { return isGitInternalPathPS(arg); }
