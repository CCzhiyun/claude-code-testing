export interface WorkSecret {
  version: 1;
  sessionIngressToken: string;
  apiBaseUrl: string;
  sessionId?: string;
}

export function decodeWorkSecret(encoded: string): WorkSecret {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown; }
  catch { throw new Error('Work secret is not valid base64url JSON'); }
  if (!value || typeof value !== 'object') throw new Error('Work secret must be an object');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.session_ingress_token !== 'string' || !record.session_ingress_token) throw new Error('Unsupported or malformed work secret');
  if (typeof record.api_base_url !== 'string') throw new Error('Work secret is missing api_base_url');
  const base = new URL(record.api_base_url);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Work secret api_base_url must use HTTP(S)');
  return {
    version: 1,
    sessionIngressToken: record.session_ingress_token,
    apiBaseUrl: base.href,
    ...(typeof record.session_id === 'string' ? { sessionId: record.session_id } : {}),
  };
}

export function buildBridgeWebSocketUrl(secret: WorkSecret, path = '/v2/sessions/connect'): string {
  const url = new URL(path, secret.apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export function sameSessionId(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/^session:/, '').trim().toLowerCase();
  return normalize(left) === normalize(right);
}
