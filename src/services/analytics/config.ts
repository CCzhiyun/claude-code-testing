function disabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function isAnalyticsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return disabled(env.CCPT_DISABLE_ANALYTICS) || disabled(env.DO_NOT_TRACK);
}

export function isFeedbackSurveyDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isAnalyticsDisabled(env) || disabled(env.CCPT_DISABLE_FEEDBACK_SURVEYS);
}
