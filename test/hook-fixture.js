const mode = process.argv[2];
if (mode === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason: 'fixture blocked' }));
else if (mode === 'context') process.stdout.write(JSON.stringify({ additionalContext: 'fixture context' }));
else process.stdout.write('{}');
