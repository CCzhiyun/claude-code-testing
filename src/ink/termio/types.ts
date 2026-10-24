export type NamedColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'default';
export type Color = NamedColor | { mode: 'indexed'; index: number } | { mode: 'rgb'; r: number; g: number; b: number };
export interface TextStyle { foreground: Color; background: Color; bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean; hidden: boolean; strikethrough: boolean }
export const defaultStyle = (): TextStyle => ({ foreground: 'default', background: 'default', bold: false, dim: false, italic: false, underline: false, inverse: false, hidden: false, strikethrough: false });
export type TerminalAction =
  | { type: 'text'; value: string; style: TextStyle }
  | { type: 'cursor'; row?: number; column?: number; deltaRow?: number; deltaColumn?: number }
  | { type: 'erase'; target: 'display' | 'line'; mode: number }
  | { type: 'sgr'; parameters: number[] }
  | { type: 'osc'; command: number; value: string }
  | { type: 'control'; value: string };
