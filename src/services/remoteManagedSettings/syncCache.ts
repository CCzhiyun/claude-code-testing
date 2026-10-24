import { join } from 'node:path';
import { homeStateDir } from '../../paths.js';
import { readJson, writeJson } from '../../storage.js';
import type { RemoteManagedSettingsCache } from './types.js';
const cachePath = () => join(homeStateDir(), 'remote-managed-settings.json');
export const readManagedSettingsCache = (): Promise<RemoteManagedSettingsCache | undefined> => readJson(cachePath(), undefined);
export const writeManagedSettingsCache = (cache: RemoteManagedSettingsCache): Promise<void> => writeJson(cachePath(), cache);
