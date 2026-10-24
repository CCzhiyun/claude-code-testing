import { initializeConfig } from './config.js';
import { initializePlatform, installFoundationPlugin } from './scaffold.js';
export async function setup(cwd: string): Promise<{ configPath: string; platformPath: string; foundationPath: string }> { const [configPath, platformPath, foundationPath] = await Promise.all([initializeConfig(cwd), initializePlatform(cwd), installFoundationPlugin(cwd)]); return { configPath, platformPath, foundationPath }; }
