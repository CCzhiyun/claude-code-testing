import { StringDecoder } from 'node:string_decoder';
import { cancelAgent } from './agent.js';
import { runPrintTurn, type PrintOptions } from './printMode.js';

export type InputFrame = { type: 'user'; message: { role?: 'user'; content: string | Array<{ type: 'text'; text: string }> } } | { type: 'cancel' };
export async function* readInputFrames(input: AsyncIterable<Uint8Array | string>): AsyncGenerator<InputFrame> {
  const decoder = new StringDecoder('utf8'); let buffer = '';
  const parse = (line: string): InputFrame => {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Input frame exceeds 1 MiB');
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Input frame must be an object');
    const frame = value as InputFrame;
    if (frame.type === 'cancel') return frame;
    if (frame.type !== 'user' || !frame.message || frame.message.role && frame.message.role !== 'user') throw new Error('Input type must be user or cancel; role must be user');
    const content = frame.message.content;
    if (typeof content !== 'string' && (!Array.isArray(content) || !content.every((block) => block?.type === 'text' && typeof block.text === 'string'))) throw new Error('Stream input supports text user messages only');
    if (!(typeof content === 'string' ? content : content.map((part) => part.text).join('\n')).trim()) throw new Error('Input message must not be empty');
    return frame;
  };
  for await (const chunk of input) {
    buffer += decoder.write(Buffer.from(chunk));
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (line) yield parse(line);
    }
    if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error('Input frame exceeds 1 MiB');
  }
  buffer += decoder.end();
  if (buffer.trim()) yield parse(buffer.trim());
}

/** The input reader stays active during model/tool work, so cancel is not queued behind that work. */
export async function runPrintStream(options: Omit<PrintOptions, 'prompt'>, input: AsyncIterable<Uint8Array | string> = process.stdin): Promise<number> {
  let chain = Promise.resolve(); let activeId: string | undefined; let agentId: string | undefined;
  let pending = 0; let count = 0; let code = 0; let failure: unknown; let failureReported = false;
  const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  try {
    for await (const frame of readInputFrames(input)) {
      if (frame.type === 'cancel') {
        if (activeId) await cancelAgent(activeId);
        write({ type: 'control_result', schema_version: 1, action: 'cancel', active: Boolean(activeId) });
        continue;
      }
      if (++pending > 16) throw new Error('Input backlog exceeds 16 messages; wait for results before sending more');
      count++;
      const prompt = typeof frame.message.content === 'string' ? frame.message.content : frame.message.content.map((part) => part.text).join('\n');
      chain = chain.then(async () => {
        if (failure) return;
        const { resume: _resume, fork: _fork, ...continuation } = options;
        const result = await runPrintTurn({ ...(agentId ? { ...continuation, continueAgentId: agentId } : options), prompt, format: 'stream-json', onAgent(id) {
          activeId = id;
          if (failure) void cancelAgent(id).catch(() => {});
        } });
        agentId = result.agent.id; code = result.code;
      }).catch((error: unknown) => {
        failure = error; failureReported = true;
        // Report immediately: an interactive producer may keep stdin open while
        // waiting for this result, so waiting for EOF would deadlock the protocol.
        write({ type: 'result', schema_version: 1, status: 'failed', is_error: true, error: error instanceof Error ? error.message : String(error) });
      }).finally(() => { activeId = undefined; pending--; });
    }
  } catch (error) {
    failure = error;
    if (activeId) await cancelAgent(activeId);
  }
  await chain;
  if (failure) { if (failureReported) return 1; throw failure; }
  if (!count) throw new Error('At least one user input frame is required');
  return code;
}
