import { spawn, type ChildProcess } from 'node:child_process';
let inhibitor: ChildProcess | undefined;
export function startPreventSleep(): boolean { if (inhibitor) return true; const command = process.platform === 'darwin' ? 'caffeinate' : process.platform === 'linux' ? 'systemd-inhibit' : undefined; if (!command) return false; const args = process.platform === 'darwin' ? ['-dims'] : ['--what=sleep', '--why=CCPT active task', '--mode=block', 'sleep', 'infinity']; try { inhibitor = spawn(command, args, { stdio: 'ignore', windowsHide: true }); inhibitor.unref(); inhibitor.once('exit', () => { inhibitor = undefined; }); return true; } catch { inhibitor = undefined; return false; } }
export function stopPreventSleep(): void { inhibitor?.kill(); inhibitor = undefined; }
