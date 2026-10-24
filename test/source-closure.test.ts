import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CoverageRow { reference: string; status: 'implemented' | 'partial' | 'missing' | 'integration-required'; implementation: string[]; note: string }
interface CoverageReport { totals: { total: number; implemented: number; partial: number; missing: number; 'integration-required': number }; files: CoverageRow[] }

describe('final reference source closure', () => {
  test('has no unclassified, partial, or missing reference source files', async () => {
    const report = JSON.parse(await readFile(join(import.meta.dir, '..', 'docs', 'SOURCE-COVERAGE.json'), 'utf8')) as CoverageReport;
    expect(report.totals).toMatchObject({ total: 1902, partial: 0, missing: 0 });
    expect(report.totals.implemented + report.totals['integration-required']).toBe(report.totals.total);
    expect(report.files.filter((row) => row.status === 'partial' || row.status === 'missing')).toEqual([]);
  });

  test('requires every external source boundary to name evidence and a concrete integration reason', async () => {
    const report = JSON.parse(await readFile(join(import.meta.dir, '..', 'docs', 'SOURCE-COVERAGE.json'), 'utf8')) as CoverageReport;
    const external = report.files.filter((row) => row.status === 'integration-required');
    expect(external.length).toBe(report.totals['integration-required']);
    expect(external.length).toBeGreaterThan(0);
    for (const row of external) {
      expect(row.implementation.length).toBeGreaterThan(0);
      expect(row.note.length).toBeGreaterThan(20);
      expect(row.note).toMatch(/require|host|provider|service|adapter|control plane|wrapper/i);
    }
  });
});
