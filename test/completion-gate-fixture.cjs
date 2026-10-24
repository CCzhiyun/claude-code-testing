// Controlled, local quality-gate fixture. No credentials or network access.
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const mode = process.argv[2];
  if (mode === 'stop') {
    process.stdout.write(JSON.stringify({ continue: false, stopReason: 'Operator must inspect quality evidence' }));
    return;
  }
  if (mode === 'delay-block') {
    setTimeout(() => { process.stderr.write('Concurrent gate must not be skipped'); process.exitCode = 2; }, 150);
    return;
  }
  const marker = path.join(process.cwd(), `gate-${payload.agent_id ?? 'tool'}-${payload.hook_event_name ?? 'test'}.json`);
  const existed = fs.existsSync(marker);
  fs.writeFileSync(marker, JSON.stringify(payload));
  if (mode === 'always-block' || mode === 'block-first' && !existed) {
    process.stderr.write('Quality evidence missing: verify the implementation before completing');
    process.exitCode = 2;
  } else process.stdout.write('{}');
});
