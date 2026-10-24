import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface SessionGitIdentity { repository: string; worktree: string; branch?: string }
const canonical = (value: string): string => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
export async function sessionGitIdentity(cwd: string): Promise<SessionGitIdentity | undefined> {
  try {
    const output = await new Promise<string>((ok, fail) => execFile('git', ['--no-optional-locks', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel', '--abbrev-ref', 'HEAD'], { windowsHide: true, timeout: 2000, maxBuffer: 65536 }, (error, stdout) => error ? fail(error) : ok(stdout)));
    const [common, tree, branch] = output.trim().split(/\r?\n/);
    if (!common || !tree) return undefined;
    return { repository: canonical(await realpath(common)), worktree: canonical(await realpath(tree)), ...(branch && branch !== 'HEAD' ? { branch } : {}) };
  } catch { return undefined; } // Non-Git folders, missing Git and unborn HEAD remain usable.
}
