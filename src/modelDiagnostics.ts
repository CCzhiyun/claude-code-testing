import type { PlatformConfig } from './types.js';
import { modelAuthHeaders, resolveModelEndpoint, resolveModelProtocol, resolveModelWireProtocol } from './modelConnection.js';
import { readCaCertificates } from './network.js';
import { configForDisplay } from './configDisplay.js';
import { prepareModelCredential } from './protectedModelCredentials.js';

export async function modelDiagnostics(config: PlatformConfig): Promise<Array<{ check: string; ok: boolean; detail: string }>> {
  const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
  try { checks.push({ check: 'model endpoint', ok: true, detail: String(configForDisplay(resolveModelEndpoint(config.model))) }); }
  catch { checks.push({ check: 'model endpoint', ok: false, detail: 'Missing or invalid model endpoint URL' }); }
  try {
    await prepareModelCredential(config.model);
    const headers = modelAuthHeaders(config.model);
    checks.push({ check: 'model credential', ok: true, detail: Object.keys(headers).length ? 'configured (values hidden; not yet authenticated)' : 'not configured (allowed for local endpoints)' });
  } catch { checks.push({ check: 'model credential', ok: false, detail: 'The configured environment credential or protected endpoint-bound credential is unavailable' }); }
  try {
    const certs = config.network.caFile ? await readCaCertificates(config.network.caFile) : [];
    checks.push({ check: 'TLS / CA', ok: config.network.rejectUnauthorized, detail: `${certs.length ? `${certs.length} custom PEM certificates parsed` : 'system/Node trust store'}; verification ${config.network.rejectUnauthorized ? 'enabled' : 'DISABLED'}. Connectivity not tested.` });
  } catch { checks.push({ check: 'TLS / CA', ok: false, detail: 'Configured CA file could not be read or contains invalid certificates/private keys' }); }
  checks.push({ check: 'model protocol', ok: true, detail: resolveModelProtocol(config.model) });
  checks.push({ check: 'model wire transport', ok: true, detail: `${resolveModelWireProtocol(config.model)}${config.model.responsesTransport === 'chat-completions' ? ' (explicit Responses adapter; not native server support)' : ' (native)'}` });
  checks.push({ check: 'Chat tools / reasoning policy (configuration only)', ok: true, detail: `${config.model.chatToolReasoning ?? 'preserve'}; not a live capability test. Responses uses its own reasoning field. Use model test and the company acceptance guide.` });
  return checks;
}
