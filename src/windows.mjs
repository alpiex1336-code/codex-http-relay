import path from 'node:path';
import {run} from './process.mjs';

export function powershellSpec(script,sourceEnv=process.env) {
  const root=Object.entries(sourceEnv).find(([key])=>key.toLowerCase()==='systemroot')?.[1];
  if(!root) throw new Error('Windows SystemRoot is unavailable.');
  const home=path.win32.join(root,'System32','WindowsPowerShell','v1.0');
  const env=Object.fromEntries(Object.entries(sourceEnv).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  // pwsh -> Node -> powershell.exe otherwise inherits incompatible PowerShell 7 modules.
  // Only this child process is changed. Our scripts need Windows system modules only.
  env.PSModulePath=path.win32.join(home,'Modules');
  const command='[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false);\n'+script;
  return {executable:path.win32.join(home,'powershell.exe'),
    args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],env};
}
export function runPowerShell(script,options={}) {
  const spec=powershellSpec(script,options.env??process.env);
  return run(spec.executable,spec.args,{...options,env:spec.env});
}
