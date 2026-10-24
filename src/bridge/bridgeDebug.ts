import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
import { redactBridgeDebug } from './debugUtils.js';

export async function bridgeDebug(event: string, details: Record<string, unknown> = {}): Promise<void> {
  const directory = join(homeStateDir(), 'bridge-debug');
  await mkdir(directory, { recursive: true });
  const line = JSON.stringify(redactBridgeDebug({ timestamp: new Date().toISOString(), event, details }));
  await appendFile(join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${line}\n`, { mode: 0o600 });
}
