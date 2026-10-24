import type { FileEditResult } from './types.js';
export const formatFileEditResult = (result: FileEditResult): string => `Edited ${result.path}: ${result.replacements} replacement(s), +${result.linesAdded}/-${result.linesRemoved} lines`;
