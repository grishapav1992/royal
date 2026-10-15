import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const maximum = 6 * 1024 ** 2;
const purpose = 'isolated-loopback-generator-control-snapshot';
const fields = { '/prepared': new Set(['runId', 'ready', 'clientHost', 'inputMode', 'gameProcesses', 'connectionPhase']),
  '/results': new Set(['runId', 'results']) };
const forbidden = /^(?:authorization|cookies?|set-cookie|tokens?|manifest|password|secret|sessionhash|accountids?)$/i;
const refuse = () => { throw new Error('Loopback generator snapshot refused'); };

export function snapshotControlPort(argv) {
  const matches = argv.flatMap((value, index) => value === '--control-port' ? [argv[index + 1]] : []);
  if (matches.length !== 1 || !/^[0-9]{1,5}$/.test(matches[0] ?? '')) refuse();
  const port = Number(matches[0]);
  if (port < 1 || port > 65535) refuse();
  return port;
}

function payload(path, body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > maximum) refuse();
  let value; try { value = JSON.parse(body); } catch { refuse(); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !fields[path].has(key))
    || typeof value.runId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.runId)
    || path === '/prepared' && (!Array.isArray(value.ready) || !value.clientHost || !value.connectionPhase
      || !['stress', 'browser-window'].includes(value.inputMode)) || path === '/results' && !Array.isArray(value.results)) refuse();
  const pending = [[value, 0]]; let entries = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++entries > 200000 || depth > 16) refuse();
    if (typeof item === 'string' && /royal_session=|\bBearer\s+/i.test(item)) refuse();
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (forbidden.test(key)) refuse();
      pending.push([child, depth + 1]);
    }
  }
  return value;
}

async function save(path, bytes, previous) {
  const parent = dirname(path), info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()
    || (info.mode & 0o777) !== 0o700 || await realpath(parent) !== parent) refuse();
  if (previous) {
    const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await source.stat();
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600
        || info.size !== previous.length || !(await source.readFile()).equals(previous)) refuse();
    } finally { await source.close(); }
  } else {
    try { await lstat(path); refuse(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const temporary = join(parent, '.generator-snapshot-' + randomUUID() + '.tmp');
  let descriptor;
  try {
    descriptor = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await descriptor.writeFile(bytes); await descriptor.sync(); await descriptor.close(); descriptor = null;
    await rename(temporary, path);
    const directory = await open(parent, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (descriptor) await descriptor.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function installControlSnapshot({ controlPort, output = '/app/run/generator-snapshot.json',
  target = globalThis, now = Date.now } = {}) {
  if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535 || !output.startsWith('/')) refuse();
  const original = target.fetch;
  if (typeof original !== 'function') refuse();
  let snapshot, previous, serial = Promise.resolve();
  const wrapper = function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); } catch { return original.call(this, input, init); }
    if (url.origin !== 'http://127.0.0.1:' + controlPort || url.username || url.password || url.search || url.hash
      || !fields[url.pathname] || init?.method?.toUpperCase() !== 'POST') return original.call(this, input, init);
    const receiver = this;
    serial = serial.then(async () => {
      const value = payload(url.pathname, init.body);
      if (snapshot && value.runId !== snapshot.runId || url.pathname === '/results' && !snapshot?.prepared) refuse();
      const next = { ...(snapshot ?? { protocol: 1, purpose, partial: true, cleanupUnobserved: true,
        runId: value.runId, controlPort }), observedAtMs: now() };
      if (url.pathname === '/prepared') { next.prepared = value; next.preparedObservedAtMs = next.observedAtMs; }
      else { next.results = value.results; next.resultsObservedAtMs = next.observedAtMs; }
      const bytes = Buffer.from(JSON.stringify(next) + '\n');
      if (bytes.length > maximum) refuse();
      await save(output, bytes, previous);
      previous = bytes; snapshot = next;
    });
    return serial.then(() => original.call(receiver, input, init));
  };
  target.fetch = wrapper;
  return () => { if (target.fetch === wrapper) target.fetch = original; };
}

if (process.env.LOAD_GENERATOR_CONTROL_SNAPSHOT === '1') {
  if (process.env.NODE_ENV !== 'test') refuse();
  installControlSnapshot({ controlPort: snapshotControlPort(process.argv) });
}
