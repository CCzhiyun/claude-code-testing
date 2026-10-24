import { createHash } from 'node:crypto';
export interface XaaSubjectToken { subjectToken: string; subjectTokenType: string; audience: string }
export function buildXaaExchange(subjectToken: string, audience: string): XaaSubjectToken { if (!subjectToken || !audience) throw new Error('XAA token and audience are required'); return { subjectToken, subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token', audience }; }
export const xaaTokenFingerprint = (token: string): string => createHash('sha256').update(token).digest('base64url').slice(0, 16);
