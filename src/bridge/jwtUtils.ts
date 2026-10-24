import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtClaims {
  iss: string;
  aud: string;
  sub?: string;
  jti: string;
  iat: number;
  exp: number;
  nbf?: number;
  [key: string]: unknown;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCanonical(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Malformed JWT encoding');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('Malformed JWT encoding');
  return decoded;
}

export function signJwt(claims: JwtClaims, secret: string): string {
  if (Buffer.byteLength(secret) < 32) throw new Error('JWT secret must be at least 32 bytes');
  validateClaims(claims, claims.iss, claims.aud, Math.floor(Date.now() / 1000), false);
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyJwt(token: string, secret: string, expected: { issuer: string; audience: string; now?: number }): JwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('Malformed JWT');
  let header: Record<string, unknown>;
  let claims: JwtClaims;
  try {
    header = JSON.parse(decodeCanonical(parts[0]).toString('utf8')) as Record<string, unknown>;
    claims = JSON.parse(decodeCanonical(parts[1]).toString('utf8')) as JwtClaims;
  } catch { throw new Error('Malformed JWT encoding'); }
  if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Unsupported JWT header');
  const expectedSignature = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let actualSignature: Buffer;
  try { actualSignature = decodeCanonical(parts[2]); }
  catch { throw new Error('Invalid JWT signature'); }
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) throw new Error('Invalid JWT signature');
  validateClaims(claims, expected.issuer, expected.audience, expected.now ?? Math.floor(Date.now() / 1000), true);
  return claims;
}

function validateClaims(claims: JwtClaims, issuer: string, audience: string, now: number, checkTime: boolean): void {
  if (!claims || typeof claims !== 'object' || claims.iss !== issuer || claims.aud !== audience) throw new Error('Invalid JWT issuer or audience');
  if (typeof claims.jti !== 'string' || !claims.jti || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) throw new Error('JWT is missing required claims');
  if (claims.exp <= claims.iat || claims.exp - claims.iat > 24 * 60 * 60) throw new Error('JWT lifetime is invalid');
  if (checkTime && (claims.exp <= now || claims.iat > now + 60 || (claims.nbf !== undefined && claims.nbf > now + 60))) throw new Error('JWT is expired or not active');
}
