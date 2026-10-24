// Strict Node-only TS consumer of an actual local npm archive. Never install/publish.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { writeJson } from '../src/storage.js';
const run = promisify(execFile), project = resolve(import.meta.dir, '..');
const archive = process.argv[2];
if (!archive) throw new Error('Usage: bun scripts/verify-packed-types.ts <local npm .tgz>');
const root = await mkdtemp(join(tmpdir(), 'ccpt-packed-types-'));
try {
  const listing = (await run('tar', ['-tzf', resolve(archive)], { maxBuffer: 4_000_000, windowsHide: true })).stdout.trim().split(/\r?\n/);
  if (!listing.length || listing.some(path => !path.startsWith('package/') || path.split(/[\\/]/).some(part => part === '..'))) throw new Error('Unexpected package archive paths');
  await run('tar', ['-xzf', resolve(archive), '-C', root], { windowsHide: true });
  const target = join(root, 'node_modules/ccpt'); await mkdir(join(root, 'node_modules'), { recursive: true });
  await cp(join(root, 'package'), target, { recursive: true });
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  if (!manifest.exports?.['./sdk']?.types) throw new Error('SDK types export missing');
  await cp(join(project, 'test/fixtures/sdk-consumer.mts'), join(root, 'consumer.mts'));
  // Only @types/node is opted in. No Bun types, no skipLibCheck, no source path aliases.
  await run('node', [join(project, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck', 'false', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', join(project, 'node_modules/@types'), join(root, 'consumer.mts')], { windowsHide: true, maxBuffer: 4_000_000 });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(key)) delete env[key];
  env.CCPT_HOME = join(root, 'home');
  const runtime = await run('node', ['--input-type=module', '-e', "const sdk=await import('ccpt/sdk'); if(['callMcpServer','inspectMarketplaceInstallations','repairMarketplaceReceipt','sessionHistory','runtimeHistory','transitionSessionGoal','bindWakeupToJob','prepareGoalWorkflow','inspectGoalWorkflow','registerOperationConnector','queryOperation','stagePluginSet','activatePluginSet','inspectPluginSet','countTextTokens','goalCandidates','listGoalWorkflows','reviewGoalWorkflow','decideGoalWorkflow','planRecoveryMaintenance','runRecoveryMaintenance','prepareRecoveryRemote','runRecoveryRemote','queryRecoveryRemote'].some(name=>typeof sdk[name]!=='function')) throw new Error('Missing SDK runtime export'); if(sdk.countTextTokens('hello world','cl100k_base')!==2 || sdk.countTextTokens('你好世界','o200k_base')!==2)throw new Error('Bundled tokenizer does not resolve/count under actual Node package'); process.stdout.write(sdk.cli.CLI_VERSION);"], { cwd: root, env, windowsHide: true, timeout: 15000 });
  if (runtime.stdout !== manifest.version) throw new Error('Packed SDK runtime/package version mismatch');
  await run('node',['--input-type=module','-e',"const sdk=await import('ccpt/sdk'); for(const name of ['prepareScheduledGoal','prepareScheduledBackup','inspectScheduledWorkflows','reconcileScheduledBackup','reviewConflictResolution','resolveConflict','stageMarketplacePluginSet','McpProtocolError'])if(typeof sdk[name]!=='function')throw new Error('Missing scheduled/conflict/modern MCP SDK export: '+name);const error=new sdk.McpProtocolError({code:-1,message:'fixture'});if(error.code!==-1)throw new Error('Structured MCP error lost its code');"],{cwd:root,env,windowsHide:true,timeout:15000});
  const report = { pass: true, archive: resolve(archive), checks: ['actual npm archive extracted in owned temp', 'types export resolves through package', 'strict Node-only TypeScript consumer', 'all transitive declarations checked', 'negative type assertions enforced', 'Node ESM runtime import resolves from the extracted package','both bundled text BPE encodings execute under Node'], installed: false, published: false, modelRequests: 0, userSettingsModified: false };
  const evidence=process.env.CCPT_VERIFICATION_OUTPUT?resolve(process.env.CCPT_VERIFICATION_OUTPUT):join(project,'.ccpt/http-sdk-20261017/final');
  await writeJson(join(evidence,'packed-types-smoke.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid temporary consumer cleanup path');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
