import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js';

export function isAutoDreamEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CCPT_AUTO_DREAM !== undefined) return /^(1|true)$/i.test(env.CCPT_AUTO_DREAM);
  return getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: boolean }>('auto_dream', { enabled: false }).enabled === true;
}
