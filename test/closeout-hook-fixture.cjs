let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const mode = process.argv[2];
  if (mode === 'nested-deny') process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'Fixture policy denies this action' } }));
  else if (mode === 'nested-input') process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: 'Nested context', updatedInput: { limit: 5 } } }));
  else process.stdout.write(JSON.stringify({ additionalContext: JSON.stringify({ event: payload.hook_event_name, session: payload.session_id, agent: payload.agent_id, cwd: payload.cwd }) }));
});
