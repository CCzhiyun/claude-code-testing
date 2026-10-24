import { computePluginDigest, validatePlugin } from '../../plugins.js';
export async function handlePlugin(action: 'validate' | 'hash', path: string): Promise<unknown> { return action === 'validate' ? validatePlugin(path) : computePluginDigest(path); }
