let buffer = Buffer.alloc(0);

function send(message: unknown): void {
  const body = Buffer.from(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf('\r\n\r\n');
    if (separator < 0) return;
    const headers = buffer.subarray(0, separator).toString('ascii');
    const match = headers.match(/Content-Length:\s*(\d+)/i);
    if (!match?.[1]) return;
    const length = Number(match[1]);
    if (buffer.length < separator + 4 + length) return;
    const body = buffer.subarray(separator + 4, separator + 4 + length).toString('utf8');
    buffer = buffer.subarray(separator + 4 + length);
    const request = JSON.parse(body) as { id?: number; method: string };
    if (request.id === undefined) {
      if (request.method === 'exit') process.exit(0);
      continue;
    }
    const result = request.method === 'initialize'
      ? { capabilities: { hoverProvider: true } }
      : request.method === 'textDocument/hover'
        ? { contents: { kind: 'markdown', value: '`fixture: string`' } }
        : null;
    send({ jsonrpc: '2.0', id: request.id, result });
  }
});
