import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runPowerShell,powershellSpec} from '../src/windows.mjs';
import {windowsPrivateDirectoryScript,psQuote} from '../src/service.mjs';

test('Windows private runtime ACL works on a disposable directory',{skip:process.platform!=='win32'},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"relay ACL O'Brien & "));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const result=await runPowerShell(windowsPrivateDirectoryScript(dir));
  // This isolated test contains no credentials or user config. Expose its error only for diagnosis.
  assert.equal(result.code,0,result.stderr);
  const inspect=await runPowerShell(
    `$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath ${psQuote(dir)}; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $ids=@($a.Access | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); $ok=$a.AreAccessRulesProtected -and $ids.Count -eq 2 -and $ids.Contains($u) -and $ids.Contains('S-1-5-18'); if(-not $ok){exit 3}`);
  assert.equal(inspect.code,0,inspect.stderr);
});

test('PowerShell edition paths are isolated without changing the parent environment',()=>{
  const env={SystemRoot:'C:\\Windows',PSMODULEPATH:'C:\\Program Files\\PowerShell\\7\\Modules',Fixture:'preserved'};
  const source=structuredClone(env),script="Write-Output '路徑 O''Brien & test'";
  const spec=powershellSpec(script,env);
  assert.deepEqual(env,source);assert.equal(spec.env.PSMODULEPATH,undefined);
  assert.equal(spec.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(spec.executable,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(Buffer.from(spec.args.at(-1),'base64').toString('utf16le').endsWith(script));
  assert.equal(spec.env.Fixture,'preserved');assert.equal(spec.args.includes('-ExecutionPolicy'),false);
});
