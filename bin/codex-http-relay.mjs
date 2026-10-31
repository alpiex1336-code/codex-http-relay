#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {doctor,install,status,verify,rollback,uninstall,evidence,withInstallLock,publicInspection} from '../src/install.mjs';
import {preflight,checkEnvironment} from '../src/codex.mjs';

const help=`codex-http-relay (Node 24+, macOS / experimental Windows)
  doctor                Inspect applicability; no config changes or inference
  preflight --live      Test real 426 -> HTTP with a temporary relay; no config changes
  setup --live          Preflight, back up, install user service, activate, verify
  status                Read installation journal and local service health
  verify [--live]       Verify backend routing; optional short real model check
  desktop-evidence      Read bounded, redacted evidence: --thread-id UUID --since ISO
  rollback              Restore config, retain service until desktop restart
  rollback --stop-service  Restore config and remove service (restart desktop first)
  uninstall             Restore config, remove service, retain backups (close desktop first)
Options: --codex-bin <bundled executable> --codex-home <directory> --model <model>
No command certifies desktop UI success. Read INSTALL_FOR_AGENTS.md.
`;
try {
  if(Number(process.versions.node.split('.')[0])<24) throw new Error('Node 24 or later is required.');
  const {values,positionals}=parseArgs({allowPositionals:true,options:{
    'codex-bin':{type:'string'},'codex-home':{type:'string'},model:{type:'string'},
    live:{type:'boolean'},'stop-service':{type:'boolean'},help:{type:'boolean'},
    'thread-id':{type:'string'},since:{type:'string'}}});
  const [command]=positionals;
  if(values.help||!command) {process.stdout.write(help);} else {
    if(positionals.length!==1) throw new Error('Unexpected positional arguments.');
    const options={codexBin:values['codex-bin'],codexHome:values['codex-home'],model:values.model,live:values.live,stopService:values['stop-service'],threadId:values['thread-id'],since:values.since};
    let result;
    if(command==='doctor'||command==='preflight') {
      const d=await doctor(options);
      result={applicable:d.applicable,reason:d.reason,version:d.version,platform:d.p.platform,...publicInspection(d.inspection)};
      if(command==='preflight') {
        if(!values.live) throw new Error('preflight requires --live for one account-backed model check.');
        if(!d.applicable) throw new Error(d.reason);
        checkEnvironment(); result.smoke=await preflight(d.binary,d.p.codexHome,{model:options.model});
      }
    }else if(command==='setup') result=await withInstallLock(options,()=>install(options));
    else if(command==='status') result=await status(options);
    else if(command==='verify') result=await verify(options);
    else if(command==='rollback') result=await withInstallLock(options,()=>rollback(options));
    else if(command==='uninstall') result=await withInstallLock(options,()=>uninstall(options));
    else if(command==='desktop-evidence') result=await evidence(options);
    else throw new Error('Unknown command. Use --help.');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }
}catch(error) {
  // Errors in this code have deliberate messages; raw OS/parse exceptions may expose local paths/config.
  const message=error.code||error.name!=='Error'?'Operation failed; check permissions, paths and TOML validity locally.':error.message;
  process.stderr.write(JSON.stringify({ok:false,error:message,...(error.check?{check:error.check}:{})},null,2)+'\n');
  process.exitCode=1;
}
