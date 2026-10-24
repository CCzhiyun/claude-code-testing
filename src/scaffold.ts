import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { projectStateDir } from './paths.js';
import { saveMcpServer } from './mcp.js';

function extensionName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value)) throw new Error('Name may contain letters, numbers, dot, dash, and underscore');
  return value;
}

async function writeNew(path: string, content: string): Promise<void> {
  try { await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Refusing to overwrite existing file: ${path}`);
    throw error;
  }
}

export const platformGuide = `# CCPT Extension Platform

The trusted workspace is the complete extension boundary. CCPT stores Skills, Agents, Rules, Plans, and Plugins under that workspace's \`.ccpt/\` directory. It does not read another CLI's extension directory.

## Skill

Create one with \`ccpt skill create <name>\`. It is written to the current workspace as \`.ccpt/skills/<name>/SKILL.md\`, with frontmatter fields \`name\`, \`description\`, and optional \`tools\`.

## Agent

Create one with \`ccpt agent create <name>\`. It is written to \`.ccpt/agents/<name>/AGENT.md\` in the current workspace, with \`name\`, \`description\`, optional \`tools\`, \`skills\`, \`model\`, \`permissionMode\`, \`isolation\`, \`background\`, and \`maxTurns\`. The Markdown body is its system prompt.

## Rule

Project rules are Markdown files under \`.ccpt/rules/\`. They are loaded into repository context only after this workspace is trusted.

## Plan

Plan mode stores generated Markdown plans under \`.ccpt/plans/\` in the trusted workspace.

## Plugin

Create one with \`ccpt plugin create <name>\`. A Plugin is a declarative bundle described by \`plugin.json\`. It may contribute Skill directories, Agent directories, slash commands, Hooks, and MCP servers. Paths must be relative and cannot escape the Plugin directory. Plugin code is never loaded into the CLI process.

## MCP

Create a dependency-free stdio example with \`ccpt mcp create <name>\`, then use \`ccpt mcp test <name>\`. Keep credentials in environment variables referenced through \`tokenEnv\`; do not put secrets in configuration files.

## Runtime

Use \`/reload\` inside the terminal UI after changing extensions. Use \`ccpt platform inspect\` and \`ccpt doctor\` for resolved components and diagnostics. Only components inside the trusted workspace are discovered automatically; Plugin components use \`plugin:component\` names.
`;

export const pluginSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CCPT Plugin Manifest',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'name', 'version', 'contributes'],
  properties: {
    $schema: { type: 'string' },
    schemaVersion: { const: 1 },
    name: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
    description: { type: 'string' },
    publisher: { type: 'string' },
    integrity: { type: 'object', required: ['algorithm', 'digest'], additionalProperties: false, properties: { algorithm: { const: 'sha256' }, digest: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, signature: { type: 'object', required: ['algorithm', 'keyId', 'value'], additionalProperties: false, properties: { algorithm: { const: 'ed25519' }, keyId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$' }, value: { type: 'string', pattern: '^[A-Za-z0-9+/]{86}==$' } } } } },
    contributes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        skills: { type: 'array', items: { type: 'string', pattern: '^\\./' } },
        agents: { type: 'array', items: { type: 'string', pattern: '^\\./' } },
        commands: { type: 'array', items: { type: 'object', required: ['name', 'description', 'prompt'], properties: { name: { type: 'string' }, description: { type: 'string' }, prompt: { type: 'string' }, agent: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } }, isolation: { enum: ['none', 'worktree'] }, background: { type: 'boolean' } } } },
        hooks: { type: 'array', items: { type: 'object', required: ['event', 'command'], properties: { event: { enum: ['SessionStart', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'TaskCompleted', 'TeammateIdle', 'WorktreeCreate', 'WorktreeRemove', 'ConfigChange', 'Setup'] }, command: { type: 'string' }, timeoutMs: { type: 'number', minimum: 1 } } } },
        mcpServers: { type: 'object', additionalProperties: { type: 'object', required: ['transport'], properties: { transport: { enum: ['stdio', 'http'] }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, tokenEnv: { type: 'string' }, oauth: { type: 'object', required: ['clientId', 'tokenUrl'], properties: { clientId: { type: 'string' }, authorizationUrl: { type: 'string' }, deviceAuthorizationUrl: { type: 'string' }, tokenUrl: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } } } } } },
      },
    },
  },
};

