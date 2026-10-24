// Test-only local hook: the first Stop requests one more turn.
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => { input += part; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input), path = process.argv[2];
  const prior = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
  fs.appendFileSync(path, JSON.stringify(payload) + '\n');
  if (payload.hook_event_name === 'Stop' && !prior.includes('"hook_event_name":"Stop"')) {
    process.stderr.write('Fixture quality gate: verify once more before completion.');
    process.exitCode = 2;
  } else process.stdout.write('{}');
});
