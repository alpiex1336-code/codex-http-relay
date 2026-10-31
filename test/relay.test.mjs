import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {gzipSync} from 'node:zlib';
import {createRelay,validPath} from '../src/relay.mjs';

async function listen(server,t) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});return server.address().port;
}
function request(port,{method='GET',url='/backend-api/codex/models',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,method,path:url,headers},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });req.on('error',reject);req.end(body);
  });
}
function raw(port,text) {
  return new Promise((resolve,reject)=>{
    let data='';const socket=net.connect(port,'127.0.0.1',()=>socket.write(text));
    socket.on('data',b=>data+=b);socket.on('end',()=>resolve(data));socket.on('error',reject);
  });
}
test('opaque gzip payload and auth forwarded only to fixed TLS destination',async t=>{
  const input=Buffer.from([0,1,2,3,250]),output=gzipSync('data: secret-response\n\n');
  let captured;const events=[];
  const upstream=http.createServer((req,res)=>{
    const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
      assert.deepEqual(Buffer.concat(chunks),input);
      assert.equal(req.headers.authorization,'Bearer fixture-secret');
      assert.equal(req.headers.cookie,undefined);assert.equal(req.headers['x-remove'],undefined);
      res.writeHead(200,{'content-type':'text/event-stream','content-encoding':'gzip','x-request-id':'fixture-id'});res.end(output);
    });
  });
  const up=await listen(upstream,t);
  const {server}=createRelay({report:e=>events.push(e),request:(opts,cb)=>{
    captured=opts;return http.request({hostname:'127.0.0.1',port:up,method:opts.method,path:opts.path,headers:opts.headers},cb);
  }});
  const port=await listen(server,t);
  const result=await request(port,{method:'POST',url:'/backend-api/codex/responses',headers:{authorization:'Bearer fixture-secret',cookie:'private-cookie',connection:'x-remove','x-remove':'private'},body:input});
  assert.equal(result.status,200);assert.deepEqual(result.body,output);assert.equal(result.headers['content-encoding'],'gzip');
  assert.equal(captured.hostname,'chatgpt.com');assert.equal(captured.protocol,'https:');assert.equal(captured.rejectUnauthorized,true);
  assert.doesNotMatch(JSON.stringify(events),/fixture-secret|private|secret-response/);
});
test('426 upgrade never sends a request upstream',async t=>{
  let calls=0;const {server,metrics}=createRelay({request:()=>{calls++;throw new Error();}});
  const port=await listen(server,t);
  const text=await raw(port,`GET /backend-api/codex/responses HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer fixture\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  assert.match(text,/^HTTP\/1.1 426/);assert.equal(calls,0);assert.equal(metrics.websocketRefusals,1);
});
test('reject browser origins, foreign host, absent auth and traversal',async t=>{
  let calls=0;const {server}=createRelay({request:()=>{calls++;throw new Error();}});
  const port=await listen(server,t);
  for(const [options,status] of [
    [{headers:{origin:'https://example.invalid',authorization:'Bearer fixture'}},403],
    [{headers:{host:'127.0.0.1:9',authorization:'Bearer fixture'}},403],
    [{headers:{host:'example.invalid',authorization:'Bearer fixture'}},403],
    [{},401], [{url:'/backend-api/codex/%2e%2e/other',headers:{authorization:'Bearer fixture'}},404],
    [{method:'DELETE',headers:{authorization:'Bearer fixture'}},404]]) {
    assert.equal((await request(port,options)).status,status);
  }
  assert.equal(calls,0);
});
test('preserve HTTP errors and redirects without retries or follow',async t=>{
  let calls=0;
  const upstream=http.createServer((req,res)=>{calls++;res.writeHead(Number(req.url.slice(1)),{location:'https://example.invalid/credential-trap'});res.end('fixture');});
  const up=await listen(upstream,t);
  const {server}=createRelay({request:(opts,cb)=>http.request({hostname:'127.0.0.1',port:up,path:'/side'.replace('side',opts.headers['x-status']),method:opts.method},cb)});
  const port=await listen(server,t);
  for(const status of [401,429,307,500]) {
    assert.equal((await request(port,{method:'POST',headers:{authorization:'Bearer fixture','x-status':String(status)},body:'x'})).status,status);
  }
  assert.equal(calls,4);
});
test('synchronous upstream failure returns generic 502 without process crash',async t=>{
  const {server}=createRelay({request:()=>{throw new Error('secret internals');}});
  const port=await listen(server,t);
  const result=await request(port,{headers:{authorization:'Bearer fixture'}});
  assert.equal(result.status,502);assert.doesNotMatch(result.body.toString(),/secret/);
});
test('path validator rejects encodings and external targets',()=>{
  for(const p of ['/backend-api/codex/../x','/backend-api/codex/%2e%2e/x','/backend-api/codex/%252e%252e/x','/backend-api/codex/%5c/x','https://example.invalid','//example.invalid','/backend-api/codex/%00','/backend-api/codex/%']) assert.equal(validPath(p),false,p);
  assert.equal(validPath('/backend-api/codex/models?client_version=fixture'),true);
});
