/** Piped import avoids command-line secrets and persistent environment variables. */
export async function readCredentialInput(input: AsyncIterable<Uint8Array | string> & { isTTY?: boolean } = process.stdin): Promise<string> {
  if (input.isTTY) throw new Error('Pipe the credential through stdin; interactive visible input is not supported');
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    for await (const chunk of input) {
      const value = Buffer.from(chunk); chunks.push(value); bytes += value.length;
      if (bytes > 16000) throw new Error('Credential input exceeds 16000 bytes');
    }
    const buffer = Buffer.concat(chunks);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/\r?\n$/, ''); }
    finally { buffer.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}
