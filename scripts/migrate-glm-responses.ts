import { readFile, writeFile, copyFile, chmod, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { migrateGlmResponsesSettings } from '../src/responsesSettingsMigration.js';
import { defaultConfig, mergeConfig, validateConfig } from '../src/config.js';

const args = process.argv.slice(2), index = args.indexOf('--settings');
const path = index < 0 ? resolve(process.env.CCPT_HOME || resolve(homedir(), '.ccpt'), 'settings.json') : resolve(args[index + 1]!);
const original = await readFile(path, 'utf8');
const migrated = migrateGlmResponsesSettings(JSON.parse(original));
validateConfig(mergeConfig(structuredClone(defaultConfig), migrated));
if (args.includes('--apply')) {
  const backup = `${path}.pre-responses-${randomUUID()}.bak`;
  await copyFile(path, backup, constants.COPYFILE_EXCL); await chmod(backup, 0o600);
  await writeFile(path, `${JSON.stringify(migrated, null, 2)}\n`, { mode: 0o600 }); await chmod(path, 0o600);
  console.log(JSON.stringify({ migrated: true, settings: path, backup, model: (migrated.model as any).name, protocol: 'responses', transport: 'chat-completions', nativeResponsesVerified: false }));
} else console.log(JSON.stringify({ dryRun: true, settings: path, protocol: 'responses', transport: 'chat-completions', credentials: 'values hidden; use --apply to save with backup' }));
