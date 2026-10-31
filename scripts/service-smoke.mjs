// Optional OS integration check. Creates/removes only a uniquely named test service.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {installService,removeService,waitHealthy,ensureServiceAbsent,privateDirectory} from '../src/service.mjs';
if(!['darwin','win32'].includes(process.platform)) throw new Error('macOS or Windows required.');
const runtime=await mkdtemp(path.join(os.tmpdir(),"relay test O'Brien & spaces "));
const id=randomUUID(),portServer=net.createServer();
await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const state={runtime,id,port,node:process.execPath,platform:process.platform,serviceName:'local.codex.http-relay.test-'+id};
let clean=false;
try {
  await privateDirectory(runtime);
  await writeFile(path.join(runtime,'relay.mjs'),await readFile(new URL('../src/relay.mjs',import.meta.url)),{mode:0o600});
  await installService(state);await waitHealthy(state);
  await removeService(state);await ensureServiceAbsent(state);clean=true;
  console.log(JSON.stringify({platform:process.platform,serviceStartStopPassed:true,configTouched:false,liveAccountUsed:false}));
}finally {
  if(!clean) await removeService(state);
  await rm(runtime,{recursive:true,force:true});
}