export async function initializePlatform(cwd: string): Promise<string> {
  const root = projectStateDir(cwd);
  await Promise.all(['skills', 'agents', 'rules', 'plans', 'plugins', 'mcp', 'workflows'].map((name) => mkdir(join(root, name), { recursive: true })));
  const guide = join(root, 'PLATFORM.md');
  try { await writeNew(guide, platformGuide); } catch (error) { if (!String(error).includes('Refusing to overwrite')) throw error; }
  const schema = join(root, 'plugin.schema.json');
  try { await writeNew(schema, `${JSON.stringify(pluginSchema, null, 2)}\n`); } catch (error) { if (!String(error).includes('Refusing to overwrite')) throw error; }
  return root;
}

export async function createSkillScaffold(cwd: string, inputName: string): Promise<string> {
  const name = extensionName(inputName);
  const directory = join(projectStateDir(cwd), 'skills', name);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'SKILL.md');
  await writeNew(path, `---\nname: ${name}\ndescription: Explain when this engineering workflow should be used.\ntools: [read_file, search_text]\n---\n\n# ${name}\n\nDescribe the rules, workflow, verification steps, and expected output.\n`);
  return path;
}

export async function createAgentScaffold(cwd: string, inputName: string): Promise<string> {
  const name = extensionName(inputName);
  const directory = join(projectStateDir(cwd), 'agents', name);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'AGENT.md');
  await writeNew(path, `---\nname: ${name}\ndescription: Explain when the lead Agent should delegate to this Agent.\ntools: [list_files, read_file, search_text, write_file, run_command]\nskills: []\nisolation: worktree\nbackground: true\nmaxTurns: 16\n---\n\nYou are the ${name} specialist. Inspect the repository, follow project standards, make scoped changes, run relevant verification, and report concrete evidence.\n`);
  return path;
}

