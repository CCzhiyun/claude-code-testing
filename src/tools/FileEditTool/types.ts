export interface FileEditInput { path: string; oldText: string; newText: string; replaceAll?: boolean }
export interface FileEditResult { path: string; replacements: number; linesAdded: number; linesRemoved: number }
