export interface Timestamp { seconds: bigint; nanos: number }
export function timestampFromDate(value: Date): Timestamp { const ms = value.getTime(); return { seconds: BigInt(Math.floor(ms / 1_000)), nanos: (ms % 1_000) * 1_000_000 }; }
export function timestampToDate(value: Timestamp): Date { if (value.nanos < 0 || value.nanos >= 1_000_000_000) throw new Error('Timestamp nanos out of range'); return new Date(Number(value.seconds) * 1_000 + Math.floor(value.nanos / 1_000_000)); }
