import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, open, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, resolve, join, parse } from 'node:path';
import { constants } from 'node:fs';

const ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATUSES = ['verified', 'decision', 'candidate', 'planned'];
const ENVIRONMENTS = ['project', 'production', 'sandbox', 'testnet', 'candidate'];
const TYPES = ['project', 'service', 'integration', 'mechanic', 'document', 'decision', 'task', 'candidate'];
const MAX_EVENTS = 20000;
const MAX_BYTES = 8 * 1024 * 1024;
const parentsOf = event => event.parent === null ? [] : Array.isArray(event.parent) ? event.parent : [event.parent];
const fail = message => { throw Object.assign(new Error(`Knowledge graph: ${message}`), { status: 400 }); };

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const graphDigest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

function text(value, maximum = 4000) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u2014]/.test(value)
    || /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\bBearer\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{8,}/i.test(value)
    || /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(value)) fail('invalid or sensitive text');
  if (/\b(?:[A-Za-z0-9_-]*(?:api[_-]?key|password|secret|private[_-]?key|mnemonic|seed[_-]?phrase|authorization|cookie|token))\s*[=:]\s*(?!\[redacted\])[^\s,;}\]]+/i.test(value)) fail('sensitive assignment');
  return value;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) fail('unknown or missing fields');
}
export function validateRecord(record) {
  const common = ['kind', 'id', 'status', 'environment', 'evidence'];
  const keys = record?.kind === 'entity' ? [...common, 'name', 'entity_type', 'summary'] : [...common, 'source', 'target', 'predicate', 'text'];
  exact(record, keys);
  if (!ID.test(record.id) || !STATUSES.includes(record.status) || !ENVIRONMENTS.includes(record.environment)) fail('invalid record identity or state');
  if (record.kind === 'entity') {
    text(record.name, 500); text(record.summary);
    if (!TYPES.includes(record.entity_type)) fail('invalid entity type');
  } else if (record.kind === 'relation') {
    if (!ID.test(record.source) || !ID.test(record.target) || !/^[a-z][a-z_]{0,63}$/.test(record.predicate)) fail('invalid relationship');
    text(record.text);
  } else fail('invalid record kind');
  if (!Array.isArray(record.evidence) || !record.evidence.length || record.evidence.length > 8) fail('evidence is required');
  for (const evidence of record.evidence) {
    exact(evidence, ['path', 'sha256']);
    if (!HASH.test(evidence.sha256) || typeof evidence.path !== 'string' || evidence.path.length > 240
      || !/^[A-Za-z0-9_./:-]+$/.test(evidence.path) || evidence.path.startsWith('/')
      || evidence.path.split('/').some(part => !part || part === '.' || part === '..' || /^(?:\.env.*|\.git|secrets?|auth\.json|credentials?)$/i.test(part))) fail('invalid evidence reference');
  }
  return record;
}
export function createGraphEvent(record, { parent = null, origin = 'local', created_at = new Date().toISOString(), deleted = false, record_id = record?.id } = {}) {
  const payload = { record_id, parent, deleted, record: deleted ? null : validateRecord(record), origin, created_at };
  return validateGraphEvent({ id: graphDigest(payload), ...payload });
}
export function validateGraphEvent(event) {
  exact(event, ['id', 'record_id', 'parent', 'deleted', 'record', 'origin', 'created_at']);
  const parents = parentsOf(event);
  if (event.parent !== null && typeof event.parent !== 'string' && !Array.isArray(event.parent)) fail('invalid parent type');
  if (Array.isArray(event.parent) && event.parent.length < 2) fail('merge requires multiple parents');
  if (!HASH.test(event.id) || !ID.test(event.record_id) || parents.length > 20 || new Set(parents).size !== parents.length || parents.some(parent => !HASH.test(parent))
    || !['local', 'curated', 'factory'].includes(event.origin) || typeof event.deleted !== 'boolean'
    || typeof event.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.created_at)
    || !Number.isFinite(Date.parse(event.created_at)) || new Date(event.created_at).toISOString() !== event.created_at) fail('invalid event');
  if (event.deleted ? event.record !== null : validateRecord(event.record).id !== event.record_id) fail('event record mismatch');
  const { id, ...payload } = event;
  if (id !== graphDigest(payload)) fail('event fingerprint mismatch');
  return event;
}
export function mergeGraphEvents(...batches) {
  const events = new Map();
  for (const batch of batches) {
    if (!Array.isArray(batch) || batch.length > MAX_EVENTS) fail('event limit exceeded');
    for (const event of batch) events.set(validateGraphEvent(event).id, event);
  }
  if (events.size > MAX_EVENTS || Buffer.byteLength(canonical([...events.values()])) > MAX_BYTES) fail('journal limit exceeded');
  for (const event of events.values()) {
    for (const parent of parentsOf(event)) if (!events.has(parent) || events.get(parent).record_id !== event.record_id) fail('missing or mismatched parent');
  }
  // Parents are content addressed, but reject explicit cycles as well.
  const done = new Set(), visiting = new Set();
  for (const event of events.values()) {
    if (done.has(event.id)) continue;
    const stack = [{ id: event.id, finish: false }];
    while (stack.length) {
      const current = stack.pop();
      if (current.finish) { visiting.delete(current.id); done.add(current.id); continue; }
      if (done.has(current.id)) continue;
      if (visiting.has(current.id)) fail('cyclic history');
      visiting.add(current.id); stack.push({ id: current.id, finish: true });
      for (const parent of parentsOf(events.get(current.id))) stack.push({ id: parent, finish: false });
    }
  }
  return [...events.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function graphHeads(events) {
  const parents = new Set(events.flatMap(parentsOf));
  const heads = new Map();
  for (const event of events) if (!parents.has(event.id)) heads.set(event.record_id, [...(heads.get(event.record_id) || []), event]);
  return heads;
}
export function reconcileEquivalentGraphHeads(input) {
  const events=mergeGraphEvents(input),added=[];
  for(const [record_id,heads] of graphHeads(events)) {
    if(heads.length<2||heads.length>20)continue;
    const first=heads[0];
    if(heads.some(head=>head.origin!==first.origin||head.deleted!==first.deleted||canonical(head.record)!==canonical(first.record)))continue;
    added.push(createGraphEvent(first.record,{record_id,parent:heads.map(head=>head.id).sort(),origin:first.origin,deleted:first.deleted,
      created_at:new Date(Math.max(...heads.map(head=>Date.parse(head.created_at)))+1).toISOString()}));
  }
  return mergeGraphEvents(events,added);
}
export function materializeGraph(input) {
  const events = mergeGraphEvents(input), nodes = [], edges = [], conflicts = [];
  for (const [record_id, heads] of graphHeads(events)) {
    if (heads.length !== 1) { conflicts.push({ record_id, event_ids: heads.map(event => event.id).sort() }); continue; }
    const event = heads[0]; if (event.deleted) continue;
    const { kind, ...record } = event.record;
    const value = { ...record, event_id: event.id, created_at: event.created_at };
    (kind === 'entity' ? nodes : edges).push(value);
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id)); edges.sort((a, b) => a.id.localeCompare(b.id)); conflicts.sort((a, b) => a.record_id.localeCompare(b.record_id));
  const active = new Set(nodes.map(node => node.id));
  const visibleEdges = edges.filter(edge => active.has(edge.source) && active.has(edge.target));
  const hash = graphDigest({ schema_version: 1, nodes, edges: visibleEdges, conflicts, event_ids: events.map(event => event.id) });
  return { schema_version: 1, hash, generated_at: new Date().toISOString(), nodes, edges: visibleEdges, conflicts, events };
}
export function updateGraphRecords(events, records, { origin, created_at, removeIds = [] } = {}) {
  const merged = mergeGraphEvents(events), heads = graphHeads(merged), added = [];
  for (const record of records) {
    validateRecord(record);
    const previous = heads.get(record.id) || [];
    // A conflict always needs an explicit human resolution; refresh must preserve it.
    if (previous.length > 1 || (previous.length === 1 && (previous[0].origin !== origin || (canonical(previous[0].record) === canonical(record) && !previous[0].deleted)))) continue;
    const timestamp = created_at && previous[0] && Date.parse(created_at) <= Date.parse(previous[0].created_at)
      ? new Date(Date.parse(previous[0].created_at) + 1).toISOString() : created_at;
    const event = createGraphEvent(record, { parent: previous[0]?.id || null, origin, created_at: timestamp });
    added.push(event); heads.set(record.id, [event]);
  }
  for (const record_id of removeIds) {
    const previous = heads.get(record_id) || [];
    if (previous.length !== 1 || previous[0].deleted || previous[0].origin !== origin) continue;
    added.push(createGraphEvent(null, { record_id, parent: previous[0].id, deleted: true, origin, created_at }));
  }
  return mergeGraphEvents(merged, added);
}
export function selectGraph(snapshot, query = '', { limit = 60, excludeTaskId, fallback = false } = {}) {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)?.slice(0, 40) || [];
  const allowed = id => !excludeTaskId || (id !== `task:${excludeTaskId}` && !id.startsWith(`decision:${excludeTaskId}:`) && !id.startsWith(`candidate:${excludeTaskId}:`));
  const scores = new Map();
  for (const node of snapshot.nodes) {
    if (!allowed(node.id)) continue;
    const content = `${node.name} ${node.summary} ${node.id}`.toLocaleLowerCase();
    const score = tokens.reduce((sum, word) => sum + (content.includes(word) ? 1 : 0), 0);
    if (!tokens.length || score) scores.set(node.id, score);
  }
  for (const edge of snapshot.edges) {
    const content = edge.text.toLocaleLowerCase();
    const score = tokens.reduce((sum, word) => sum + (content.includes(word) ? 1 : 0), 0);
    if (score) for (const id of [edge.source, edge.target]) if (allowed(id)) scores.set(id, (scores.get(id) || 0) + score);
  }
  let selected = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([id]) => id);
  if (fallback && tokens.length && !selected.length) selected = snapshot.nodes.filter(node => allowed(node.id) && node.entity_type !== 'decision' && node.entity_type !== 'task').slice(0, limit).map(node => node.id);
  const ids = new Set(selected);
  for (const edge of snapshot.edges) if (ids.has(edge.source) || ids.has(edge.target)) {
    for (const id of [edge.source,edge.target]) if (ids.size < limit && allowed(id)) ids.add(id);
  }
  return { ...snapshot, nodes: snapshot.nodes.filter(node => ids.has(node.id)), edges: snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) };
}
export function graphContext(snapshot, query, options = {}) {
  const selected = selectGraph(snapshot, query, { limit: 24, fallback: true, ...options });
  return { engine: 'graphiti', search_mode: 'text_and_relationships', sha256: snapshot.hash,
    node_count: snapshot.nodes.length, edge_count: snapshot.edges.length, conflict_count: snapshot.conflicts.length,
    nodes: selected.nodes, edges: selected.edges.slice(0, 40), conflicts: snapshot.conflicts.slice(0, 10),
    instructions: 'Use only current non-conflicting records with their evidence. Candidate is not production. Decisions retain originating task scope. Conflicts are unresolved evidence, never choose a branch silently.' };
}
export async function readGraphJournal(path) {
  const value = await readGraphFile(path);
  if (!value) return [];
  if (value.schema_version !== 1) fail('unknown journal version');
  return mergeGraphEvents(value.events);
}
export async function prepareGraphDirectory(path) { await safeJournalParent(path,true); }
export async function readGraphFile(path) {
  await safeJournalParent(path, false);
  const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) fail('unsafe journal file');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function writeGraphJournal(path, events) {
  return writeGraphFile(path, { schema_version: 1, events: mergeGraphEvents(events) });
}
export async function writeGraphFile(path, value) {
  const body = canonical(value);
  if (Buffer.byteLength(body) > 16 * 1024 * 1024) fail('graph file limit exceeded');
  await safeJournalParent(path, true);
  const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) fail('unsafe journal destination');
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(body); await file.sync(); await file.close();
    await safeJournalParent(path, false); await rename(temporary, path);
    const directory = await open(dirname(resolve(path)), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function safeJournalParent(path, create) {
  const directory = dirname(resolve(path)); let current = parse(directory).root;
  for (const part of directory.slice(current.length).split('/').filter(Boolean)) {
    current = join(current,part);
    if (create) await mkdir(current,{mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(current).catch(error => { if (!create && error.code === 'ENOENT') return null; throw error; });
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe journal parent');
  }
  if (await realpath(directory) !== directory) fail('journal parent must be canonical');
}
export async function readGraphSeed(path = new URL('../project-knowledge/graph-seed.json', import.meta.url)) {
  const seed = JSON.parse(await readFile(path, 'utf8'));
  if (seed.schema_version !== 1 || !Array.isArray(seed.nodes) || !Array.isArray(seed.edges) || seed.nodes.length > 100 || seed.edges.length > 150) fail('invalid curated seed');
  const records = [...seed.nodes.map(node => ({ kind: 'entity', ...node })), ...seed.edges.map(edge => ({ kind: 'relation', ...edge }))];
  const ids = new Set(); for (const record of records) { validateRecord(record); if (ids.has(record.id)) fail('duplicate seed record'); ids.add(record.id); }
  const entities = new Set(seed.nodes.map(node => node.id));
  if (seed.edges.some(edge => !entities.has(edge.source) || !entities.has(edge.target))) fail('missing seed endpoint');
  return records;
}
