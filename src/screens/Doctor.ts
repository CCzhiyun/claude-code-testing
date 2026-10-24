import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { loadConfig } from '../config.js';
import { loadPlatform } from '../platform.js';
import { checkVoiceDependencies } from '../services/voice.js';

export interface DoctorCheck { id: string; ok: boolean; detail: string; severity: 'required' | 'optional' }
export interface DoctorReport { ok: boolean; cwd: string; checks: DoctorCheck[] }
export async function runDoctorScreen(cwd = process.cwd()): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  try { await access(cwd, constants.R_OK | constants.W_OK); checks.push({ id: 'workspace', ok: true, detail: 'Workspace is readable and writable', severity: 'required' }); } catch (error) { checks.push({ id: 'workspace', ok: false, detail: error instanceof Error ? error.message : String(error), severity: 'required' }); }
  try { const config = await loadConfig(cwd); checks.push({ id: 'configuration', ok: true, detail: `${config.policy.mode} policy · ${config.model.name}`, severity: 'required' }); } catch (error) { checks.push({ id: 'configuration', ok: false, detail: error instanceof Error ? error.message : String(error), severity: 'required' }); }
  try { const platform = await loadPlatform(cwd); const errors = platform.diagnostics.filter((item) => item.severity === 'error'); checks.push({ id: 'extensions', ok: errors.length === 0, detail: `${platform.plugins.length} plugins · ${platform.skills.length} skills · ${platform.agents.length} agents · ${errors.length} errors`, severity: 'required' }); } catch (error) { checks.push({ id: 'extensions', ok: false, detail: error instanceof Error ? error.message : String(error), severity: 'required' }); }
  const voice = await checkVoiceDependencies(); checks.push({ id: 'voice', ok: voice.available, detail: voice.available ? 'Recording dependency available' : voice.missing.join(', '), severity: 'optional' });
  return { ok: checks.every((item) => item.severity === 'optional' || item.ok), cwd, checks };
}
export function renderDoctorReport(report: DoctorReport): string[] { return [`CCPT Doctor · ${report.ok ? 'ready' : 'action required'}`, ...report.checks.map((item) => `${item.ok ? '✓' : item.severity === 'optional' ? '○' : '×'} ${item.id}: ${item.detail}`)]; }
