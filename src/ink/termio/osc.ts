import { Buffer } from 'node:buffer';
import { BEL, OSC, ST } from './ansi.js';

export function osc(command: number | string, value: string, terminator: 'bel' | 'st' = 'bel'): string { return `${OSC}${command};${value}${terminator === 'bel' ? BEL : ST}`; }
export const setTitle = (value: string): string => osc(0, value.replace(/[\u0000-\u001f\u007f]/g, ''));
export const LINK_END = osc(8, '');
export function link(url: string, label: string): string { const safe = new URL(url).toString(); return `${osc(8, `;${safe}`)}${label}${LINK_END}`; }
export function setClipboard(value: string): string { return osc(52, `c;${Buffer.from(value, 'utf8').toString('base64')}`); }
export function notify(value: string): string { return osc(9, value.replace(/[\u0000-\u001f\u007f]/g, ' ')); }
