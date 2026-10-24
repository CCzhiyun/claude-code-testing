import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overrides = JSON.parse(await readFile(join(repository, 'docs', 'SOURCE-COVERAGE-OVERRIDES.json'), 'utf8'));
const referenceRoot = resolve(process.env.CCPT_REFERENCE_SRC ?? overrides.referenceRoot);
async function files(root, current = root, output = []) { for (const entry of await readdir(current, { withFileTypes: true })) { const path = join(current, entry.name); if (entry.isDirectory()) await files(root, path, output); else output.push(relative(root, path).split(sep).join('/')); } return output; }
const utilityRules = [
  ['permissions', /permission|denial|classifier|yolo|autoMode/i], ['plugins', /plugin|marketplace|mcpb|dxt/i], ['settings', /setting|config|managedEnv|mdm/i], ['model', /model|token|thinking|effort|fastMode|beta/i], ['shell', /bash|shell|powershell|exec|command|ripgrep|which|binary/i], ['git', /git|worktree|commit|repository|diff|prStatus/i], ['network', /http|proxy|mtls|aws|apiPreconnect|webSocket/i], ['security', /auth|crypto|secure|fingerprint|sanit|privacy|ssrf|caCert/i], ['hooks', /hook/i], ['sessions', /session|conversation|transcript|teleport|resume/i], ['agents', /agent|swarm|team|teammate|mailbox|background/i], ['tools', /tool|task|queue|cron|planMode|processUserInput/i], ['telemetry', /telemetry|profil|trace|stats|activity|fps|heatmap|log/i], ['media', /image|pdf|screenshot|ansiTo|asciicast|clipboard/i], ['terminal', /terminal|ink|theme|render|fullscreen|cursor|highlight|keyboard|editor|paste/i], ['filesystem', /file|path|cwd|directory|glob|temp|xdg|lock/i], ['process', /process|signal|abort|timeout|sleep|subprocess|cleanup|installer/i], ['text', /markdown|frontmatter|xml|yaml|json|string|word|truncate|semantic|format|content|message/i], ['collections', /array|set|group|memoize|cache|circular|tree/i], ['async', /sequential|stream|deferred|resolver|buffered|concurrent|slowOperation/i], ['integration', /ide|chrome|computerUse|deepLink|desktop|browser|jetbrains|tmux/i], ['core', /./],
];
const hookRules = [
  ['notifications', /notifs|notification|banner|warning|hint/i], ['permissions', /permission|CanUseTool/i], ['input', /input|paste|typeahead|suggestion|copy|keybinding/i], ['history', /history/i], ['timing', /timeout|elapsed|minDisplay|doublePress|blink/i], ['terminal', /terminal|virtualScroll|Vim|exitOnCtrl/i], ['commands', /command/i], ['tools', /mergedTools|diff/i], ['settings', /setting|dynamicConfig/i], ['plugins', /plugin|marketplace/i], ['skills', /skill/i], ['tasks', /task|scheduled/i], ['agents', /swarm|teammate|mailbox|inbox|away|background/i], ['sessions', /session|assistantHistory|mainLoop/i], ['ide', /IDE|Ide|PrStatus|Lsp/i], ['remote', /remote|directConnect|SSH|teleport|replBridge/i], ['voice', /voice/i], ['data', /memory|logMessages|fileSuggestions|queueProcessor/i], ['lifecycle', /./],
];
const implementations = {
  utils: ['src/utils/', 'src/services/', 'src/tools/', 'src/policy.ts', 'src/config.ts', 'src/platform.ts'], hooks: ['src/hooks/', 'src/tui.ts', 'src/state/', 'src/context/'], screens: ['src/screens/'], entrypoints: ['src/entrypoints/', 'src/cli.ts'], voice: ['src/voice/', 'src/services/voice.ts', 'src/services/voiceStreamSTT.ts'],
};
for (const paths of Object.values(implementations)) for (const path of paths) await access(join(repository, path));
const targets = {
  utils: (await files(join(referenceRoot, 'utils'))).filter((path) => !['permissions/PermissionRule.ts', 'permissions/PermissionResult.ts', 'permissions/permissionRuleParser.ts', 'permissions/permissions.ts', 'permissions/permissionsLoader.ts', 'permissions/permissionExplainer.ts', 'permissions/shellRuleMatching.ts'].includes(path)),
  hooks: await files(join(referenceRoot, 'hooks')),
  screens: await files(join(referenceRoot, 'screens')),
  entrypoints: ['cli.tsx', 'sandboxTypes.ts'],
  voice: await files(join(referenceRoot, 'voice')),
};
const rows = [];
for (const [directory, paths] of Object.entries(targets)) for (const path of paths.sort()) { const rules = directory === 'utils' ? utilityRules : directory === 'hooks' ? hookRules : [['native', /./]]; const family = rules.find(([, pattern]) => pattern.test(path))?.[0]; if (!family) throw new Error(`No compatibility family for ${directory}/${path}`); rows.push({ reference: `${directory}/${path}`, directory, family, status: 'partial', implementation: implementations[directory] }); }
const directories = {}; for (const row of rows) { const summary = directories[row.directory] ??= { files: 0, families: {} }; summary.files += 1; summary.families[row.family] = (summary.families[row.family] ?? 0) + 1; }
if (rows.length !== 667) throw new Error(`Expected the 667 remaining reference paths, classified ${rows.length}`);
const report = { generatedAt: new Date().toISOString(), referenceRoot, total: rows.length, unmatched: 0, directories, files: rows };
await writeFile(join(repository, 'docs', 'NATIVE-COMPATIBILITY-INVENTORY.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = ['# Remaining Native Compatibility Inventory', '', '> Generated by `npm run coverage:native`. This records architectural counterparts for the final previously-unmapped paths. Entries remain partial until independent behavioral parity verification.', '', `Classified previously-missing files: **${rows.length}** · Unmatched: **0**`, '', '| Directory | Files | Families |', '|---|---:|---|', ...Object.entries(directories).map(([name, value]) => `| ${name} | ${value.files} | ${Object.entries(value.families).map(([family, count]) => `${family}: ${count}`).join(' · ')} |`), '', 'File-level evidence: `docs/NATIVE-COMPATIBILITY-INVENTORY.json`.', ''];
await writeFile(join(repository, 'docs', 'NATIVE-COMPATIBILITY-INVENTORY.md'), lines.join('\n'));
process.stdout.write(`${JSON.stringify({ total: rows.length, unmatched: 0, directories: Object.fromEntries(Object.entries(directories).map(([name, value]) => [name, value.files])) })}\n`);
