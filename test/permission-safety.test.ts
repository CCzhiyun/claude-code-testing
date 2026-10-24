import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertManagedPolicyPatch, defaultConfig, loadConfig, managedPermissionFields } from '../src/config.js';
import { consumePermissionGrant, denyPermissionForSession, grantPermissionForSession, grantPermissionOnce, permissionInputHash, permissionRequestPayload, parsePermissionRequest } from '../src/permissionApprovals.js';
import { buildPermissionPreview, replacementPreview } from '../src/permissionPreview.js';
import { listPermissionDenials, recordPermissionDenial } from '../src/permissionHistory.js';
import { createPermissionDialog, navigateApproval, renderApprovalDialog, type ApprovalDialogState } from '../src/components/permissionDialog.js';
import { permissionTabLocked, renderPermissionsDialog, type PermissionsDialogState } from '../src/components/commandDialogs.js';
import { executeTool } from '../src/tooling.js';
import { createSession } from '../src/sessions.js';
import { writeJson } from '../src/storage.js';
import { stripAnsi, terminalWidth } from '../src/ink.js';

test('once grants bind full arguments, serialize no input, consume atomically and reject old grants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-permission-grant-'));
  const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = root;
  try {
    const request = permissionRequestPayload('session', 'write_file', { path: 'same.txt', content: 'sensitive-body' }, 'ask');
    await grantPermissionOnce(request);
    expect(await readFile(join(root, 'permission-approvals.json'), 'utf8')).not.toContain('sensitive-body');
    expect(await consumePermissionGrant('session', 'write_file', { path: 'same.txt', content: 'changed' })).toBe(false);
    expect(await consumePermissionGrant('another', 'write_file', request.input)).toBe(false);
    const results = await Promise.all([consumePermissionGrant('session', 'write_file', request.input), consumePermissionGrant('session', 'write_file', { content: 'sensitive-body', path: 'same.txt' })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(permissionInputHash({ args: ['a b', 'c'] })).not.toBe(permissionInputHash({ args: ['a', 'b c'] }));
    await grantPermissionForSession(request);
    expect(await consumePermissionGrant('session', 'write_file', { path: 'same.txt', content: 'changed' })).toBe(true);
    expect(await consumePermissionGrant('session', 'write_file', { path: 'other.txt', content: 'changed' })).toBe(false);
    const grants = JSON.parse(await readFile(join(root, 'permission-approvals.json'), 'utf8'));
    delete grants[0].version; await writeJson(join(root, 'permission-approvals.json'), grants);
    expect(await consumePermissionGrant('session', 'write_file', request.input)).toBe(false);
  } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
});

test('previews are bounded and protected, deny beats grants, user denial blocks retries without ask rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-permission-preview-'));
  const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  try {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root]; config.hooks = []; config.policy.permissionRules.ask = ['write_file(*)'];
    await writeFile(join(root, 'a.txt'), 'header\nold\nfooter');
    const input = { path: 'a.txt', content: 'header\nnew\nfooter' };
    const preview = await buildPermissionPreview('write_file', input, root, config);
    expect(preview).toContain('-old'); expect(preview).toContain('+new'); expect(preview).not.toContain('-header');
    expect((await buildPermissionPreview('write_file', { path: 'new.txt', content: 'created' }, root, config))).toContain('Create new.txt');
    expect(replacementPreview('x', Array.from({ length: 1000 }, () => 'y'.repeat(1000)).join('\n')).length).toBeLessThan(32000);
    await expect(buildPermissionPreview('write_file', { path: '../outside.txt', content: 'x' }, root, config)).rejects.toThrow();
    await writeFile(join(root, '.env'), 'SECRET-CONTENT');
    await expect(buildPermissionPreview('write_file', { path: '.env', content: 'x' }, root, config)).rejects.toThrow();
    const session = await createSession('permission test', root);
    const context = { config, cwd: root, agentId: 'agent-test', sessionId: session.id, depth: 0 };
    const delegate = async () => '';
    const pending = parsePermissionRequest((await executeTool('write_file', input, context, delegate)).content)!;
    expect(pending.preview).toContain('-old'); expect(await readFile(join(root, 'a.txt'), 'utf8')).toContain('old');
    await grantPermissionOnce(pending);
    config.policy.permissionRules.deny = ['write_file(*)'];
    await expect(executeTool('write_file', input, context, delegate)).rejects.toThrow('Permission denied');
    expect((await listPermissionDenials(root))[0]?.source).toBe('policy');
    config.policy.permissionRules.deny = []; config.policy.permissionRules.ask = [];
    await denyPermissionForSession(pending);
    await expect(executeTool('write_file', input, context, delegate)).rejects.toThrow('User denied');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toContain('old');
  } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
});

