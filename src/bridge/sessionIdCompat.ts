export function canonicalSessionId(value: string): string {
  const normalized = value.trim().replace(/^(?:session|sess):/i, '');
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(normalized)) throw new Error('Invalid session ID');
  return normalized;
}

export function sessionIdsEqual(left: string, right: string): boolean {
  return canonicalSessionId(left).toLowerCase() === canonicalSessionId(right).toLowerCase();
}
