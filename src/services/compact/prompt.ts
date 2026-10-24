export const getCompactPrompt = (): string => 'Summarize verified decisions, completed changes, open work, constraints, relevant paths, commands and test results. Exclude credentials and unsupported guesses.';
export const getCompactUserSummaryMessage = (summary: string): string => `[Earlier conversation summary]\n${summary.trim()}`;
export const getPartialCompactPrompt = (focus: string): string => `${getCompactPrompt()} Preserve details related to: ${focus}`;
