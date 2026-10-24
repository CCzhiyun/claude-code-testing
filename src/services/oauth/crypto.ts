import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const generateCodeVerifier = (): string => randomBytes(32).toString('base64url');
export const generateCodeChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');
export const generateState = (): string => randomBytes(32).toString('base64url');
export function verifyState(actual: string, expected: string): boolean { const left = Buffer.from(actual), right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }
