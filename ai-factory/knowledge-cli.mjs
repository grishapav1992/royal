import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { open, unlink, readFile, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Store } from './lib/store.mjs';
import { config } from './lib/config.mjs';
import { readGraphJournal, readGraphFile, prepareGraphDirectory, writeGraphJournal, writeGraphFile, readGraphSeed, updateGraphRecords, materializeGraph, mergeGraphEvents, createGraphEvent, graphHeads } from './lib/knowledge-graph.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const state = join(root, 'knowledge-graph', '.state');
const journal = join(state, 'journal.json');
const snapshotPath = join(state, 'snapshot.json');
const python = join(root, 'knowledge-graph', '.venv', 'bin', 'python');
const bridge = join(root, 'knowledge-graph', 'graphiti_bridge.py');
const db = join(state, 'graph.rdb');
const args = process.argv.slice(2), command = args.shift() || 'status';
const children=new Set();let stopping=false,wake=null;
if(command==='watch')for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;for(const child of children)child.kill('SIGTERM');wake?.();});

async function child(binary, parameters, input) {
  return new Promise((resolvePromise, reject) => {
    const process = spawn(binary, parameters, { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(process);process.stdout.setEncoding('utf8');process.stderr.setEncoding('utf8');
    const timeout = setTimeout(()=>process.kill('SIGTERM'),120000); timeout.unref();
    let output = '', error = '', size = 0;
    process.stdout.on('data', chunk => { size += chunk.length; if (size > 9 * 1024 * 1024) process.kill(); else output += chunk; });
    process.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    process.on('error', error=>{children.delete(process);clearTimeout(timeout);reject(error);});
    process.on('close', code => {children.delete(process);clearTimeout(timeout);code === 0 ? resolvePromise(output) : reject(new Error(`Knowledge command failed (${code}). ${binary.endsWith('ssh') ? 'Check server connection.' : 'Check local graph runtime.'}`));});
    process.stdin.on('error', () => {}); process.stdin.end(input || '');
  });
}
async function localEvents() {
  const previous = await readGraphJournal(journal);
  return updateGraphRecords(previous, await readGraphSeed(), { origin: 'curated', created_at: '2026-10-10T00:22:00.000Z' });
}
async function project(events) {
  const snapshot = materializeGraph(events);
  await writeGraphJournal(journal, events);
  await writeGraphFile(snapshotPath,snapshot);
  const output = await child(python, [bridge, 'project', '--snapshot', snapshotPath, '--db', db]);
  const projection = JSON.parse(output);
  if (projection.hash !== snapshot.hash) throw new Error('Local Graphiti fingerprint mismatch');
  return { hash: snapshot.hash, nodes: snapshot.nodes.length, edges: snapshot.edges.length, conflicts: snapshot.conflicts.length, projection: 'ready' };
}
async function sync() {
  const events = await localEvents();
  const output = await child('/usr/bin/ssh', ['-i', join(homedir(), '.ssh', 'royal_server_ed25519'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2',
    'root@45.192.12.242', 'cd /opt/royal-ai && docker compose exec -T api node knowledge-cli.mjs exchange'], JSON.stringify({ schema_version: 1, events }));
  const remote = JSON.parse(output);
  const merged = mergeGraphEvents(events, remote.events);
  const snapshot = materializeGraph(merged);
  if (remote.hash !== snapshot.hash) throw new Error('Graph synchronization fingerprint mismatch');
  const result = await project(merged);
  await writeGraphFile(join(state, 'sync.json'),{ last_exchange_at: remote.exchanged_at, hash: snapshot.hash });
  return { ...result, exchanged_at: remote.exchanged_at };
}
async function locked(callback) {
  await prepareGraphDirectory(journal);
  const lockPath = join(state, 'sync.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if(error.code !== 'EEXIST') throw error;
    const info=await lstat(lockPath);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>20) throw new Error('Unsafe graph lock.');
    const pid=Number(await readFile(lockPath,'utf8'));
    if(!Number.isSafeInteger(pid)||pid<1) throw new Error('Invalid graph lock.');
    let alive=true;try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
    if(alive)throw new Error('Another graph operation is running.');
    const check=await lstat(lockPath);if(check.ino!==info.ino||check.dev!==info.dev)throw new Error('Graph lock changed.');
    await unlink(lockPath);lock=await open(lockPath,'wx',0o600);
  }
  try { await lock.writeFile(String(process.pid)); return await callback(); }
  finally { await lock.close(); await unlink(lockPath); }
}
async function serverExchange() {
  let body = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { body += chunk; if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Journal limit exceeded'); }
  const input = JSON.parse(body);
  if (input.schema_version !== 1) throw new Error('Unknown graph schema');
  const store = new Store({ connectionString: config().databaseUrl });
  try { await store.init(); process.stdout.write(JSON.stringify(await store.exchangeKnowledgeGraph(input.events))); }
  finally { await store.close(); }
}
async function run() {
  if (command === 'exchange') return serverExchange();
  if (command === 'watch') {
    while(!stopping) {
      try { console.log(JSON.stringify(await locked(sync))); }
      catch (error) { console.error(error.message); }
      if(!stopping)await new Promise(resolvePromise=>{const timer=setTimeout(resolvePromise,60000);wake=()=>{clearTimeout(timer);resolvePromise();};});
    }
  }
  if (command === 'sync') return locked(sync);
  if (command === 'init') return locked(async () => project(await localEvents()));
  if (command === 'put' || command === 'resolve') return locked(async () => {
    const record = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
    if(/^(?:task|decision|candidate|decision-link|candidate-link):/.test(record.id||''))throw new Error('Factory record IDs are reserved for server facts.');
    const events = await localEvents(), heads = graphHeads(events).get(record.id) || [];
    if (heads.length > 1 && command !== 'resolve') throw new Error('Conflicting record requires explicit resolve.');
    if (command === 'resolve' && heads.length < 2) throw new Error('Record has no conflict.');
    const parent = heads.length > 1 ? heads.map(event => event.id).sort() : heads[0]?.id || null;
    return project(mergeGraphEvents(events, [createGraphEvent(record, { parent, origin: 'local' })]));
  });
  if (command === 'search') {await readGraphJournal(journal);return JSON.parse(await child(python, [bridge, 'search', '--query', args.join(' '), '--db', db, '--limit', '10']));}
  if (command === 'status') {
    await readGraphJournal(journal);
    const status=JSON.parse(await child(python,[bridge,'status','--db',db]));
    const last=(await readGraphFile(join(state,'sync.json')))?.last_exchange_at||null;
    return {...status,last_exchange_at:last};
  }
  throw new Error('Use init, sync, watch, search, status, put or resolve.');
}
try { const result = await run(); if (result) process.stdout.write(`${JSON.stringify(result)}\n`); }
catch (error) { console.error(error.message); process.exitCode = 1; }
