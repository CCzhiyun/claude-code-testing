import { createId } from '../storage.js';

export type ReviewEffort = 'quick' | 'standard' | 'thorough' | 'exhaustive';
export type ReviewScope = 'diff' | 'commit' | 'pull-request' | 'repository';
export interface ReviewPlan { scope: ReviewScope; target?: string; effort: ReviewEffort; checks: string[]; maximumFiles: number; parallelism: number; autoFix: boolean; publish: boolean }
export interface ManagedFinding { id: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; title: string; description: string; file?: string; line?: number; status: 'open' | 'accepted' | 'fixed' | 'dismissed'; fingerprint: string }

const effortSettings: Record<ReviewEffort, Pick<ReviewPlan, 'maximumFiles' | 'parallelism'> & { checks: string[] }> = {
  quick: { maximumFiles: 20, parallelism: 2, checks: ['correctness', 'regressions'] },
  standard: { maximumFiles: 100, parallelism: 4, checks: ['correctness', 'regressions', 'tests', 'maintainability'] },
  thorough: { maximumFiles: 500, parallelism: 8, checks: ['correctness', 'regressions', 'tests', 'maintainability', 'security', 'performance'] },
  exhaustive: { maximumFiles: 5_000, parallelism: 16, checks: ['correctness', 'regressions', 'tests', 'maintainability', 'security', 'performance', 'architecture', 'dependencies', 'documentation'] },
};

export function createReviewPlan(input: { scope: ReviewScope; target?: string; effort?: ReviewEffort; autoFix?: boolean; publish?: boolean }): ReviewPlan {
  const effort = input.effort ?? 'standard';
  const settings = effortSettings[effort];
  return { scope: input.scope, ...(input.target ? { target: input.target } : {}), effort, checks: [...settings.checks], maximumFiles: settings.maximumFiles, parallelism: settings.parallelism, autoFix: input.autoFix ?? false, publish: input.publish ?? false };
}

function fingerprint(input: Omit<ManagedFinding, 'id' | 'status' | 'fingerprint'>): string {
  return [input.severity, input.title.trim().toLowerCase(), input.file ?? '', input.line ?? ''].join(':');
}

export class ManagedReview {
  readonly findings: ManagedFinding[] = [];
  constructor(readonly plan: ReviewPlan) {}

  addFinding(input: Omit<ManagedFinding, 'id' | 'status' | 'fingerprint'>): ManagedFinding {
    const key = fingerprint(input);
    const existing = this.findings.find((item) => item.fingerprint === key);
    if (existing) return existing;
    const finding: ManagedFinding = { ...input, title: input.title.trim().slice(0, 300), description: input.description.trim().slice(0, 20_000), id: createId('finding'), status: 'open', fingerprint: key };
    this.findings.push(finding);
    return finding;
  }

  updateFinding(id: string, status: ManagedFinding['status']): ManagedFinding {
    const finding = this.findings.find((item) => item.id === id);
    if (!finding) throw new Error(`Finding not found: ${id}`);
    finding.status = status;
    return finding;
  }

  qualityGate(maximumSeverity: ManagedFinding['severity'] = 'medium'): { passed: boolean; blocking: ManagedFinding[] } {
    const rank: Record<ManagedFinding['severity'], number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    const blocking = this.findings.filter((item) => item.status === 'open' && rank[item.severity] >= rank[maximumSeverity]);
    return { passed: blocking.length === 0, blocking };
  }
}

export interface SecurityRule { id: string; title: string; category: string; severity: ManagedFinding['severity']; pattern: RegExp; guidance: string }
export function scanSecurityRules(files: Record<string, string>, rules: readonly SecurityRule[]): ManagedFinding[] {
  const findings: ManagedFinding[] = [];
  for (const [file, content] of Object.entries(files)) for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(content))) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ id: createId('finding'), severity: rule.severity, title: rule.title, description: rule.guidance, file, line, status: 'open', fingerprint: `${rule.id}:${file}:${line}` });
      if (!rule.pattern.global) break;
    }
  }
  return findings;
}
