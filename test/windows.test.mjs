import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {run} from '../src/process.mjs';
import {windowsPrivateDirectoryScript,psQuote} from '../src/service.mjs';

test('Windows private runtime ACL works on a disposable directory',{skip:process.platform!=='win32'},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"relay ACL O'Brien & "));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',windowsPrivateDirectoryScript(dir)]);
  // This isolated test contains no credentials or user config. Expose its error only for diagnosis.
  assert.equal(result.code,0,result.stderr);
  const inspect=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath ${psQuote(dir)}; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $ids=@($a.Access | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); $ok=$a.AreAccessRulesProtected -and $ids.Count -eq 2 -and $ids.Contains($u) -and $ids.Contains('S-1-5-18'); if(-not $ok){exit 3}`]);
  assert.equal(inspect.code,0,inspect.stderr);
});
