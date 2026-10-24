export function extractBashCommentLabel(command: string): string | undefined { const match = /^\s*#\s*([^\r\n]{1,100})\r?\n/.exec(command); return match?.[1]?.trim(); }
