import { verifyInstructions } from './verifyContent.js';
export const verifySkill = { name: 'verify', description: 'Verify an implementation against explicit acceptance conditions.', instructions: verifyInstructions } as const;
