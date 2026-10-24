import { decodeWorkSecret, type WorkSecret } from './workSecret.js';

export interface EnvLessBridgeConfig { secret: WorkSecret; websocketUrl: string }

export function parseEnvLessBridgeConfig(encodedSecret: string): EnvLessBridgeConfig {
  const secret = decodeWorkSecret(encodedSecret);
  const url = new URL('/v2/sessions/connect', secret.apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return { secret, websocketUrl: url.href };
}
