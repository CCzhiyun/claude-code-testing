// Consolidate actual results; never changes product code or historic validation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile), project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.CCPT_VERIFICATION_OUTPUT ?? join(project, '.ccpt/verification-060-20261018'));
const read = async path => JSON.parse(await readFile(join(output, path), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const first = await read('full/single-process-regression.json');
const final = await read('full-after-fixture-cleanup/single-process-regression.json');
const followup = await read('followup-summary.json');
const boundaries = await read('boundaries/recovery-boundaries.json');
const installed = await read('smokes/installed-package.json');
const snapshot = JSON.parse((await run(process.execPath, ['scripts/validation-snapshot-060.mjs', 'verify'], { cwd: project, windowsHide: true })).stdout);
let gate;
try { const result = await run(process.execPath, ['scripts/release-audit.mjs', '--check'], { cwd: project, windowsHide: true, maxBuffer: 2_000_000 }); gate = { exitCode: 0, ...JSON.parse(result.stdout) }; }
catch (error) { if (error.code !== 2) throw error; gate = { exitCode: 2, ...JSON.parse(error.stdout) }; }
await writeFile(join(output, 'source-verification.json'), JSON.stringify(snapshot, null, 2));
await writeFile(join(output, 'release-gate.json'), JSON.stringify(gate, null, 2));
await copyFile(join(project, '.ccpt/original-060/final/source-snapshot.json'), join(output, 'source-snapshot.json'));
const archive = 'releases/local-0.60.0-VmfPF1/ccpt-0.60.0.tgz';
const digest = hash(await readFile(join(project, archive)));
const summary = {
  at: new Date().toISOString(), version: '0.60.0', originalIds: ['A1','A2','A3','A4','P1','P2','P3','P4','H1','H2','H3','H4'],
  overallPlatformAcceptancePassed: false,
  firstFullRegression: first, finalFullRegression: final,
  fullRegressionPassed: final.exitCode === 0 && final.fail === 0 && final.pass === 636,
  note: 'Do not combine separate run counts. A green existing suite does not close separately reproduced defects or target-environment gaps.',
  followup, confirmedOpenDefects: boundaries.findings,
  package: { archive, sha256: digest, matchesExpected: digest === '5645ad596df5d1aab27d3d169612f7c7768d204f8013bb3bb402c5cbb3698da1', offlineInstallPassed: installed.pass === true, actualGlobalInstallChanged: false },
  source: snapshot, releaseGate: { approved: gate.approved, blockers: gate.blockers, inventoryDigest: gate.inventoryDigest },
  changesThisTurn: { productRuntime: false, personalSettings: false, verificationScriptsAdded: true, testFixtureCleanupChanged: 'terminal-responses-integration.test.ts: await owned TUI exit/output; bounded existing temporary-fixture cleanup' },
  notAccepted: ['Goal Run TUI/IDE wizard and scheduled Coding', 'business deduplication across new call IDs and external connector systems', 'native OS scheduler and Remote IDE/power-loss/network-filesystem matrix', 'lossless outbox/full runtime replay', 'all Hook sources/decisions/dynamic watch paths/zero-downtime hot swap', 'advanced MCP/enterprise interoperability', 'platform credential isolation and OS sandbox/escape tests', 'company Azure/CA/proxy/mTLS/Entra/worker matrix', 'exact tokenizer/multimodal/1M semantic-quality benchmark', 'source rights/NOTICE/redistribution and real push/PR'],
  companyRequests: 0, realOsTasksRegistered: false, npmPublished: false, realPushOrPr: false,
};
await writeFile(join(output, 'verification-summary.json'), JSON.stringify(summary, null, 2));
const integrity = [];
async function visit(relative = '') {
  for (const entry of await readdir(join(output, relative), { withFileTypes: true })) {
    if (entry.name === 'previous' || entry.name === 'evidence-sha256.json') continue;
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) integrity.push({ path: path.replaceAll('\\','/'), sha256: hash(await readFile(join(output, path))) });
  }
}
await visit();
for (const path of ['scripts/verify-recovery-boundaries-060.ts','scripts/verification-followup-060.mjs','scripts/verification-report-060.mjs','test/terminal-responses-integration.test.ts','test/fixtureCleanup.ts','docs/VERIFICATION-0.60-2026-10-18.zh-CN.md']) integrity.push({ path: 'project/' + path, sha256: hash(await readFile(join(project, path))) });
await writeFile(join(output, 'evidence-sha256.json'), JSON.stringify(integrity.sort((a,b) => a.path.localeCompare(b.path)), null, 2));
const release = join(project, 'releases/local-0.60.0-VmfPF1');
const text = `# 0.60 追加验证结果（2026-10-18）\n\n本报告追加，不覆盖历史 VALIDATION。产品 tgz 没有变化。\n\n- 初次完整回归：${first.pass} 通过、${first.fail} 失败，${first.elapsedMs} ms；Windows 测试 finally 清理 EBUSY。\n- 调整测试清理后的完整回归：${final.pass} 通过、${final.fail} 失败，${final.elapsedMs} ms。两次运行不相加。\n- 独立发现 A1 直接恢复缺陷 V060-A1-01，仍待修：worker 已退出，但持久状态 working，直接 recover 误报 active；先 agents 刷新后可恢复为 unknown，不重放。\n- Node CLI/SDK/后台审批续行、Responses 工具往返、429 撤权、TUI/IDE 脚本、离线实际 npm 安装和严格 SDK 声明检查已复验。不是公司环境或真实 Remote 认证。\n- 发布门禁 approved=${gate.approved}，不构成来源权利或重分发授权。\n- 本轮没有产品运行时改动、真实全局安装/个人设置修改、公司请求、OS 任务注册、push/PR 或 npm 发布。\n\n原始证据：项目 .ccpt/verification-060-20261018；完整说明：docs/VERIFICATION-0.60-2026-10-18.zh-CN.md。\n\n包 SHA-256：${digest}\n`;
await writeFile(join(release, 'VERIFICATION-20261018.zh-CN.md'), text);
const destination = join(release, 'evidence/verification-20261018'); await mkdir(destination, { recursive: true });
// Copy the exact raw logs too, so taking the candidate folder preserves evidence.
for (const item of integrity.filter(item => !item.path.startsWith('project/'))) {
  const target = join(destination, item.path); await mkdir(dirname(target), { recursive: true });
  await copyFile(join(output,item.path),target);
}
await copyFile(join(output,'evidence-sha256.json'),join(destination,'evidence-sha256.json'));
await copyFile(join(project,'docs/VERIFICATION-0.60-2026-10-18.zh-CN.md'),join(release,'VERIFICATION-DETAILS-20261018.zh-CN.md'));
console.log(JSON.stringify({ fullRegression: final, confirmedOpenDefects: boundaries.findings.map(row => row.id), productRuntimeChanged: false, packageSha256: digest, overallPlatformAcceptancePassed: false, report: join(output,'verification-summary.json') }, null, 2));
