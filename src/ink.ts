const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;
export const stripAnsi = (value: string): string => value.replace(ansiPattern, '');
export const terminalWidth = (value: string): number => [...stripAnsi(value)].reduce((width, character) => width + (/\p{Extended_Pictographic}|\p{Script=Han}/u.test(character) ? 2 : 1), 0);
export function truncateTerminal(value: string, width: number): string { if (terminalWidth(value) <= width) return value; let output = ''; for (const character of stripAnsi(value)) { if (terminalWidth(`${output}${character}…`) > width) break; output += character; } return `${output}…`; }
