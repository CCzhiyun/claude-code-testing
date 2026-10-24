import { join } from 'node:path';
import { homeStateDir } from '../../paths.js';
import { readJson, writeJson } from '../../storage.js';
interface TipHistory { session: number; shown: Record<string, number> }
const path = () => join(homeStateDir(), 'tip-history.json');
export const readTipHistory = (): Promise<TipHistory> => readJson(path(), { session: 0, shown: {} });
export const writeTipHistory = (history: TipHistory): Promise<void> => writeJson(path(), history);
