import type { TeamRecord } from '../../teamStore.js'; export const formatTeamCreateResult = (team: TeamRecord): string => `Created team ${team.name} (${team.id})`;
