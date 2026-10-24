import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PlatformConfig } from './types.js';
import { modelDiagnostics } from './modelDiagnostics.js';
import { configForDisplay } from './configDisplay.js';
import { resolveModelEndpoint, resolveModelProtocol, resolveModelWireProtocol } from './modelConnection.js';
import { protectPath } from './policy.js';
import { protectedModelKey } from './modelCredentialState.js';
import { modelCredentialScope } from './protectedModelCredentials.js';
import {listModelErrors,modelErrorLogPath} from './modelErrorLog.js';

/** Allowlisted local diagnostics, never raw config/env/transcripts/keys/CA bytes. */
export async function diagnosticBundle(config: PlatformConfig, version: string): Promise<unknown> {
  let endpoint: unknown = 'invalid';
  try { endpoint = configForDisplay(resolveModelEndpoint(config.model)); } catch { /* no raw invalid value */ }
  const checks = await modelDiagnostics(config);
  let recentModelErrors:unknown;
  try{recentModelErrors={path:modelErrorLogPath(),entries:await listModelErrors(10)};}catch{recentModelErrors={unavailable:true,detail:'Diagnostic log could not be read; original bytes preserved'};}
  let key: string | undefined;
  if (config.model.credentialRef) { try { key = protectedModelKey(config.model, modelCredentialScope(config.model)); } catch { /* invalid endpoint already reported */ } }
  return configForDisplay({ schemaVersion: 1, app: 'CCPT', version, createdAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    model: { name: config.model.name, protocol: resolveModelProtocol(config.model), transport: resolveModelWireProtocol(config.model), endpoint, credentialSource: config.model.credentialRef ? 'protected-vault' : 'environment-or-header' },
    network: { certificateConfigured: Boolean(config.network.caFile), verificationEnabled: config.network.rejectUnauthorized },
    permissionMode: config.policy.mode, checks, recentModelErrors,
    excluded: ['environment values', 'authentication headers', 'credential values', 'CA/private-key bytes', 'conversation', 'source files', 'tool results', 'raw audit logs'],
  }, key ? [key] : []);
}
export async function exportDiagnosticBundle(cwd: string, target: string, config: PlatformConfig, version: string): Promise<string> {
  const path = protectPath(resolve(cwd, target), config);
  await writeFile(path, JSON.stringify(await diagnosticBundle(config, version), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return path;
}
