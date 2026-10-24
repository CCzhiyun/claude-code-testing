import { getAllKeys } from './supportedSettings.js';
export const DESCRIPTION = 'Get or set supported CCPT project configuration settings.';
export function generatePrompt(): string { return `${DESCRIPTION} Supported keys: ${getAllKeys().join(', ')}.`; }
