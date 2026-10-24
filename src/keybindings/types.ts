import type { KeybindingContextName } from './schema.js';

export interface ParsedKeystroke { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; super: boolean }
export type Chord = ParsedKeystroke[];
export interface ParsedBinding { chord: Chord; action: string | null; context: KeybindingContextName; source?: 'default' | 'user' }
export interface TerminalKey { name?: string | undefined; ctrl?: boolean | undefined; shift?: boolean | undefined; meta?: boolean | undefined; super?: boolean | undefined; sequence?: string | undefined }
