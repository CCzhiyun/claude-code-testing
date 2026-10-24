export interface SseEvent { event?: string; id?: string; retry?: number; data: string }
export class SseDecoder {
  private buffer = '';
  constructor(private readonly maxFrameChars = Infinity) {}
  get hasPendingData(): boolean { return Boolean(this.buffer.trim()); }
  push(chunk: string): SseEvent[] {
    // Normalize only after concatenating: CR and LF can arrive in different chunks.
    this.buffer = (this.buffer + chunk).replaceAll('\r\n', '\n');
    const blocks = this.buffer.split('\n\n'); this.buffer = blocks.pop() ?? '';
    if (this.buffer.length > this.maxFrameChars || blocks.some(block => block.length > this.maxFrameChars)) throw new Error('SSE frame exceeds size limit');
    return blocks.map((block) => {
      const event: SseEvent = { data: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
        if (field === 'data') event.data += `${event.data ? '\n' : ''}${value}`;
        else if (field === 'event') event.event = value;
        else if (field === 'id') event.id = value;
        else if (field === 'retry' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647) event.retry = Number(value);
      }
      return event;
    }).filter((event) => event.data || event.event || event.id !== undefined || event.retry !== undefined);
  }
}
