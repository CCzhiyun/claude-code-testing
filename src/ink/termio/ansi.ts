export const BEL = '\u0007';
export const BS = '\u0008';
export const HT = '\u0009';
export const LF = '\u000a';
export const CR = '\u000d';
export const ESC = '\u001b';
export const CSI = `${ESC}[`;
export const OSC = `${ESC}]`;
export const ST = `${ESC}\\`;
export const SEP = ';';
export const C0 = /[\u0000-\u001f\u007f]/;
export function isEscFinal(character: string): boolean { const code = character.charCodeAt(0); return code >= 0x30 && code <= 0x7e; }
