import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installVsCodeExtension } from '../src/ide-install.js';

let root = '';
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'ccpt-ide-')); process.env.VSCODE_EXTENSIONS = root; });
afterAll(async () => { delete process.env.VSCODE_EXTENSIONS; await rm(root, { recursive: true, force: true }); });

describe('IDE integration package', () => {
  test('installs the bundled extension into the configured extension directory', async () => {
    const target = await installVsCodeExtension('0.5.0-test');
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as { displayName?: string };
    expect(manifest.displayName).toBe('CCPT');
    const extension = await readFile(join(target, 'extension.js'), 'utf8');
    expect(extension).toContain('vscode.workspace.fs.readFile');
    expect(extension).toContain('Attached file contents');
    expect(extension).toContain("require('./bridge.cjs')");
    const bridge = await readFile(join(target, 'bridge.cjs'), 'utf8');
    expect(bridge).toContain("message.method === 'runtime/event'");
    expect(bridge).toContain("this.request('project/watch'");
    expect(bridge).toContain('module.exports = { BridgeTransport }');
    expect(extension).toContain("event.type==='text_delta'");
    expect(extension).toContain("event.type==='tool_started'");
  });
});
