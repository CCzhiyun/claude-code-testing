import { runTui } from './tui.js';
export const launchRepl = (cwd: string, version: string): Promise<void> => runTui(cwd, version);
