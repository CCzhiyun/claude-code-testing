export const formatFileWriteResult = (result: { path: string; bytes: number }): string => `Wrote ${result.bytes} bytes to ${result.path}`;
