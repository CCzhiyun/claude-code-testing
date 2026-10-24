import { eraseDisplay, cursorPosition } from './termio/csi.js';
export function getClearTerminalSequence(isWindows = process.platform === 'win32'): string { return isWindows ? `${eraseDisplay(2)}${cursorPosition(0, 0)}` : '\u001bc'; }
export default function clearTerminal(output: Pick<NodeJS.WriteStream, 'write'> = process.stdout): void { output.write(getClearTerminalSequence()); }
