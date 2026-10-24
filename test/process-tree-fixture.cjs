const { spawn } = require('node:child_process');
if (process.argv.includes('--grandchild')) {
  const heartbeat = setInterval(() => {}, 1000);
  setTimeout(() => { clearInterval(heartbeat); process.exit(0); }, 10000); // Fixture self-cleanup even on a failed assertion.
} else {
  const child = spawn(process.execPath, [__filename, '--grandchild'], { windowsHide: true, stdio: 'ignore' });
  process.stdout.write(JSON.stringify({ parent: process.pid, grandchild: child.pid }) + '\n');
  setInterval(() => {}, 1000);
}
