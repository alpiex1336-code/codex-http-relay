import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {install} from '../src/install.mjs';
import {psQuote,launchPlist,windowsRunner,windowsInstallScript} from '../src/service.mjs';

async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'relay installer spaces '));t.after(()=>rm(dir,{recursive:true,force:true}));
  const p={runtime:path.join(dir,'runtime'),configFile:path.join(dir,'config.toml'),codexHome:dir,stateFile:path.join(dir,'runtime','install-state.json'),platform:process.platform,serviceName:'test-owned'};
  const original='# original settings\nmodel = "fixture"\n';await writeFile(p.configFile,original);
  const inspection={accountType:'chatgpt',config:{model_provider:'openai'},capabilities:{imageGeneration:true},archives:{all:['fixture-id'],visible:['fixture-id']}};
  let removed=false,started=false;
  const deps={doctor:async()=>({p,binary:'fixture',version:'fixture',current:{text:original,existed:true},inspection,applicable:true}),
    preflight:async()=>({passed:true}),ensureServiceAbsent:async()=>{},installService:async()=>{started=true;},waitHealthy:async()=>{},
    inspectCodex:async(_bin,_home,options={})=>{
      const state=JSON.parse(await readFile(p.stateFile,'utf8'));
      return {...inspection,config:{model_provider:'openai',openai_base_url:options.baseUrl??state.plan.baseUrl}};
    },smoke:async()=>({passed:true,desktopVerified:false}),removeService:async()=>{removed=true;}};
  return {p,original,deps,inspection,removed:()=>removed,started:()=>started};
}
test('successful setup is explicitly desktop pending, not universal success',async t=>{
  const f=await fixture(t),result=await install({live:true},f.deps);
  assert.equal(result.stage,'backend_verified_desktop_pending');assert.equal(result.desktopVerified,false);assert.equal(result.restartRequired,true);
  assert.equal(f.started(),true);assert.equal(f.removed(),false);
  assert.equal(await readFile(path.join(f.p.runtime,'config.original.toml'),'utf8'),f.original);
});
test('failed real-service check restores original config and removes new service',async t=>{
  const f=await fixture(t);f.deps.smoke=async()=>{throw new Error('fixture failure');};
  await assert.rejects(install({live:true},f.deps),/configuration restored/);
  assert.equal(await readFile(f.p.configFile,'utf8'),f.original);assert.equal(f.removed(),true);
  const journal=JSON.parse(await readFile(f.p.stateFile,'utf8'));assert.equal(journal.stage,'rolled_back_after_failure');
});
test('capability or archive regression leaves config unchanged',async t=>{
  const f=await fixture(t);f.deps.inspectCodex=async()=>({...f.inspection,capabilities:{imageGeneration:false}});
  await assert.rejects(install({live:true},f.deps),/regression/);
  assert.equal(await readFile(f.p.configFile,'utf8'),f.original);assert.equal(f.removed(),true);
});
test('preflight failure creates no service and does not write config',async t=>{
  const f=await fixture(t);f.deps.preflight=async()=>{throw new Error('no fallback');};
  await assert.rejects(install({live:true},f.deps),/no fallback/);
  assert.equal(f.started(),false);assert.equal(await readFile(f.p.configFile,'utf8'),f.original);
  await assert.rejects(readFile(f.p.stateFile),{code:'ENOENT'});
});
test('concurrent config change is retained when setup aborts',async t=>{
  const f=await fixture(t);f.deps.waitHealthy=async()=>{await writeFile(f.p.configFile,'model = "new-user-choice"\n');};
  await assert.rejects(install({live:true},f.deps),/configuration restored/);
  assert.equal(await readFile(f.p.configFile,'utf8'),'model = "new-user-choice"\n');assert.equal(f.removed(),true);
});
test('modified managed route during failure keeps relay and requests recovery',async t=>{
  const f=await fixture(t);f.deps.smoke=async()=>{
    const text=await readFile(f.p.configFile,'utf8');await writeFile(f.p.configFile,text.replace('openai_base_url','changed_route'));throw new Error('fixture failure');
  };
  await assert.rejects(install({live:true},f.deps),/recovery needs attention/);
  assert.equal(f.removed(),false);assert.match(await readFile(f.p.configFile,'utf8'),/changed_route/);
});
test('unrelated settings added during failed smoke survive automatic rollback',async t=>{
  const f=await fixture(t);f.deps.smoke=async()=>{
    await writeFile(f.p.configFile,(await readFile(f.p.configFile,'utf8'))+'\n[features]\nfixture = true\n');throw new Error('fixture failure');
  };
  await assert.rejects(install({live:true},f.deps),/configuration restored/);
  assert.equal(await readFile(f.p.configFile,'utf8'),f.original+'\n[features]\nfixture = true\n');
});
test('live tests cannot be skipped on setup',async t=>{
  const f=await fixture(t);await assert.rejects(install({},f.deps),/--live/);assert.equal(f.started(),false);
});
test('service rendering preserves spaces and escapes command/XML injection',()=>{
  const state={serviceName:'local.test',node:'/fixture/Node & Co/node',runtime:"/fixture/O'Brien & Co",port:18888,id:'00000000-0000-4000-8000-000000000001'};
  assert.equal(psQuote("a'b"),"'a''b'");assert.match(launchPlist(state),/Node &amp; Co/);assert.match(launchPlist(state),/O&apos;Brien/);
  assert.match(windowsRunner(state),/O''Brien/);assert.match(windowsInstallScript(state),/-RunLevel Limited/);
  assert.doesNotMatch(windowsInstallScript(state),/Bypass|Highest|Password/);
});
