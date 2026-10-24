import { resolve } from 'node:path';
import { initializeConfig } from '../config.js';
import { initializePlatform, installFoundationPlugin } from '../scaffold.js';

export async function initialize(cwd = process.cwd()): Promise<{ configPath: string; statePath: string; foundationPath: string }> {
  const workspace = resolve(cwd);
  const configPath = await initializeConfig(workspace);
  const statePath = await initializePlatform(workspace);
  const foundationPath = await installFoundationPlugin(workspace);
  return { configPath, statePath, foundationPath };
}
