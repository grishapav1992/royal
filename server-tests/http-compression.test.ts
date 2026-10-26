import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';

async function fixture(application: boolean) {
  const child = fork(fileURLToPath(new URL('./helpers/http-compression-fixture.ts', import.meta.url)), application ? ['--application'] : [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: {...process.env, CODEX_SALE_API_KEY: ''},
  });
  let stderr = ''; child.stderr!.on('data', value => {stderr += value;});
  const deadline = setTimeout(() => child.kill('SIGKILL'), 12000);
  const exit = once(child, 'exit');
  const ready = await Promise.race([
    once(child, 'message').then(([value]) => value as {phase: string; port: number}),
    exit.then(() => {throw Error('Test server exited before startup: ' + stderr);}),
  ]);
  assert.equal(ready.phase, 'ready');
  return {child, endpoint: 'http://127.0.0.1:' + ready.port, port: ready.port,
    stop: async () => {if (child.connected) child.send('stop'); const [code, signal] = await exit; clearTimeout(deadline); assert.equal(code, 0, stderr || String(signal));}};
}

test('completed gzip followed by delayed invalid bytes cannot crash the installed parser', {timeout: 15000}, async () => {
  const c = await fixture(false);
  try {
    const first = Buffer.concat([gzipSync(Buffer.from('{"ok":true}')), Buffer.from([0])]), trailing = Buffer.alloc(1024, 255);
    const response = new Promise<number>((resolve, reject) => {
      const req = request({host: '127.0.0.1', port: c.port, path: '/probe', method: 'POST', agent: false,
        headers: {'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': first.length + trailing.length}}, res => {
        res.resume(); res.once('end', () => resolve(res.statusCode!));
      });
      req.on('error', reject);
      c.child.once('message', value => {assert.equal(value.phase, 'parsed'); req.end(trailing);});
      req.write(first);
    });
    assert.equal(await response, 200);
    assert.equal((await fetch(c.endpoint + '/healthz')).status, 200);
  } finally {await c.stop();}
});

test('active application parsers reject compressed JSON and raw callbacks while ordinary login remains usable', {timeout: 15000}, async () => {
  const c = await fixture(true);
  try {
    for (const path of ['/api/auth/login', '/api/npc/mira', '/api/usdt-wallet/deposit', '/api/casinoapipro/sessions', '/api/casinoapipro/wallet/debit']) {
      const response = await fetch(c.endpoint + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}, body: gzipSync(Buffer.from('{}'))});
      assert.equal(response.status, 415, path); await response.arrayBuffer();
    }
    const login = await fetch(c.endpoint + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'compression-' + crypto.randomUUID() + '@example.test', password: 'Local-compression-123!'})});
    assert.equal(login.status, 200); assert((await login.json()).account.id);
    assert.equal((await fetch(c.endpoint + '/healthz')).status, 200);
  } finally {await c.stop();}
});
