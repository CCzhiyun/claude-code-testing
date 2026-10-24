const { createInterface } = require('node:readline');
let capabilities = {}, parent, count = 0;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') { capabilities = message.params.capabilities; send({ id: message.id, result: { protocolVersion: process.argv.includes('--modern') ? '2025-11-25' : '2025-06-18', capabilities: {}, serverInfo: { name: 'interaction-fixture', version: '1' } } }); }
  else if (message.method === 'tools/call') {
    parent = message.id;
    const args = message.params.arguments || {};
    if (args.rawResponse) { send({ ...args.rawResponse, id: message.id }); return; }
    if (args.oversize) {
      // Respect pipe backpressure while delivering a frame beyond the limit.
      let chunks = 64;
      const write = () => { if (!chunks--) { process.stdout.write('\n'); return; } process.stdout.write('x'.repeat(16000), () => setImmediate(write)); };
      write(); return;
    }
    const reverse = args.reverse || { method: 'sampling/createMessage', params: { messages: [{ role: 'user', content: { type: 'text', text: 'SAMPLE-FIXTURE-ONLY' } }], maxTokens: 64 } };
    // Intentionally collides with the originating client request ID.
    send({ id: message.id, ...reverse });
    if (args.endEarly) setTimeout(() => send({ id: parent, result: { closedEarly: true } }), 20);
  } else if (!message.method && message.id !== undefined) {
    count++;
    send({ id: parent, result: { reverse: message, capabilities, count } });
  }
});