test('permission picker cancels without deciding, requires Enter, scrolls and sanitizes terminal controls', () => {
  const request = permissionRequestPayload('s', 'write_file', { path: 'file.ts', content: 'safe' }, 'ask');
  request.preview = `\u001b]2;forged-title\u0007\n${'+long 中文 text\n'.repeat(90)}`;
  const state: ApprovalDialogState = { ...createPermissionDialog(request), type: 'approval', agentId: 'a', scroll: 0 };
  expect(navigateApproval(state, 'escape')).toBe('cancel');
  expect(navigateApproval(state, '', '3')).toBe('render'); expect(state.choices[state.selected]).toBe('deny');
  expect(navigateApproval(state, 'return')).toBe('submit');
  navigateApproval(state, 'pagedown'); expect(state.scroll).toBe(6);
  const lines = renderApprovalDialog(state, 75, 24);
  expect(lines.length).toBeLessThanOrEqual(24); expect(lines.every((line) => terminalWidth(line) <= 75)).toBe(true);
  expect(stripAnsi(lines.join('\n'))).not.toContain('\u0007'); expect(lines.join('\n')).not.toContain('\u001b]2;');
  expect(lines.join('\n')).toContain('Enter confirm');
  const small = renderApprovalDialog(state, 60, 8).join('\n'); expect(small).toContain('deny'); expect(small).toContain('Enter confirm');
  const invalid = JSON.stringify({ ...request, subject: 'other-file.ts' }); expect(parsePermissionRequest(invalid)).toBeUndefined();
});

test('recent denials are scoped, credential redacted and managed tabs are read only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-permission-history-'));
  const previous = process.env.CCPT_HOME, previousManaged = process.env.CCPT_MANAGED_CONFIG;
  process.env.CCPT_HOME = join(root, 'state'); process.env.CCPT_MANAGED_CONFIG = join(root, 'managed.json');
  try {
    await recordPermissionDenial({ cwd: root, sessionId: 's', tool: 'run_command', subject: 'node SECRET-EXACT', reason: 'Bearer abcdef', source: 'user' }, ['SECRET-EXACT']);
    await recordPermissionDenial({ cwd: join(root, 'other'), sessionId: 's2', tool: 'write_file', subject: 'other', reason: 'no', source: 'policy' });
    const records = await listPermissionDenials(root); expect(records).toHaveLength(1); expect(records[0]?.subject).not.toContain('SECRET-EXACT'); expect(records[0]?.reason).not.toContain('abcdef');
    await writeJson(process.env.CCPT_MANAGED_CONFIG!, { policy: { mode: 'restricted', permissionRules: { deny: ['write_file(*)'] } } });
    await writeJson(join(root, '.ccpt', 'settings.json'), { policy: { mode: 'bypass' } });
    const config = await loadConfig(root); expect(config.policy.mode).toBe('restricted');
    expect(() => assertManagedPolicyPatch(config, { mode: 'bypass' })).toThrow('controlled by your administrator');
    expect(() => assertManagedPolicyPatch(config, { permissionRules: { deny: [], allow: [] } })).toThrow('controlled by your administrator');
    expect(() => assertManagedPolicyPatch(config, { permissionRules: { allow: ['read_file(*)'] } })).not.toThrow();
    const state: PermissionsDialogState = { type: 'permissions', tab: 'Mode', selected: 0, adding: false, input: '', managedFields: managedPermissionFields(), recent: records };
    expect(permissionTabLocked(state)).toBe(true);
    expect(renderPermissionsDialog(config, state, 100, 25).join('\n')).toContain('Managed by your administrator');
    state.tab = 'Allow'; expect(permissionTabLocked(state)).toBe(false);
    state.tab = 'Deny'; expect(permissionTabLocked(state)).toBe(true);
    state.tab = 'Recent'; expect(permissionTabLocked(state)).toBe(true);
    expect(renderPermissionsDialog(config, state, 100, 25).join('\n')).toContain('run_command');
  } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; if (previousManaged === undefined) delete process.env.CCPT_MANAGED_CONFIG; else process.env.CCPT_MANAGED_CONFIG = previousManaged; await rm(root, { recursive: true, force: true }); }
});
