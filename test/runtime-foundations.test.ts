import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry } from '../src/Tool.js';
import { tools } from '../src/tooling.js';
import { createBudgetTracker, checkTokenBudget } from '../src/query/tokenBudget.js';
import { defaultConfig } from '../src/config.js';
import { executeLspRequest } from '../src/services/lsp/manager.js';
import { listMcpPrompts, listMcpResources, readMcpResource } from '../src/mcp.js';
import { getShellTaskOutput, startShellTask } from '../src/tasks/LocalShellTask/LocalShellTask.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

let root = '';
let previousHome: string | undefined;
let previousEntry: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccpt-foundations-'));
  previousHome = process.env.CCPT_HOME;
  previousEntry = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_HOME = join(root, 'state');
  process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '..', 'src', 'cli.ts');
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  if (previousEntry === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = previousEntry;
  // A terminal shell record means its command has closed, but the detached worker
  // may still be finishing its audit write/exit. Windows can briefly hold cwd.
  // Retry only this owned temporary fixture; a persistent busy directory still fails.
  await removeOwnedTemporaryFixture(root);
});

describe('reference-driven runtime foundations', () => {
  test('searches the canonical tool registry with required keywords and direct selection', () => {
    const registry = new ToolRegistry(tools);
    expect(registry.search('+mcp +resource', 10).some((match) => match.name === 'mcp_resource_read')).toBe(true);
    expect(registry.search('select:lsp')[0]?.name).toBe('lsp');
    expect(() => new ToolRegistry([tools[0]!, tools[0]!])).toThrow('Duplicate tool');
  });

  test('tracks continuation and diminishing token returns', () => {
    const tracker = createBudgetTracker();
    expect(checkTokenBudget(tracker, undefined, 10_000, 1_000).action).toBe('continue');
    checkTokenBudget(tracker, undefined, 10_000, 1_200);
    checkTokenBudget(tracker, undefined, 10_000, 1_300);
    expect(checkTokenBudget(tracker, undefined, 10_000, 1_350).action).toBe('stop');
  });

  test('lists and reads MCP resources and prompts', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    config.mcpServers.fixture = { transport: 'stdio', command: process.execPath, args: [join(import.meta.dir, 'mcp-fixture.ts')] };
    expect((await listMcpResources(config))[0]?.uri).toBe('fixture://guide');
    expect(JSON.stringify(await readMcpResource(config, 'fixture', 'fixture://guide'))).toContain('resource body');
    expect((await listMcpPrompts(config))[0]?.name).toBe('review');
  });

  test('executes a configured LSP operation over Content-Length stdio framing', async () => {
    const file = join(root, 'sample.ts');
    await writeFile(file, 'const value = "fixture";\n');
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    config.lspServers.fixture = { command: process.execPath, args: [join(import.meta.dir, 'lsp-fixture.ts')], extensions: ['.ts'], languageId: 'typescript' };
    const result = await executeLspRequest({ operation: 'hover', filePath: file, line: 1, character: 7 }, root, config);
    expect(JSON.stringify(result)).toContain('fixture: string');
  });

  test('runs a durable background shell task and captures output', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [root];
    const task = await startShellTask({ command: process.execPath, args: ['-e', 'console.log("background-ok")'], cwd: root, config, actor: 'test' });
    let output = await getShellTaskOutput(task.id);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (output.task.status === 'queued' || output.task.status === 'running')) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      output = await getShellTaskOutput(task.id);
    }
    expect(output.task.status).toBe('completed');
    expect(output.stdout).toContain('background-ok');
  });
});
