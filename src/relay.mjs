// Runtime has no third-party dependencies. Credentials exist only in transit.
import http from 'node:http';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';

const PREFIX = '/backend-api/codex';
const HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host']);
function cleanHeaders(headers) {
  const blocked = new Set([...HOP, ...String(headers.connection ?? '').split(',').map(x => x.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}
export function validPath(raw) {
  if (!raw?.startsWith(`${PREFIX}/`) || /[\\\r\n\x00-\x20]/.test(raw)) return false;
  try {
    const decoded = decodeURIComponent(raw.split('?')[0]);
    return decoded.startsWith(`${PREFIX}/`) && !/[\\\x00-\x20]/.test(decoded)
      && !decoded.split('/').some(x => x === '.' || x === '..')
      && !/%(?:2e|2f|5c)/i.test(decoded);
  } catch { return false; }
}
function reply(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'content-type':'application/json','content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}
function endSocket(socket, status) {
  socket.on('error', () => {});
  socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

export function createRelay({request = https.request, instanceId = 'test', report = () => {}} = {}) {
  const metrics = {websocketRefusals:0, upstreamRequests:0, activeRequests:0, completedRequests:0, transportErrors:0};
  const admit = req => req.socket.remoteAddress === '127.0.0.1'
    && req.headers.host === `127.0.0.1:${server.address()?.port}` && !req.headers.origin;
  const authorized = req => /^Bearer \S+$/.test(req.headers.authorization ?? '');
  const server = http.createServer((req, res) => {
    if (!admit(req)) return reply(res, 403, {error:'loopback clients only'});
    if (req.url === '/health' && req.method === 'GET') return reply(res, 200, {service:'codex-http-relay',version:1,instanceId,...metrics});
    if (!['GET','POST'].includes(req.method) || !validPath(req.url)) return reply(res, 404, {error:'unsupported route'});
    if (!authorized(req)) return reply(res, 401, {error:'caller authentication required'});
    metrics.upstreamRequests++; metrics.activeRequests++;
    let settled = false, upstream;
    const finish = outcome => {
      if (settled) return;
      settled = true; metrics.activeRequests--;
      if (outcome === 'complete') metrics.completedRequests++;
      if (outcome === 'transport_error') metrics.transportErrors++;
      report({event:'request',outcome}); // Never log headers, paths, payloads or exception text.
    };
    const failed = () => {
      finish('transport_error');
      if (!res.headersSent) reply(res,502,{error:'upstream transport error'}); else res.destroy();
    };
    const headers = cleanHeaders(req.headers);
    delete headers.cookie; delete headers.referer;
    try {
      upstream = request({protocol:'https:',hostname:'chatgpt.com',port:443,
        method:req.method,path:req.url,headers,rejectUnauthorized:true}, incoming => {
        res.writeHead(incoming.statusCode, cleanHeaders(incoming.headers));
        incoming.on('error', failed);
        incoming.on('aborted', failed);
        incoming.once('end', () => finish('complete'));
        incoming.pipe(res); // Includes compressed SSE, unchanged; never parse or buffer it.
      });
      upstream.once('error', failed);
      upstream.setTimeout(900_000, () => upstream.destroy(new Error('idle timeout')));
      req.once('aborted', () => upstream.destroy());
      req.once('error', () => upstream.destroy());
      res.once('close', () => { if (!res.writableFinished) { finish('client_cancelled'); upstream.destroy(); } });
      req.pipe(upstream);
    } catch { failed(); }
  });
  server.on('upgrade', (req, socket) => {
    if (req.method !== 'GET' || !admit(req) || !validPath(req.url) || !authorized(req))
      return endSocket(socket, '403 Forbidden');
    metrics.websocketRefusals++;
    endSocket(socket,'426 Upgrade Required');
  });
  server.on('connect', (_req, socket) => endSocket(socket,'405 Method Not Allowed'));
  server.on('clientError', (_error, socket) => endSocket(socket,'400 Bad Request'));
  server.requestTimeout = 300_000; server.headersTimeout = 30_000;
  return {server, metrics};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const port = Number(process.argv[2]), instanceId = process.argv[3];
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9-]{36}$/.test(instanceId ?? ''))
    throw new Error('Expected an unprivileged port and installation UUID.');
  const {server} = createRelay({instanceId});
  server.on('error', () => { process.stderr.write('Relay could not start.\n'); process.exitCode = 1; });
  server.listen(port,'127.0.0.1');
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0),2000).unref();
  });
}
