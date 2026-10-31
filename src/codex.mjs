import {mkdtemp, rm, stat, realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {run,Rpc} from './process.mjs';
import {runPowerShell} from './windows.mjs';
import {createRelay} from './relay.mjs';

export async function discoverBinary(explicit, platform=process.platform) {
  if(explicit) {
    const file=path.resolve(explicit);
    if(!(await stat(file)).isFile()) throw new Error('Codex executable is not a regular file.');
    return realpath(file);
  }
  const candidates=new Set();
  if(platform==='darwin') {
    const ps=await run('/bin/ps',['-axo','command=']);
    for(const line of ps.stdout.split('\n')) {
      const match=line.match(/^(.+\.app\/Contents\/.+\/codex) app-server(?:\s|$)/);
      if(match) candidates.add(match[1]);
    }
    if(!candidates.size) for(const parent of ['/Applications',path.join(os.homedir(),'Applications'),path.join(os.homedir(),'Desktop')]) {
      for(const app of ['ChatGPT.app','Codex.app']) {
        for(const tail of ['Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex','Contents/Resources/codex']) {
          const file=path.join(parent,app,tail);
          if(await stat(file).then(s=>s.isFile()).catch(()=>false)) candidates.add(file);
        }
      }
    }
  } else if(platform==='win32') {
    // Read only processes that are already running; do not substitute a PATH CLI.
    const script="$p=@(Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | Where-Object { $_.CommandLine -match 'app-server' } | Select-Object -ExpandProperty ExecutablePath -Unique); ConvertTo-Json -InputObject $p -Compress";
    const result=await runPowerShell(script);
    if(result.code===0) {
      const values=JSON.parse(result.stdout.trim()||'[]');
      for(const file of Array.isArray(values)?values:[values]) if(file) candidates.add(file);
    }
  }
  if(candidates.size!==1) throw new Error('Cannot uniquely identify the desktop bundled CLI. Open Codex, or supply --codex-bin with its actual executable path.');
  return realpath([...candidates][0]);
}

export function checkEnvironment(env=process.env) {
  const conflicts=['OPENAI_BASE_URL','CODEX_API_KEY','OPENAI_API_KEY','CODEX_CLI_PATH','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_ENV_PROXY'].filter(k=>env[k]);
  if(conflicts.length) throw new Error(`Environment requires manual review (values withheld): ${conflicts.join(', ')}.`);
}

async function archivedIds(rpc, modelProviders) {
  const ids=new Set(); let cursor=null; const cursors=new Set();
  for(let page=0;page<100;page++) {
    const result=await rpc.send('thread/list',{archived:true,modelProviders,limit:100,useStateDbOnly:true,...(cursor?{cursor}:{})});
    if(!Array.isArray(result.data)) throw new Error('Unsupported archived-list response.');
    for(const item of result.data) ids.add(item.id);
    cursor=result.nextCursor;
    if(!cursor) return [...ids].sort();
    if(cursors.has(cursor)) throw new Error('Archived-list pagination repeated.');
    cursors.add(cursor);
  }
  throw new Error('Archive inventory exceeds bounded diagnostic limit.');
}

export async function inspectCodex(binary,codexHome,{baseUrl}={}) {
  const cwd=await mkdtemp(path.join(os.tmpdir(),'codex-http-inspect-'));
  const args=baseUrl?['-c',`openai_base_url=${JSON.stringify(baseUrl)}`]:[];
  const rpc=new Rpc(binary,{cwd,args,env:{...process.env,CODEX_HOME:codexHome}});
  try {
    await rpc.init();
    const account=await rpc.send('account/read',{refreshToken:false});
    const config=await rpc.send('config/read',{includeLayers:false});
    const capabilities=await rpc.send('modelProvider/capabilities/read',{});
    const all=await archivedIds(rpc,[]), visible=await archivedIds(rpc,null);
    return {accountType:account.account?.type??null,config:config.config,capabilities,archives:{all,visible}};
  } finally {rpc.close();await rm(cwd,{recursive:true,force:true});}
}

export function sameArchives(a,b) {
  return JSON.stringify(a.all)===JSON.stringify(b.all) && JSON.stringify(a.visible)===JSON.stringify(b.visible);
}

export function health(port,expectedId) {
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/health',agent:false},res=>{
      let body='';
      res.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy();});
      res.on('error',()=>reject(new Error('Relay health read failed.')));
      res.on('end',()=>{
        try {
          const data=JSON.parse(body);
          if(res.statusCode!==200||data.service!=='codex-http-relay'||data.instanceId!==expectedId) throw new Error();
          resolve(data);
        } catch {reject(new Error('Port belongs to an unexpected or unhealthy service.'));}
      });
    });
    req.setTimeout(3000,()=>req.destroy());
    req.on('error',()=>reject(new Error('Local relay is unavailable.')));
  });
}

export async function smoke(binary,codexHome,{baseUrl,model,port,instanceId,timeout=90000}={}) {
  const cwd=await mkdtemp(path.join(os.tmpdir(),'codex-http-smoke-'));
  const marker=`HTTP_OK_${randomUUID().replaceAll('-','').slice(0,12)}`;
  const before=await health(port,instanceId);
  try {
    const args=['exec','--strict-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json','--color','never',
      '-C',cwd,'-c','approval_policy="never"','-c','sandbox_mode="read-only"','-c','model_reasoning_effort="low"'];
    if(baseUrl) args.push('-c',`openai_base_url=${JSON.stringify(baseUrl)}`);
    if(model) args.push('-m',model);
    args.push('--',`Connectivity check only. Do not use any tools, read files, or change anything. Reply exactly ${marker}.`);
    const result=await run(binary,args,{cwd,env:{...process.env,CODEX_HOME:codexHome},timeout});
    const events=result.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    const after=await health(port,instanceId);
    const completed=events.some(e=>e.type==='turn.completed');
    const exactReply=events.some(e=>e.type==='item.completed'&&e.item?.type==='agent_message'&&e.item.text.trim()===marker);
    const unexpectedTools=events.some(e=>e.type==='item.completed'&&['command_execution','mcp_tool_call','web_search','file_change'].includes(e.item?.type));
    const checked={passed:result.code===0&&!result.timedOut&&!result.tooLarge&&completed&&exactReply&&!unexpectedTools
        &&after.upstreamRequests>before.upstreamRequests&&after.websocketRefusals>before.websocketRefusals,
      exitCode:result.code,timedOut:result.timedOut,turnCompleted:completed,exactReply,unexpectedTools,
      websocketFallbackObserved:after.websocketRefusals>before.websocketRefusals,httpRequests:after.upstreamRequests-before.upstreamRequests,
      desktopVerified:false};
    if(!checked.passed) {const error=new Error('Real Codex HTTP smoke failed. No desktop success may be claimed.');error.check=checked;throw error;}
    return checked;
  } finally {await rm(cwd,{recursive:true,force:true});}
}

export async function preflight(binary,codexHome,{model}={}) {
  const instanceId=randomUUID(), {server}=createRelay({instanceId});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  try {return await smoke(binary,codexHome,{baseUrl:`http://127.0.0.1:${port}/backend-api/codex`,model,port,instanceId});}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
