import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile,appendFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {defaultConfig} from '../src/config.js';
import {trustWorkspace} from '../src/workspaceTrust.js';
import {prepareRecoveryRemote,runRecoveryRemote,queryRecoveryRemote} from '../src/recoveryMaintenance.js';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import {executeCommand} from '../src/policy.js';
const csc='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const url='ssh://git@backup.example.invalid/recovery.git';
async function fixture(action:(root:string,c:typeof defaultConfig,git:(...a:string[])=>string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'ccpt-ssh068-')),old=process.env.CCPT_HOME;process.env.CCPT_HOME=join(root,'home');const git=(...args:string[])=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();try{git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(root,'file'),'fixture');git('add','file');git('commit','-m','base');git('update-ref','refs/ccpt/recovery/agent_1111111111111111/save_1111111111111111',git('rev-parse','HEAD'));git('remote','add','fixture',url);const c=structuredClone(defaultConfig);c.hooks=[];c.policy.workspaceRoots=[root];c.policy.allowGitPush=true;c.policy.allowNetwork=true;c.network.allowedHosts=['backup.example.invalid'];c.recoveryRemote={remote:'fixture',expectedUrl:url,transport:'ssh-wrapper'};await trustWorkspace(root);await action(root,c,git)}finally{if(old===undefined)delete process.env.CCPT_HOME;else process.env.CCPT_HOME=old;await removeOwnedTemporaryFixture(root)}}
test('SSH remote requires explicit absolute launcher before running any command',()=>fixture(async(root,c)=>{
 await expect(prepareRecoveryRemote(root,true,c)).rejects.toThrow('absolute enterprise');c.policy.processWrapper='relative';await expect(prepareRecoveryRemote(root,true,c)).rejects.toThrow('absolute enterprise');
}));
// This launcher rewrites an exact fixture SSH URL to an OWNED LOCAL bare repo.
// It exercises real process-wrapper invocation/atomic Git push, NOT SSH transport,
// host-key verification, remote credentials or enterprise server interoperability.
test('real wrapper-bound receipt rejects binary change; exact local-fixture push/query cannot replay',async()=>{
 if(process.platform!=='win32')return;await access(csc);
 await fixture(async(root,c,git)=>{
  const bare=join(root,'bare.git'),log=join(root,'wrapper.log'),source=join(root,'launcher.cs'),exe=join(root,'launcher.exe');git('init','--bare',bare);
  // Paths are embedded as C# verbatim literals; Windows fixture paths cannot contain quotes.
  const literal=(s:string)=>'@"'+s.replaceAll('"','""')+'"';
  await writeFile(source,`using System;using System.IO;using System.Diagnostics;using System.Text;
class Launcher { static string Q(string s){var b=new StringBuilder();b.Append((char)34);int n=0;foreach(char c in s){if(c==(char)92){n++;continue;}if(c==(char)34){b.Append((char)92,n*2+1);b.Append(c);n=0;continue;}b.Append((char)92,n);n=0;b.Append(c);}b.Append((char)92,n*2);b.Append((char)34);return b.ToString();}
static int Main(string[] a){if(a.Length<2||a[0]!="git")return 91;File.AppendAllText(${literal(log)},a[1]+"\\n");var b=new StringBuilder();for(int i=1;i<a.Length;i++){if(i>1)b.Append(' ');b.Append(Q(a[i]==${literal(url)}?${literal(bare)}:a[i]));}var p=Process.Start(new ProcessStartInfo("git",b.ToString()){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true});Console.Write(p.StandardOutput.ReadToEnd());Console.Error.Write(p.StandardError.ReadToEnd());p.WaitForExit();return p.ExitCode;}}
`);
  execFileSync(csc,['/nologo',`/out:${exe}`,source],{windowsHide:true,stdio:['ignore','pipe','pipe']});c.policy.processWrapper=exe;
  // JSON property order must not change a reviewed deployment identity.
  c.recoveryRemote={transport:'ssh-wrapper',expectedUrl:url,remote:'fixture'};
  const probe=await executeCommand('git',['remote','get-url','--push','--all','fixture'],root,c);if(probe.code!==0||probe.stdout.trim()!==url)throw new Error(JSON.stringify(probe));
  const dependency=join(root,'launcher-policy.json');await writeFile(dependency,'original policy');c.recoveryRemote!.launcherDependencies=[dependency];const plan=await prepareRecoveryRemote(root,true,c);expect(plan.sshWrapper!.sha256).toHaveLength(64);const before=await readFile(log,'utf8');expect(plan.sshWrapper!.files).toHaveLength(1);await writeFile(dependency,'changed policy');await expect(runRecoveryRemote(root,plan.id,plan.digest,true,c)).rejects.toThrow('wrapper binding changed');expect(await readFile(log,'utf8')).toBe(before);await writeFile(dependency,'original policy');const bytes=await readFile(exe);await appendFile(exe,'changed');await expect(runRecoveryRemote(root,plan.id,plan.digest,true,c)).rejects.toThrow('wrapper binding changed');expect(await readFile(log,'utf8')).toBe(before);await writeFile(exe,bytes);
  const done=await runRecoveryRemote(root,plan.id,plan.digest,true,c);expect(done.phase).toBe('completed');expect((await queryRecoveryRemote(root,plan.id,true,c)).phase).toBe('completed');await expect(runRecoveryRemote(root,plan.id,plan.digest,true,c)).rejects.toThrow('already attempted');
  expect(await readFile(log,'utf8')).toContain('push');expect(execFileSync('git',['--git-dir',bare,'show-ref'],{encoding:'utf8',windowsHide:true})).toContain(plan.refs[0]!.target);
 });
},25000);
