import {mkdir,readFile,writeFile,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {run} from './process.mjs';
import {health} from './codex.mjs';

const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export const psQuote = value => "'"+String(value).replaceAll("'","''")+"'";
const psArgs = script => ['-NoProfile','-NonInteractive','-Command',script];
async function checked(exe,args) {
  const r=await run(exe,args);
  if(r.code!==0||r.timedOut) throw new Error('User service operation failed. Check local OS service policy; no elevation was attempted.');
  return r;
}
export async function privateDirectory(dir) {
  await mkdir(dir,{recursive:true,mode:0o700});
  if(!(await lstat(dir)).isDirectory()) throw new Error('Runtime path must be a real directory.');
  if(process.platform==='win32') {
    await checked('powershell.exe',psArgs(windowsPrivateDirectoryScript(dir)));
  }
}
export function windowsPrivateDirectoryScript(dir) {
  return `$ErrorActionPreference='Stop'; $p=${psQuote(dir)}; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($who in @($sid,(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))){ $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $p -AclObject $acl`;
}

export function launchPlist(state) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xml(state.serviceName)}</string>
<key>ProgramArguments</key><array>${[state.node,path.join(state.runtime,'relay.mjs'),String(state.port),state.id].map(v=>`<string>${xml(v)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>5</integer><key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
</dict></plist>\n`;
}
export function windowsRunner(state) {
  return `$ErrorActionPreference = 'Stop'\r\n& ${[state.node,path.join(state.runtime,'relay.mjs'),String(state.port),state.id].map(psQuote).join(' ')}\r\nexit $LASTEXITCODE\r\n`;
}
export function windowsInstallScript(state) {
  const runner=path.join(state.runtime,'run-relay.ps1');
  const argumentsText=`-NoProfile -NonInteractive -WindowStyle Hidden -File "${runner}"`;
  return `$ErrorActionPreference='Stop'; $name=${psQuote(state.serviceName)};
if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Task already exists'};
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
$a=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ${psQuote(argumentsText)};
$t=New-ScheduledTaskTrigger -AtLogOn -User $sid;
$p=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited;
$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew;
Register-ScheduledTask -TaskName $name -Action $a -Trigger $t -Principal $p -Settings $s -Description ${psQuote('codex-http-relay '+state.id)} | Out-Null;
Start-ScheduledTask -TaskName $name;`;
}

export async function ensureServiceAbsent(state) {
  if(state.platform==='darwin') {
    const plist=path.join(os.homedir(),'Library','LaunchAgents',state.serviceName+'.plist');
    if(await lstat(plist).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;}))
      throw new Error('A service file already exists; it will not be replaced.');
    const check=await run('/bin/launchctl',['print',`gui/${process.getuid()}/${state.serviceName}`]);
    if(check.code===0) throw new Error('A service with this name is already loaded.');
  } else if(state.platform==='win32') {
    await checked('powershell.exe',psArgs(`$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName ${psQuote(state.serviceName)} -ErrorAction SilentlyContinue){exit 2}`));
  } else throw new Error('Automatic installation supports macOS and Windows only.');
}

export async function installService(state) {
  await ensureServiceAbsent(state);
  if(state.platform==='darwin') {
    const dir=path.join(os.homedir(),'Library','LaunchAgents'); await mkdir(dir,{recursive:true});
    const plist=path.join(dir,state.serviceName+'.plist');
    await writeFile(plist,launchPlist(state),{flag:'wx',mode:0o600});
    await checked('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plist]);
  } else {
    await writeFile(path.join(state.runtime,'run-relay.ps1'),windowsRunner(state),{flag:'wx',mode:0o600});
    await checked('powershell.exe',psArgs(windowsInstallScript(state)));
  }
}

export async function removeService(state) {
  if(state.platform==='darwin') {
    const plist=path.join(os.homedir(),'Library','LaunchAgents',state.serviceName+'.plist');
    let content;
    try{content=await readFile(plist,'utf8');}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(content!==launchPlist(state)) throw new Error('Service file changed; refusing to remove it.');
    const domain=`gui/${process.getuid()}`;
    const loaded=await run('/bin/launchctl',['print',domain+'/'+state.serviceName]);
    if(loaded.code===0) {
      await checked('/bin/launchctl',['bootout',domain+'/'+state.serviceName]);
      let stopped=false;
      for(let attempt=0;attempt<40;attempt++) {
        if((await run('/bin/launchctl',['print',domain+'/'+state.serviceName])).code!==0) {stopped=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!stopped) throw new Error('Service is still stopping; retained its file for recovery.');
    }
    await unlink(plist);
  } else if(state.platform==='win32') {
    const expectedArguments=`-NoProfile -NonInteractive -WindowStyle Hidden -File "${path.join(state.runtime,'run-relay.ps1')}"`;
    const script=`$ErrorActionPreference='Stop'; $name=${psQuote(state.serviceName)}; $t=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue; if($null -ne $t){if($t.Description -ne ${psQuote('codex-http-relay '+state.id)} -or @($t.Actions).Count -ne 1 -or $t.Actions[0].Execute -ne (Join-Path $PSHOME 'powershell.exe') -or $t.Actions[0].Arguments -ne ${psQuote(expectedArguments)}){throw 'Ownership mismatch'}; Stop-ScheduledTask -TaskName $name; Unregister-ScheduledTask -TaskName $name -Confirm:$false}`;
    await checked('powershell.exe',psArgs(script));
  }
}

export async function waitHealthy(state) {
  for(let attempt=0;attempt<60;attempt++) {
    try {return await health(state.port,state.id);}catch {await new Promise(resolve=>setTimeout(resolve,250));}
  }
  throw new Error('Installed service did not become healthy.');
}
