import { expect, test } from 'bun:test';
import { retrySharingViolation } from '../src/storage.js';

test('Windows transient sharing violations are retried without returning fallback data', async () => {
  let attempts = 0;
  const value = await retrySharingViolation(async () => { attempts++; if (attempts < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' }); return 'verified bytes'; }, 'win32');
  expect(value).toBe('verified bytes'); expect(attempts).toBe(3);
});

test('permanent denied access stays an error after a bounded retry budget', async () => {
  let attempts = 0; const error = Object.assign(new Error('access denied'), { code: 'EACCES' });
  let observed: unknown;
  try { await retrySharingViolation(async () => { attempts++; throw error; }, 'win32'); } catch (failure) { observed = failure; }
  expect(observed).toBe(error); expect(attempts).toBe(8);
});

test('missing/invalid paths and non-Windows failures are never hidden or retried', async () => {
  for (const [code, platform] of [['ENOENT', 'win32'], ['EINVAL', 'win32'], ['EPERM', 'linux']] as const) {
    let attempts = 0; const error = Object.assign(new Error(code), { code }); let observed: unknown;
    try { await retrySharingViolation(async () => { attempts++; throw error; }, platform); } catch (failure) { observed = failure; }
    expect(observed).toBe(error); expect(attempts).toBe(1);
  }
});
