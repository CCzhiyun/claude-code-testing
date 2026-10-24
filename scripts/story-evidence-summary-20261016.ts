// Derive the request/step index from retained synthetic evidence; never read personal settings.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dir, '../.ccpt/story-20261016/evidence');
const requests = (await readFile(join(root, 'model-requests.ndjson'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const steps = JSON.parse(await readFile(join(root, 'pty-steps.json'), 'utf8')) as any[];
const boundaries = JSON.parse(await readFile(join(root, 'boundary-results.json'), 'utf8'));
const cancels = (await readFile(join(root, 'stream-cancels.ndjson'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const rows = requests.map((r: any) => {
  const value = JSON.stringify(r.body);
  const auxiliary = r.protocol === 'messages' && !r.body.tools?.length && value.includes('Write the title');
  return { index: r.index, protocol: r.protocol, category: auxiliary ? 'auxiliary-session-title' : 'agent-request', model: r.body.model, stream: r.body.stream === true,
    responseKind: r.responseKind, tools: r.body.tools?.length ?? 0, echoBody: value.includes('STORY_ECHO_BODY'), apiRule: value.includes('STORY_API_RULE_MARKER'),
    uiFileResult: value.includes('STORY_UI_FILE'), apiFileResult: value.includes('STORY_API_FILE'), specialistPrompt: value.includes('STORY_REVIEWER_PROFILE'), forkBody: value.includes('STORY_FORK_BODY'),
    cancelledByClient: cancels.some((c: any) => c.index === r.index),
  };
});
const summary = { referenceVersion: '2.1.301', ccptVersion: '0.51.0', fixtureOnly: true, stepCount: steps.length,
  referenceSteps: steps.filter(s => s.system === 'reference').length, ccptSteps: steps.filter(s => s.system === 'ccpt').length,
  note: 'Steps are individual PTY actions/observations, NOT distinct feature count. Tool-returned ANSI fragments may be truncated; no pixel-level screenshot claim.',
  boundaryTotal: boundaries.total, boundaryPass: boundaries.passed, boundaryFail: boundaries.failed, requests: rows, cancellations: cancels,
};
await writeFile(join(root, 'execution-summary.json'), JSON.stringify(summary, null, 2) + '\n');
await writeFile(join(root, 'request-index.md'), '# Synthetic request index\n\n' + '| Index | Protocol | Category | Kind | Tools | Echo body | API rule | UI result | API result | Cancelled |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' + rows.map((r: any) => `| ${r.index} | ${r.protocol} | ${r.category} | ${r.responseKind} | ${r.tools} | ${r.echoBody} | ${r.apiRule} | ${r.uiFileResult} | ${r.apiFileResult} | ${r.cancelledByClient} |`).join('\n') + '\n');
await writeFile(join(root, 'pty-step-index.md'), '# Executed PTY actions\n\n' + '| Step | Case | System | Action | Input |\n| --- | --- | --- | --- | --- |\n' + steps.map((s, i) => `| ${i + 1} | ${s.caseId} | ${s.system} | ${s.action} | ${JSON.stringify(s.keys ?? '(observation)').replaceAll('|', '\\|')} |`).join('\n') + '\n');
console.log(JSON.stringify({ ...summary, requests: undefined }, null, 2));
