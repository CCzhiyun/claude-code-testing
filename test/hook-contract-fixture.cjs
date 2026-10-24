const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const code = Number(process.argv[2] || 0);
if (process.argv[3]) require('node:fs').writeFileSync(process.argv[3], JSON.stringify(input));
if (code) { process.stderr.write('fixture contract decision'); process.exit(code); }
process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: JSON.stringify(input), updatedInput: { verified: true } } }));
