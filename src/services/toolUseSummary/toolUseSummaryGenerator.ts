export type GenerateToolUseSummaryParams = { toolName: string; input: unknown; output?: string; isError?: boolean; maxLength?: number };
export async function generateToolUseSummary({ toolName, input, output = '', isError = false, maxLength = 160 }: GenerateToolUseSummaryParams): Promise<string> {
  const subject = input && typeof input === 'object' ? ['path', 'file_path', 'command', 'query', 'description'].map((key) => (input as Record<string, unknown>)[key]).find((value): value is string => typeof value === 'string') : undefined;
  const detail = (subject ?? output.replace(/\s+/g, ' ').trim()).slice(0, Math.max(20, maxLength - toolName.length - 12));
  return `${isError ? 'Failed' : 'Completed'} ${toolName}${detail ? `: ${detail}` : ''}`.slice(0, maxLength);
}
