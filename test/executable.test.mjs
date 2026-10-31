import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {health} from '../src/codex.mjs';
test('real relay entry starts from escaped and symlinked paths',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"relay entry O'Brien & "));
  const actual=path.join(dir,'actual'),alias=path.join(dir,'alias');await mkdir(actual);
  const relay=path.join(actual,'relay.mjs');await writeFile(relay,await readFile(new URL('../src/relay.mjs',import.meta.url)));
  await symlink(actual,alias,process.platform==='win32'?'junction':'dir');
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const id=randomUUID(),child=spawn(process.execPath,[path.join(alias,'relay.mjs'),String(port),id],{stdio:'ignore',windowsHide:true});
  const closed=once(child,'close');
  t.after(async()=>{child.kill();await closed;await rm(dir,{recursive:true,force:true});});
  let result;
  for(let i=0;i<40;i++){try{result=await health(port,id);break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
  assert.equal(result?.instanceId,id);assert.equal(result?.upstreamRequests,0);
});
