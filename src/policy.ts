import { spawn } from 'node:child_process';
import { basename, relative, dirname, join } from 'node:path';
import type { PlatformConfig } from './types.js';
import { assertWithinRoots } from './paths.js';
import { audit } from './audit.js';
import { runHooks } from './hooks.js';
import { modelCredentialNames, sanitizedEnvironment } from './environment.js';
import { assertExecutionActive, assertExecutionBoundary, controlProcess, terminateOwnedProcess } from './executionControl.js';
import { isolatedCommand } from './osSandbox.js';

const shellOperators = /[;&|`<>\r\n]/;

export function protectPath(path: string, config: PlatformConfig): string {
  const absolute = assertWithinRoots(path, config.policy.workspaceRoots);
  const normalized = absolute.replaceAll('\\', '/').toLowerCase();
  const protectedMatch = config.policy.protectedPatterns.find((pattern) =>
    normalized.includes(pattern.replaceAll('\\', '/').toLowerCase()),
  );
  if (protectedMatch && config.policy.mode !== 'bypass') {
    throw new Error(`Protected path denied by policy (${protectedMatch}): ${absolute}`);
  }
  return absolute;
}

export function authorizeCommand(command: string, args: string[], config: PlatformConfig): void {
  const executable = basename(command).toLowerCase().replace(/\.exe$/, '');
  if (config.policy.mode === 'restricted') throw new Error('Command execution is disabled in restricted mode');
  if (config.policy.mode === 'sandbox' && !config.policy.processWrapper&&!config.policy.osSandbox) throw new Error('Sandbox mode requires an enterprise processWrapper or OS sandbox; command execution fails closed');
  if (shellOperators.test(command) || args.some((arg) => shellOperators.test(arg))) {
    throw new Error('Shell operators are not accepted; pass an executable and argument array');
  }
  if (config.policy.deniedCommands.some((item) => executable === item.toLowerCase())) {
    throw new Error(`Command is explicitly denied: ${command}`);
  }
  if (config.policy.mode !== 'bypass' && !config.policy.allowedCommands.some((item) => executable === item.toLowerCase())) {
    throw new Error(`Command is not allowlisted: ${command}`);
  }
}

export async function executeCommand(
  command: string,
  args: string[],
  cwd: string,
  config: PlatformConfig,
  actor?: string,
  input?: string|Uint8Array,
  options: {binaryOutput?:boolean;gitIndexFile?:string} = {},
): Promise<{ code: number; stdout: string; stderr: string; stdoutBytes?:Buffer }> {
  if(input!==undefined&&Buffer.byteLength(input)>(typeof input==='string'?65536:16*1024*1024))throw new Error('Command stdin exceeds bounded input limit');
  if(options.gitIndexFile){if(command!=='git'||args[0]!=='update-index')throw new Error('Private Git index is only supported for update-index');protectPath(options.gitIndexFile,config);}
  protectPath(cwd, config);
  try {
    authorizeCommand(command, args, config);
  } catch (error) {
    await audit({ event: 'command', ...(actor ? { actor } : {}), outcome: 'denied', details: { command, args, cwd, error: String(error) } });
    throw error;
  }
  if (config.policy.mode !== 'bypass') await runHooks(config, 'PermissionRequest', { action: 'command', command, args, cwd }, cwd);
  await runHooks(config, 'PreToolUse', { tool: 'run_command', command, args, cwd }, cwd);
  const isolation=await isolatedCommand(command,args,cwd,config);
  const executable = isolation.command;
  const executableArgs = isolation.args;
  await assertExecutionBoundary();assertExecutionActive();
  const result = await new Promise<{ code: number; stdout: string; stderr: string;stdoutBytes?:Buffer }>((resolve, reject) => {
    const child = spawn(executable, executableArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: {...sanitizedEnvironment(config.policy.mode, {}, config.policy.allowedEnvironmentVariables, modelCredentialNames(config)),...(options.gitIndexFile?{GIT_INDEX_FILE:options.gitIndexFile,GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false',GIT_CONFIG_KEY_1:'core.hooksPath',GIT_CONFIG_VALUE_1:join(dirname(options.gitIndexFile),'empty-hooks'),GIT_CONFIG_KEY_2:'core.splitIndex',GIT_CONFIG_VALUE_2:'false'}:{})},
      stdio: [input===undefined?'ignore':'pipe', 'pipe', 'pipe'],
    });
    const control = controlProcess(child, config.policy.commandTimeoutMs);
    let stdout = '';
    let stderr = '';
    const limit = 2_000_000;
    const chunks:Buffer[]=[];let bytes=0,overflow=false;
    child.stdin?.on('error',()=>{});if(input!==undefined)child.stdin?.end(input);
    child.stdout!.on('data', (chunk:Buffer) => {if(options.binaryOutput){bytes+=chunk.length;if(bytes>16*1024*1024){overflow=true;terminateOwnedProcess(child);}else chunks.push(Buffer.from(chunk));}else if (stdout.length < limit) stdout += String(chunk); });
    child.stderr!.on('data', (chunk) => { if (stderr.length < limit) stderr += String(chunk); });
    child.on('error', (error) => { control.dispose(); reject(error); });
    child.on('close', (code) => { control.dispose(); if(overflow)reject(new Error('Binary command output exceeds 16 MiB'));else if (control.error()) reject(control.error()); else resolve({ code: code ?? 1, stdout, stderr,...(options.binaryOutput?{stdoutBytes:Buffer.concat(chunks)}:{}) }); });
  });
  await runHooks(config, 'PostToolUse', { tool: 'run_command', command, args, code: result.code }, cwd);
  await audit({ event: 'command', ...(actor ? { actor } : {}), outcome: result.code === 0 ? 'success' : 'failure', details: { command, args, cwd: relative(process.cwd(), cwd), code: result.code } });
  return result;
}
