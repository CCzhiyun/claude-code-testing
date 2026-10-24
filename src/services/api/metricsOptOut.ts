export function metricsEnabled(environment = process.env): boolean { return !['1', 'true', 'yes', 'on'].includes((environment.CCPT_DISABLE_TELEMETRY ?? '').toLowerCase()); }
