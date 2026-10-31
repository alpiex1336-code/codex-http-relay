import {readFile,writeFile,mkdir,lstat,unlink,rename,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {hash,readConfig,planConfig,restoreConfig,atomicWrite,validateOriginal} from './config.mjs';
import {discoverBinary,checkEnvironment,inspectCodex,sameArchives,preflight,smoke,health} from './codex.mjs';
import {run} from './process.mjs';
import {privateDirectory,ensureServiceAbsent,installService,removeService,waitHealthy} from './service.mjs';
import {desktopEvidence} from './desktop-evidence.mjs';

export function paths(codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),platform=process.platform) {
  const home=path.resolve(codexHome), key=hash(home).slice(0,16);
  const root=platform==='darwin'?path.join(os.homedir(),'Library','Application Support')
    :platform==='win32'?process.env.LOCALAPPDATA:path.join(os.homedir(),'.local','share');
  if(!root) throw new Error('LOCALAPPDATA is unavailable.');
  const runtime=path.join(root,'codex-http-relay',key);
  return {codexHome:home,configFile:path.join(home,'config.toml'),runtime,stateFile:path.join(runtime,'install-state.json'),
    serviceName:'local.codex.http-relay.'+key,platform};
}
export async function readState(p) {
  try {
    const info=await lstat(p.stateFile);
    if(!info.isFile()||info.nlink!==1||info.size>8*1024*1024) throw new Error('Invalid installation journal.');
    const state=JSON.parse(await readFile(p.stateFile,'utf8'));
    for(const key of ['codexHome','configFile','runtime','serviceName','platform'])
      if(state[key]!==p[key]) throw new Error('Installation journal belongs to a different location.');
    if(state.format!==1||!/^[a-f0-9-]{36}$/.test(state.id)||!Number.isInteger(state.port)||state.port<1024||state.port>65535
        ||typeof state.plan?.block!=='string'||state.plan?.id!==state.id
        ||state.plan?.baseUrl!==`http://127.0.0.1:${state.port}/backend-api/codex`)
      throw new Error('Unsupported installation journal.');
    return state;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function saveState(state) {await atomicWrite(state.stateFile,JSON.stringify(state,null,2)+'\n');}
export function publicInspection(info) {
  return {accountType:info.accountType,provider:info.config?.model_provider??'openai',
    routeOverridePresent:!!info.config?.openai_base_url,
    capabilities:{imageGeneration:!!info.capabilities?.imageGeneration,webSearch:!!info.capabilities?.webSearch},
    archivedChats:info.archives.visible.length,allProvidersArchivedChats:info.archives.all.length};
}
export async function doctor(options={}) {
  checkEnvironment();
  const p=paths(options.codexHome), binary=await discoverBinary(options.codexBin);
  const version=await run(binary,['--version']);
  if(version.code!==0||!/^codex(?:-cli)?\s+\S+/.test(version.stdout.trim())) throw new Error('Executable did not identify as Codex.');
  const current=await readConfig(p.configFile), state=await readState(p);
  const inspection=await inspectCodex(binary,p.codexHome);
  let applicable=true, reason=null;
  try {
    if(!['darwin','win32'].includes(p.platform)) throw new Error('Automatic installation is unavailable on this OS.');
    if(state) throw new Error('An installation journal exists; use status/verify/rollback instead.');
    validateOriginal(current.text);
    if(inspection.accountType!=='chatgpt') throw new Error('A ChatGPT account login is required; API-key accounts are unsupported.');
    if((inspection.config?.model_provider??'openai')!=='openai'||inspection.config?.openai_base_url)
      throw new Error('Effective provider or route has an existing override.');
    if(inspection.archives.all.length!==inspection.archives.visible.length)
      throw new Error('Archived chats from other providers require manual review. No history will be changed.');
  }catch(e){applicable=false;reason=e.message;}
  return {p,binary,version:version.stdout.trim(),current,inspection,applicable,reason};
}
async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port; await new Promise(resolve=>server.close(resolve));return port;
}

// Dependency injection only for offline tests; executable always uses real checks/services.
export async function install(options={},deps={}) {
  const ops={doctor,preflight,inspectCodex,smoke,ensureServiceAbsent,installService,removeService,waitHealthy,privateDirectory,...deps};
  const checked=await ops.doctor(options);
  if(!checked.applicable) throw new Error(checked.reason);
  const {p,binary,version,current,inspection}=checked;
  if(!options.live) throw new Error('setup requires --live: two short account-backed model checks are mandatory.');
  await ops.preflight(binary,p.codexHome,{model:options.model});
  const id=randomUUID(), port=await freePort();
  const plan=planConfig(current.text,port,id);
  const state={...p,format:1,id,port,node:process.execPath,binary,version,createdAt:new Date().toISOString(),
    stage:'prepared',configExisted:current.existed,plan,desktopVerified:false};
  // A concurrent or unfinished installation must never be adopted or overwritten.
  await mkdir(path.dirname(p.runtime),{recursive:true,mode:0o700});
  await mkdir(p.runtime,{mode:0o700});
  try {await ops.privateDirectory(p.runtime);}
  catch(error) {await rmdir(p.runtime).catch(()=>{});throw error;}
  let configWritten=false;
  try {
    await writeFile(path.join(p.runtime,'config.original.toml'),current.text,{flag:'wx',mode:0o600});
    await writeFile(path.join(p.runtime,'relay.mjs'),await readFile(new URL('./relay.mjs',import.meta.url)),{flag:'wx',mode:0o600});
    await saveState(state);
    await ops.ensureServiceAbsent(state);
    state.stage='starting_service'; await saveState(state);
    await ops.installService(state);
    await ops.waitHealthy(state);
    // Validate actual installed service before switching the global route.
    const probe=await ops.inspectCodex(binary,p.codexHome,{baseUrl:plan.baseUrl});
    if((probe.config?.model_provider??'openai')!=='openai'||probe.config?.openai_base_url!==plan.baseUrl
        ||!sameArchives(inspection.archives,probe.archives)
        ||!isDeepStrictEqual(inspection.capabilities,probe.capabilities))
      throw new Error('Provider, archive visibility or capability regression before config activation.');
    state.stage='activating_config';await saveState(state);
    await atomicWrite(p.configFile,plan.installed,{expectedHash:plan.originalHash,expectedExists:current.existed});
    configWritten=true;state.stage='testing_config';await saveState(state);
    const after=await ops.inspectCodex(binary,p.codexHome);
    if((after.config?.model_provider??'openai')!=='openai'||after.config?.openai_base_url!==plan.baseUrl
        ||!sameArchives(inspection.archives,after.archives)
        ||!isDeepStrictEqual(inspection.capabilities,after.capabilities))
      throw new Error('Effective configuration or archive/capability verification failed.');
    state.smoke=await ops.smoke(binary,p.codexHome,{model:options.model,port,id,instanceId:id});
    state.stage='backend_verified_desktop_pending';state.backendVerifiedAt=new Date().toISOString();
    await saveState(state);
    return {stage:state.stage,version,desktopVerified:false,restartRequired:true,smoke:state.smoke,
      archivedChats:after.archives.visible.length,platform:p.platform};
  }catch(error) {
    // If config restoration fails, keep the relay alive: never strand a route pointing to a stopped service.
    let restored=!configWritten;
    try {
      const latest=await readConfig(p.configFile);
      if(latest.text.startsWith(plan.block)) {
        const original=restoreConfig(latest.text,plan);
        await atomicWrite(p.configFile,original,{expectedHash:hash(latest.text),expectedExists:latest.existed});
        restored=true;
      }else if(hash(latest.text)===plan.originalHash) restored=true;
      if(!restored) throw new Error('Config changed; manual recovery required.');
      await ops.removeService(state);
      state.stage='rolled_back_after_failure';await saveState(state);
    }catch {state.stage='recovery_required';await saveState(state).catch(()=>{});throw new Error('Install failed and automatic recovery needs attention. Run status; retain the journal and relay.');}
    const failure=new Error(`Install failed; configuration restored and new service removed. ${error.message}`);
    failure.check=error.check; throw failure;
  }
}

export async function status(options={}) {
  const p=paths(options.codexHome),state=await readState(p);
  if(!state) return {stage:'not_installed',desktopVerified:false};
  const current=await readConfig(p.configFile);
  let relayHealthy=false;
  try{await health(state.port,state.id);relayHealthy=true;}catch{}
  return {stage:state.stage,routeManaged:current.text.startsWith(state.plan.block),relayHealthy,
    desktopVerified:false,version:state.version,platform:state.platform,backendVerifiedAt:state.backendVerifiedAt??null};
}

export async function verify(options={}) {
  checkEnvironment();
  const p=paths(options.codexHome),state=await readState(p);
  if(!state) throw new Error('No installation journal found.');
  const current=await readConfig(p.configFile);
  if(!current.text.startsWith(state.plan.block)) throw new Error('Managed routing is absent or changed.');
  if(hash(await readFile(path.join(state.runtime,'relay.mjs')))!==hash(await readFile(new URL('./relay.mjs',import.meta.url))))
    throw new Error('Installed relay differs from this checkout; review the version before testing.');
  const binary=await discoverBinary(options.codexBin);
  const inspection=await inspectCodex(binary,p.codexHome);
  if((inspection.config?.model_provider??'openai')!=='openai'||inspection.config?.openai_base_url!==state.plan.baseUrl)
    throw new Error('Actual effective route differs from the installed relay.');
  const result={...publicInspection(inspection),relayHealthy:!!await health(state.port,state.id),desktopVerified:false};
  if(options.live) result.smoke=await smoke(binary,p.codexHome,{model:options.model,port:state.port,instanceId:state.id});
  return result;
}

export async function rollback(options={}) {
  const p=paths(options.codexHome),state=await readState(p);
  if(!state) return {stage:'not_installed'};
  const current=await readConfig(p.configFile);
  if(current.text.startsWith(state.plan.block)) {
    const restored=restoreConfig(current.text,state.plan);
    await atomicWrite(p.configFile,restored,{expectedHash:hash(current.text),expectedExists:current.existed});
  }else if(current.text.includes(state.plan.baseUrl)) {
    throw new Error('Configuration still references this relay outside its managed block; review before stopping it.');
  }else if(!['rolled_back_service_retained','rolled_back','rolled_back_after_failure'].includes(state.stage)) {
    if(hash(current.text)!==state.plan.originalHash) throw new Error('Config differs from known versions; refusing destructive restoration.');
  }
  // Default retains service until the app is restarted; loaded old routes may still need it.
  if(options.stopService) await removeService(state);
  state.stage=options.stopService?'rolled_back':'rolled_back_service_retained';
  await saveState(state);
  return {stage:state.stage,restartRequired:true,backupRetained:true};
}

export async function uninstall(options={}) {
  const p=paths(options.codexHome),state=await readState(p);
  if(!state) return {stage:'not_installed'};
  await rollback({...options,stopService:true});
  // Retain private backups outside the checkout. A fresh install can now use the original location.
  await rename(p.runtime,p.runtime+'.removed-'+state.id);
  return {stage:'uninstalled',restartRequired:true,backupRetained:true};
}

export async function evidence(options={}) {
  const p=paths(options.codexHome),state=await readState(p);
  if(!state) throw new Error('No installation journal found.');
  return desktopEvidence(p.codexHome,{threadId:options.threadId,since:options.since,baseUrl:state.plan.baseUrl});
}

export async function withInstallLock(options,operation) {
  const p=paths(options.codexHome),file=p.runtime+'.lock';
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  try{await writeFile(file,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}
  catch(e){if(e.code==='EEXIST')throw new Error('Another operation or a stale lock exists. Review the local lock and process before retrying.');throw e;}
  try{return await operation();}finally{await unlink(file);}
}
