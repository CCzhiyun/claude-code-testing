import {test,expect} from 'bun:test';
import {mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeCredentialInvocation,readNativeCredential} from '../src/nativeCredentials.js';
import {handleMcpInteraction,type McpInteractionHandlers} from '../src/mcpInteraction.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
test('native credentials use fixed helpers and stdin, namespace-bound selectors, and never put secrets in argv',()=>{
 const data=Buffer.from('secret-你好-"\nother'),linux=nativeCredentialInvocation('linux-secret-service','write','model:test',data,'linux'),mac=nativeCredentialInvocation('macos-keychain','write','model:test',data,'darwin');
 expect(linux.executable).toBe('/usr/bin/secret-tool');expect(mac.args).toEqual(['-i']);expect(JSON.stringify([linux.args,mac.args])).not.toContain('secret-');expect(linux.input).toBe(data.toString('base64'));expect(mac.input.split('\n')).toHaveLength(2);expect(mac.input).toContain(data.toString('base64'));expect(nativeCredentialInvocation('linux-secret-service','read','mcp:test',undefined,'linux').args).not.toEqual(nativeCredentialInvocation('linux-secret-service','read','model:test',undefined,'linux').args);
 expect(()=>nativeCredentialInvocation('linux-secret-service','write','test',Buffer.alloc(5001),'linux')).toThrow('bounds');expect(()=>nativeCredentialInvocation('macos-keychain','read','test',undefined,'win32')).toThrow('unavailable');
});
test('unavailable native backend fails closed without creating plaintext credential files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ccpt-native-061-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=root;
 try{const backend=process.platform==='darwin'?'linux-secret-service':'macos-keychain';await expect(readNativeCredential(backend,'fixture')).rejects.toThrow('unavailable');expect(await readdir(root)).toEqual([]);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
});
test('nested MCP approvals have an explicit bounded depth instead of recursive unlimited delegation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ccpt-nested-061-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=root;let calls=0;const controller=new AbortController();
 const params={message:'Choose a review option',requestedSchema:{type:'object',properties:{}}};
 const handlers:McpInteractionHandlers={elicit:async()=>{calls++;const outcome=await handleMcpInteraction('elicitation/create',params,handlers,controller.signal);if(calls===3)expect(outcome).toMatchObject({error:{message:'MCP interaction nesting limit exceeded'}});return {action:'decline'};}};
 try{await handleMcpInteraction('elicitation/create',params,handlers,controller.signal);expect(calls).toBe(3);}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root);}
});
