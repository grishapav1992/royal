import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 32 * 1024 * 1024;
const routes = new Set(['GET /v1/models', ...[
  'chat/completions', 'responses', 'images/generations', 'images/edits',
  'embeddings', 'audio/speech', 'audio/transcriptions', 'messages',
].map(path => `POST /v1/${path}`)]);

export function remoteRequest(method, path, body, contentType = 'application/json') {
  if (!routes.has(`${method} ${path}`) || body.length > MAX_BODY) {
    return Promise.reject(new Error('Request route or size rejected'));
  }
  const target = process.env.A6API_SSH_TARGET || 'root@45.192.12.242';
  if (!/^[a-zA-Z0-9_.@-]+$/.test(target) || target.startsWith('-')) {
    return Promise.reject(new Error('Invalid SSH target'));
  }
  const args = ['-T', '-i', process.env.A6API_SSH_KEY || join(homedir(), '.ssh', 'royal_server_ed25519'),
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=2', target,
    'python3 /opt/royal-a6api/request.py'];
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stream = new PassThrough();
    let pending = Buffer.alloc(0), framed = false;
    const timer = setTimeout(() => child.kill(), 330_000);
    const stop = () => child.kill();
    stream.on('error', () => {});
    stream.once('close', () => { if (!child.stdout.readableEnded) stop(); });
    const failure = () => {
      const error = new Error('SSH request failed. Check server access and installed gateway.');
      if (framed) stream.destroy(error); else reject(error);
    };
    child.once('error', failure);
    child.stdin.on('error', () => {});
    // SSH diagnostics can contain private infrastructure details. Do not relay them over HTTP.
    child.stderr.resume();
    const onData = chunk => {
      pending = Buffer.concat([pending, chunk]);
      const newline = pending.indexOf(10);
      if (newline < 0 && pending.length <= 8192) return;
      try {
        if (newline < 0 || newline > 8192) throw new Error();
        const meta = JSON.parse(pending.subarray(0, newline));
        if (!Number.isInteger(meta.status) || meta.status < 200 || meta.status > 599
            || typeof meta.contentType !== 'string' || /[^\x20-\x7e]/.test(meta.contentType)) throw new Error();
        framed = true;
        child.stdout.off('data', onData);
        child.stdout.pause();
        stream.write(pending.subarray(newline + 1));
        pending = null;
        child.stdout.pipe(stream, { end: false });
        resolve({ ...meta, stream, cancel: stop });
      } catch { failure(); stop(); }
    };
    child.stdout.on('data', onData);
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !framed) failure(); else stream.end();
    });
    child.stdin.end(Buffer.concat([Buffer.from(JSON.stringify({ method, path, length: body.length, contentType }) + '\n'), body]));
  });
}

async function readBody(source) {
  const chunks = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request exceeds 32 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createGateway({ openRemote = remoteRequest } = {}) {
  let active = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const fail = (status, code) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code } })); };
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)
        || req.headers.origin || req.headers['sec-fetch-site']) return fail(403, 'local_clients_only');
    if (!routes.has(`${req.method} ${req.url}`)) return fail(404, 'route_not_allowed');
    if (active >= 4) return fail(429, 'too_many_requests');
    if (req.headers['content-encoding']) return fail(415, 'content_encoding_not_supported');
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return fail(413, 'request_too_large');
    active++;
    let upstream;
    const cancel = () => upstream?.cancel();
    res.once('close', cancel);
    try {
      const body = await readBody(req);
      if (req.method === 'GET' && body.length) return fail(400, 'unexpected_body');
      upstream = await openRemote(req.method, req.url, body, req.headers['content-type'] || 'application/json');
      if (res.destroyed) { upstream.cancel(); return; }
      res.writeHead(upstream.status, { 'Content-Type': upstream.contentType });
      await pipeline(upstream.stream, res);
    } catch {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) fail(502, 'server_request_failed');
    } finally { active--; res.off('close', cancel); }
  });
  server.requestTimeout = 330_000;
  server.headersTimeout = 15_000;
  return server;
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'serve') {
    const port = rest.length ? Number(rest[0]) : 8766;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535');
    const server = createGateway();
    server.on('error', () => { console.error('Cannot start local A6API gateway'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`A6API base URL: http://127.0.0.1:${port}/v1 (SSH authentication; upstream key stays on server)`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
    return;
  }
  if (command !== 'models' && command !== 'request') {
    console.log('Usage: npm run a6api -- models | serve [port] | request /v1/endpoint input.json');
    return;
  }
  const method = command === 'models' ? 'GET' : 'POST';
  const path = command === 'models' ? '/v1/models' : rest[0];
  if (method === 'POST' && !rest[1]) throw new Error('Supply a JSON input file, or - for stdin');
  const body = method === 'GET' ? Buffer.alloc(0) : rest[1] === '-' ? await readBody(process.stdin) : await readFile(rest[1]);
  const result = await remoteRequest(method, path, body);
  if (result.status >= 400) process.exitCode = 1;
  await pipeline(result.stream, process.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