export async function createPluginScaffold(cwd: string, inputName: string): Promise<string> {
  await initializePlatform(cwd);
  const name = extensionName(inputName);
  const root = join(projectStateDir(cwd), 'plugins', name);
  await mkdir(join(root, 'skills', 'team-review'), { recursive: true });
  await mkdir(join(root, 'agents', 'reviewer'), { recursive: true });
  const manifest = {
    $schema: '../../plugin.schema.json',
    schemaVersion: 1,
    name,
    version: '0.1.0',
    description: 'Team engineering standards and workflows.',
    contributes: {
      skills: ['./skills'],
      agents: ['./agents'],
      commands: [{ name: 'team-review', description: 'Review current changes using team standards', agent: 'reviewer', skills: ['team-review'], prompt: 'Review the current changes. Additional focus: {args}' }],
      hooks: [],
      mcpServers: {},
    },
  };
  await writeNew(join(root, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeNew(join(root, 'skills', 'team-review', 'SKILL.md'), `---\nname: team-review\ndescription: Review changes against team quality and security standards.\ntools: [read_file, search_text, run_command]\n---\n\nInspect the diff, correctness, tests, security boundaries, compatibility, and rollback risk. Report findings by severity with file evidence.\n`);
  await writeNew(join(root, 'agents', 'reviewer', 'AGENT.md'), `---\nname: reviewer\ndescription: Performs an independent code and security review.\ntools: [list_files, read_file, search_text, run_command]\nskills: [team-review]\nisolation: worktree\nbackground: true\nmaxTurns: 12\n---\n\nAct as an independent reviewer. Do not modify files unless the user explicitly asks for fixes. Verify every finding and produce an actionable report.\n`);
  return root;
}

export async function installFoundationPlugin(cwd: string): Promise<string> {
  await initializePlatform(cwd);
  const root = join(projectStateDir(cwd), 'plugins', 'ccpt-foundation');
  const manifestPath = join(root, 'plugin.json');
  try { await access(manifestPath); return root; } catch { /* First installation. */ }
  await mkdir(join(root, 'skills', 'engineering-quality'), { recursive: true });
  await mkdir(join(root, 'agents', 'reviewer'), { recursive: true });
  await mkdir(join(root, 'agents', 'implementer'), { recursive: true });
  const manifest = {
    $schema: '../../plugin.schema.json',
    schemaVersion: 1,
    name: 'ccpt-foundation',
    version: '1.0.0',
    description: 'Editable baseline engineering workflows for the team.',
    contributes: {
      skills: ['./skills'],
      agents: ['./agents'],
      commands: [
        { name: 'review', description: 'Review the current changes for correctness and maintainability', agent: 'reviewer', skills: ['engineering-quality'], prompt: 'Review the current changes. Focus: {args}' },
        { name: 'security-review', description: 'Review trust boundaries and security-sensitive changes', agent: 'reviewer', skills: ['engineering-quality'], prompt: 'Perform a security review of the current changes. Focus: {args}' },
        { name: 'verify', description: 'Run evidence-based verification for the current implementation', agent: 'reviewer', skills: ['engineering-quality'], prompt: 'Verify that the current implementation satisfies its requirements. Run relevant checks and report evidence. Additional requirements: {args}' },
        { name: 'debug', description: 'Diagnose and fix a reproducible engineering problem', agent: 'implementer', skills: ['engineering-quality'], prompt: 'Diagnose this problem, identify the root cause, implement a scoped fix, and verify it: {args}' },
        { name: 'simplify', description: 'Simplify current changes without altering behavior', agent: 'implementer', skills: ['engineering-quality'], prompt: 'Review the current changes and simplify them while preserving behavior. Verify the result. Focus: {args}' },
        { name: 'run', description: 'Build or launch the project and verify behavior', agent: 'implementer', skills: ['engineering-quality'], prompt: 'Inspect this project, determine its supported run workflow, launch or test it safely, and verify the requested behavior: {args}' },
        { name: 'batch', description: 'Plan and delegate a larger change to bounded parallel Agents', prompt: 'Plan this larger engineering change, delegate only independent work to bounded Agents, monitor results, integrate safely, and verify the final result: {args}', background: true, isolation: 'none' },
      ],
      hooks: [],
      mcpServers: {},
    },
  };
  await writeNew(join(root, 'skills', 'engineering-quality', 'SKILL.md'), `---\nname: engineering-quality\ndescription: Apply evidence-based implementation, review, security, and verification practices.\ntools: [list_files, read_file, search_text, write_file, run_command]\n---\n\nStart from repository evidence. Keep changes scoped. Preserve public contracts unless the requirement changes them. Validate inputs and trust boundaries. Add or update focused tests. Run the strongest relevant verification available. Report changed files, commands, results, remaining risks, and rollback considerations.\n`);
  await writeNew(join(root, 'agents', 'reviewer', 'AGENT.md'), `---\nname: reviewer\ndescription: Performs independent code, test, architecture, and security reviews.\ntools: [list_files, read_file, search_text, run_command]\ndisallowedTools: [write_file]\nskills: [engineering-quality]\nisolation: none\nbackground: false\nmaxTurns: 14\n---\n\nAct as an independent reviewer. Inspect the repository and current diff. Verify each finding, rank it by impact, cite file evidence, and avoid modifications unless the user explicitly requests fixes.\n`);
  await writeNew(join(root, 'agents', 'implementer', 'AGENT.md'), `---\nname: implementer\ndescription: Diagnoses, implements, refactors, runs, and verifies scoped changes.\ntools: [list_files, read_file, search_text, write_file, run_command, memory_read, memory_write, mcp_call, delegate, agent_status, wait_agent, git_status, git_commit, git_push, create_draft_pr, ask_user]\nskills: [engineering-quality]\nisolation: none\nbackground: false\nmaxTurns: 24\n---\n\nAct as a senior implementation specialist. Understand the architecture before editing, make the smallest complete change, test it proportionally to risk, and provide concrete delivery evidence.\n`);
  await writeNew(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

export async function createMcpScaffold(cwd: string, inputName: string): Promise<string> {
  await initializePlatform(cwd);
  const name = extensionName(inputName);
  const root = join(projectStateDir(cwd), 'mcp', name);
  await mkdir(root, { recursive: true });
  const path = join(root, 'server.mjs');
  await writeNew(path, `import { createInterface } from 'node:readline';\n\nconst input = createInterface({ input: process.stdin });\nconst send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');\nfor await (const line of input) {\n  let request;\n  try { request = JSON.parse(line); } catch { continue; }\n  if (request.method === 'initialize') send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: '${name}', version: '0.1.0' } } });\n  else if (request.method === 'tools/list') send({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'Return the provided text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });\n  else if (request.method === 'tools/call' && request.params?.name === 'echo') send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: String(request.params.arguments?.text ?? '') }] } });\n  else if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });\n}\n`);
  await saveMcpServer(cwd, name, { transport: 'stdio', command: process.execPath, args: [resolve(path)], cwd: root });
  return path;
}
