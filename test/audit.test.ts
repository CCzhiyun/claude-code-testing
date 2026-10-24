import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { audit, readAudit } from '../src/audit.js';

let root = '';
let previousHome: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccpt-audit-'));
  previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = root;
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  delete process.env.TEST_AUDIT_TOKEN;
  await rm(root, { recursive: true, force: true });
});

describe('enterprise audit log', () => {
  test('redacts sensitive keys, authorization values, URL credentials, and environment secrets', async () => {
    process.env.TEST_AUDIT_TOKEN = 'audit-secret-value';
    await audit({
      event: 'security.test',
      outcome: 'success',
      details: {
        authorization: 'Bearer direct-secret',
        command: 'tool --token audit-secret-value https://user:pass@example.test/path',
      },
    });
    const contents = await readAudit();
    expect(contents).not.toContain('direct-secret');
    expect(contents).not.toContain('audit-secret-value');
    expect(contents).not.toContain('user:pass');
    expect(contents).toContain('[redacted]');
  });
});
