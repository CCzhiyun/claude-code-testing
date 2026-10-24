import type { PlatformConfig } from './types.js';
import { networkRequest } from './network.js';
import { modelAuthHeaders, resolveModelEndpoint, resolveModelProtocol } from './modelConnection.js';
import { authorizeModelEndpoint } from './model.js';
import { modelRequestError } from './modelErrors.js';
import { prepareModelCredential } from './protectedModelCredentials.js';

/** Explicit CLI operations only: no automatic remote deletion on local compaction. */
export async function responseRecord(config: PlatformConfig, id: string, method: 'GET' | 'DELETE'): Promise<unknown> {
  await prepareModelCredential(config.model);
  if (resolveModelProtocol(config.model) !== 'responses') throw new Error('Select the responses API protocol first');
  if (config.model.responsesTransport === 'chat-completions') throw new Error('Bridge response IDs are local projections, not stored server records');
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(id)) throw new Error('Invalid response ID');
  const url = new URL(resolveModelEndpoint(config.model));
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${id}`;
  authorizeModelEndpoint(config, url.href);
  const response = await networkRequest(url.href, { method, headers: modelAuthHeaders(config.model, false), maxResponseBytes: 32 * 1024 * 1024 }, config.network);
  if (response.status < 200 || response.status >= 300) throw modelRequestError(response.status, response.text);
  return response.text ? JSON.parse(response.text) as unknown : { id, deleted: method === 'DELETE' };
}
