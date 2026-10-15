import { readGraphSeed, graphDigest, materializeGraph, mergeGraphEvents, updateGraphRecords, graphHeads, reconcileEquivalentGraphHeads } from './knowledge-graph.mjs';

function node(id, name, summary, entity_type, status, environment, path, proof) {
  return { kind: 'entity', id, name, summary, entity_type, status, environment, evidence: [{ path, sha256: graphDigest(proof) }] };
}
function edge(id, source, target, predicate, text, status, environment, evidence) {
  return { kind: 'relation', id, source, target, predicate, text, status, environment, evidence };
}
async function factoryRecords(store, clean, client) {
  const tasks = await client.query(`SELECT id,title,description,status,requirements_version FROM ${store.table}.tasks ORDER BY id`);
  const answers = await client.query(`SELECT q.id,q.task_id,q.text,q.answer,q.answered_at FROM ${store.table}.questions q
      JOIN ${store.table}.tasks t ON t.id=q.task_id WHERE q.status='answered' AND q.answered_at IS NOT NULL
      AND length(btrim(q.answer))>0 AND t.status<>'cancelled' ORDER BY q.id`);
  const memory = await store.projectMemory({ limit: 10000, archive: true, queryClient: client });
  const records = [];
  for (const task of tasks.rows) {
    const proof = { title: clean(task.title, 300), description: clean(task.description, 1600), status: task.status, requirements_version: task.requirements_version };
    records.push(node(`task:${task.id}`, proof.title, `${proof.description || proof.title}\nСостояние задачи: ${task.status}. Версия требований: ${task.requirements_version}.`, 'task', 'planned', 'project', `task:${task.id}`, proof));
  }
  for (const answer of answers.rows) {
    const proof = { question: clean(answer.text, 900), answer: clean(answer.answer, 2600), answered_at: new Date(answer.answered_at).toISOString() };
    const record = node(`decision:${answer.task_id}:${answer.id}`, clean(answer.text, 500) || 'Решение владельца', proof.answer || 'Ответ скрыт фильтром чувствительных данных.', 'decision', 'decision', 'project', `task:${answer.task_id}/question:${answer.id}`, proof);
    records.push(record, edge(`decision-link:${answer.id}`, `task:${answer.task_id}`, record.id, 'decides', 'Ответ владельца относится к области этой задачи, применение к другим задачам требует проверки.', 'decision', 'project', record.evidence));
  }
  for (const delivery of memory.deliveries) {
    if (!delivery.commit_sha) continue;
    const released = delivery.state === 'released';
    const record = node(`candidate:${delivery.task_id}:${delivery.commit_sha}`, `${delivery.title}: ${released ? 'выпущено' : 'проверенный кандидат'}`,
      `${delivery.summary || delivery.tester_summary || 'QA завершено.'}\nCommit: ${delivery.commit_sha}. ${released ? 'Подтверждён успешный выпуск.' : 'Ожидает выпуска, в production не опубликовано.'}`,
      'candidate', released ? 'verified' : 'candidate', released ? 'production' : 'candidate', `task:${delivery.task_id}/candidate:${delivery.commit_sha}`, delivery);
    records.push(record, edge(`candidate-link:${delivery.task_id}:${delivery.commit_sha}`, `task:${delivery.task_id}`, record.id, 'has_candidate', record.summary, record.status, record.environment, record.evidence));
  }
  return records;
}
async function loadEvents(client, store) {
  return (await client.query(`SELECT event FROM ${store.table}.knowledge_graph_events ORDER BY id`)).rows.map(row => row.event);
}
async function persist(client, store, events) {
  if (!events.length) return;
  await client.query(`INSERT INTO ${store.table}.knowledge_graph_events(id,record_id,event)
    SELECT item->>'id',item->>'record_id',item FROM jsonb_array_elements($1::jsonb) item ON CONFLICT(id) DO NOTHING`, [JSON.stringify(events)]);
}
export async function refreshKnowledgeGraph(store, clean) {
  const seed = await readGraphSeed();
  return store.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${store.schema}:knowledge-graph`]);
    const records = await factoryRecords(store, clean, client);
    const previous = await loadEvents(client, store);
    let events = updateGraphRecords(previous, seed, { origin: 'curated', created_at: '2026-10-10T00:22:00.000Z' });
    const desired = new Set(records.map(record => record.id));
    const removeIds = [...graphHeads(events)].filter(([id, heads]) => heads.length === 1 && heads[0].origin === 'factory' && !desired.has(id)).map(([id]) => id);
    events = updateGraphRecords(events, records, { origin: 'factory', removeIds });
    const known = new Set(previous.map(event=>event.id));
    await persist(client, store, events.filter(event => !known.has(event.id)));
    return materializeGraph(events);
  });
}
export async function exchangeKnowledgeGraph(store, incoming, clean) {
  await refreshKnowledgeGraph(store, clean);
  return store.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${store.schema}:knowledge-graph`]);
    const previous = await loadEvents(client, store), events = mergeGraphEvents(previous, incoming);
    const known = new Set(previous.map(event=>event.id));
    const added = events.filter(event => !known.has(event.id));
    if (added.some(event => event.origin === 'factory' || /^(?:task|decision|candidate|decision-link|candidate-link):/.test(event.record_id))) {
      throw Object.assign(new Error('Factory facts can only be produced by the server.'),{status:400});
    }
    const reconciled=reconcileEquivalentGraphHeads(events);
    await persist(client, store, reconciled.filter(event=>!known.has(event.id)));
    const exchanged_at = new Date().toISOString();
    await client.query(`INSERT INTO ${store.table}.settings(key,value) VALUES('_graph_last_exchange',$1::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [JSON.stringify(exchanged_at)]);
    return { ...materializeGraph(reconciled), exchanged_at };
  });
}
