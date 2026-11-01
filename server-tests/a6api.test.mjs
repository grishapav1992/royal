import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { request } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway, remoteRequest } from '../scripts/a6api.mjs';

async function fixture(t, openRemote) {
  const server = createGateway({ openRemote });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('models, binary data and streaming preserve upstream bytes and status', async t => {
  const calls = [];
  const url = await fixture(t, async (method, path, body, contentType) => {
    calls.push({ method, path, body, contentType });
    return { status: 201, contentType: 'text/event-stream', cancel() {},
      stream: Readable.from([Buffer.from('data: {"ok":'), Buffer.from('true}\n\n'), Buffer.from([0, 255])]) };
  });
  const input = Buffer.from([0, 128, 255]);
  const response = await fetch(url + '/v1/images/edits', { method: 'POST', body: input,
    headers: { 'Content-Type': 'multipart/form-data; boundary=test', Authorization: 'Bearer local-placeholder' } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.concat([Buffer.from('data: {"ok":true}\n\n'), Buffer.from([0, 255])]));
  assert.deepEqual(calls, [{ method: 'POST', path: '/v1/images/edits', body: input, contentType: 'multipart/form-data; boundary=test' }]);
});

test('web origins, rebinding, unknown routes and encoded paths never reach SSH', async t => {
  let calls = 0;
  const url = await fixture(t, async () => { calls++; throw new Error(); });
  for (const [path, headers, expected] of [
    ['/v1/models', { Origin: 'https://example.org' }, 403],
    ['/v1/models', { 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['/v1/models', { Host: 'attacker.example' }, 403],
    ['/v1/models?redirect=https://example.org', {}, 404],
    ['/v1/%6dodels', {}, 404], ['/api/accounts', {}, 404],
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(url + path, { headers }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.once('error', reject); req.end();
    });
    assert.equal(status, expected, JSON.stringify({ path, headers }));
  }
  assert.equal(calls, 0);
});

test('upstream HTTP errors are relayed; SSH diagnostics are hidden', async t => {
  let fail = false;
  const url = await fixture(t, async () => {
    if (fail) throw new Error('private infrastructure and credential');
    return { status: 429, contentType: 'application/json', cancel() {}, stream: Readable.from(['{"error":"quota"}']) };
  });
  const quota = await fetch(url + '/v1/models');
  assert.equal(quota.status, 429);
  assert.deepEqual(await quota.json(), { error: 'quota' });
  fail = true;
  const broken = await fetch(url + '/v1/models');
  assert.equal(broken.status, 502);
  assert.deepEqual(await broken.json(), { error: { code: 'server_request_failed' } });
});

test('compressed payloads and oversized requests are rejected before SSH', async t => {
  let calls = 0;
  const url = await fixture(t, async () => { calls++; throw new Error(); });
  const response = await fetch(url + '/v1/responses', { method: 'POST', body: 'x', headers: { 'Content-Encoding': 'gzip' } });
  assert.equal(response.status, 415);
  await response.text();
  await assert.rejects(remoteRequest('POST', '/v1/responses', Buffer.alloc(32 * 1024 * 1024 + 1)));
  await assert.rejects(remoteRequest('GET', '/v1/models?secret=1', Buffer.alloc(0)));
  assert.equal(calls, 0);
});

test('local gateway limits simultaneous upstream requests', async t => {
  const releases = [];
  const url = await fixture(t, () => new Promise(resolve => releases.push(() => resolve({
    status: 200, contentType: 'application/json', cancel() {}, stream: Readable.from(['{}']),
  }))));
  const pending = Array.from({ length: 4 }, () => fetch(url + '/v1/models'));
  while (releases.length < 4) await new Promise(resolve => setTimeout(resolve, 5));
  const excess = await fetch(url + '/v1/models');
  assert.equal(excess.status, 429);
  await excess.text();
  releases.forEach(release => release());
  for (const response of await Promise.all(pending)) await response.text();
});

test('SSH framing preserves split metadata and binary output without a local API key', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-a6api-test-'));
  const oldPath = process.env.PATH;
  t.after(async () => { process.env.PATH = oldPath; await rm(directory, { recursive: true }); });
  await writeFile(join(directory, 'ssh'), `#!${process.execPath}
let input = Buffer.alloc(0);
process.stdin.on('data', part => { input = Buffer.concat([input, part]); });
process.stdin.on('end', () => {
  const newline = input.indexOf(10);
  const meta = JSON.parse(input.subarray(0, newline));
  if (meta.path !== '/v1/models' || Object.keys(meta).some(k => /key|auth/i.test(k))) process.exit(2);
  process.stdout.write('{"status":200,');
  setTimeout(() => process.stdout.end(Buffer.concat([Buffer.from('"contentType":"application/octet-stream"}\\n'), Buffer.from([0, 255, 128])])), 10);
});
`, { mode: 0o755 });
  process.env.PATH = directory + ':' + oldPath;
  const result = await remoteRequest('GET', '/v1/models', Buffer.alloc(0));
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 128]));
});
