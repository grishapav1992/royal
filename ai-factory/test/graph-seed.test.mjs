import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadProjectKnowledge } from '../lib/project-knowledge.mjs';

const factory = new URL('../', import.meta.url);
const project = new URL('../', factory);
const seedFile = new URL('project-knowledge/graph-seed.json', factory);
const manifestFile = new URL('project-knowledge/manifest.json', factory);
const statuses = new Set(['verified', 'decision', 'candidate', 'planned']);
const environments = new Set(['project', 'production', 'sandbox', 'testnet', 'candidate']);
const types = new Set(['project', 'service', 'integration', 'mechanic', 'document', 'decision']);

test('curated project graph has valid endpoints and source-pinned evidence', async () => {
  const graph = JSON.parse(await readFile(seedFile, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  assert.equal(graph.schema_version, 1);
  assert.equal(graph.version, manifest.version);
  assert.ok(graph.nodes.length > 0 && graph.nodes.length <= 100);
  assert.ok(graph.edges.length > 0 && graph.edges.length <= 100);
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  assert.equal(nodeIds.size, graph.nodes.length);
  assert.equal(new Set(graph.edges.map(edge => edge.id)).size, graph.edges.length);
  for (const path of graph.source_files ?? []) {
    assert.match(path, /^(?:server\/|src\/|compose\.finance\.yaml$|deployment\/finance\/)/);
    assert.doesNotMatch(path, /(?:\.env|secret|credential|\.\.)/i);
  }
  const allowed = new Set(['project-knowledge/PROJECT.md', ...manifest.documents, ...(graph.source_files ?? [])]);
  const hashes = new Map();
  for (const item of [...graph.nodes, ...graph.edges]) {
    assert.match(item.id, /^[a-z0-9:_-]+$/);
    assert.ok(statuses.has(item.status), item.id);
    assert.ok(environments.has(item.environment), item.id);
    assert.ok(Array.isArray(item.evidence) && item.evidence.length > 0, item.id);
    for (const evidence of item.evidence) {
      assert.ok(allowed.has(evidence.path), evidence.path);
      assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
      if (!hashes.has(evidence.path)) {
        const root = evidence.path === 'project-knowledge/PROJECT.md' ? factory : project;
        hashes.set(evidence.path, createHash('sha256').update(await readFile(new URL(evidence.path, root))).digest('hex'));
      }
      assert.equal(evidence.sha256, hashes.get(evidence.path), `${item.id}: ${evidence.path}`);
    }
  }
  for (const node of graph.nodes) {
    assert.ok(types.has(node.entity_type), node.id);
    assert.equal(typeof node.name, 'string');
    assert.ok(node.name.trim());
    assert.equal(typeof node.summary, 'string');
    assert.ok(node.summary.trim());
  }
  for (const edge of graph.edges) {
    assert.ok(nodeIds.has(edge.source), edge.id);
    assert.ok(nodeIds.has(edge.target), edge.id);
    assert.match(edge.predicate, /^[a-z_]+$/);
    assert.equal(typeof edge.text, 'string');
    assert.ok(edge.text.trim());
  }
});

test('recorded adapters preserve the reviewed source scopes and financial environment boundaries', async () => {
  const raw = await readFile(seedFile, 'utf8');
  const graph = JSON.parse(raw);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  assert.match(nodes.get('service:finance_gateway').summary, /интеграционный шлюз/);
  assert.match(nodes.get('service:finance_gateway').summary, /списания, зачисления/);
  assert.match(nodes.get('service:finance_gateway').summary, /симулятора USDT_SIM/);
  for (const [id, status, environment] of [
    ['service:finance_gateway', 'verified', 'sandbox'],
    ['service:finance_api', 'verified', 'sandbox'],
    ['service:casino_api_pro_adapter', 'verified', 'production'],
    ['integration:casino_api_pro_sandbox', 'verified', 'sandbox'],
    ['integration:tron_nile', 'verified', 'testnet'],
    ['integration:tron_mainnet_pilot', 'candidate', 'candidate'],
    ['mechanic:real_crypto_withdrawal', 'planned', 'project'],
    ['integration:multichain_conversion', 'planned', 'project'],
    ['mechanic:unified_wallet', 'planned', 'project'],
    ['mechanic:own_games', 'verified', 'project'],
  ]) {
    assert.equal(nodes.get(id)?.status, status, id);
    assert.equal(nodes.get(id)?.environment, environment, id);
  }
  assert.ok(graph.edges.some(edge => edge.source === 'service:casino_api_pro_adapter'
    && edge.target === 'integration:casino_api_pro_sandbox' && edge.environment === 'sandbox'));
  assert.ok(graph.edges.some(edge => edge.source === 'mechanic:finance_sim_ledger'
    && edge.target === 'mechanic:real_crypto_withdrawal' && edge.predicate === 'does_not_implement'));
  assert.ok(graph.edges.some(edge => edge.source === 'integration:tron_nile'
    && edge.target === 'mechanic:finance_sim_ledger' && edge.predicate === 'is_separate_from'));
  assert.equal(raw.includes(String.fromCharCode(0x2014)), false);
  assert.doesNotMatch(raw, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(raw, /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/);
  assert.doesNotMatch(raw, /\b(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9_-]{20,})\b/);
});

test('the November review covers the ten stale records and keeps source review separate from deployment claims', async () => {
  const graph = JSON.parse(await readFile(seedFile, 'utf8'));
  const required = ['service:finance_gateway', 'service:finance_api', 'mechanic:own_games', 'service:tron_reader',
    'service:nile_creditor', 'edge:gateway_api', 'edge:own_games_demo', 'edge:nile_reader', 'edge:creditor_reader', 'edge:separate_nile_sim'];
  assert.deepEqual(new Set(graph.review_scope.requested_ids), new Set(required));
  assert.equal(graph.legacy_record_version, '2026-10-10.1');
  const records = new Map([...graph.nodes, ...graph.edges].map(record => [record.id, record]));
  for (const id of [...required, ...graph.review_scope.related_ids]) {
    const review = graph.record_reviews[id], record = records.get(id);
    assert.equal(review.version, graph.version, id);
    assert.equal(review.checked_at, '2026-11-03', id);
    assert.match(review.source_commit, /^[a-f0-9]{40}$/);
    assert.ok(record.evidence.some(proof => proof.path === 'docs/project-knowledge-review-20261103.md'), id);
    assert.ok(record.evidence.some(proof => graph.source_files.includes(proof.path)), id);
  }
  assert.equal(graph.record_reviews['service:game'], undefined);
  for (const id of ['integration:tron_nile', 'service:nile_play', 'mechanic:nile_auto_deposit', 'edge:game_nile_play', 'edge:mainnet_game_candidate']) {
    assert.match(records.get(id).summary ?? records.get(id).text, /410/, id);
  }
  assert.match(records.get('mechanic:own_games').summary, /не является списком доступных игр/);
  assert.match(records.get('service:finance_api').summary, /не подтверждает запущенные реплики/);
});

test('the current factory knowledge bundle has no missing references and its copies match main documents', async () => {
  const directory = new URL('../project-knowledge/', import.meta.url);
  const bundle = await loadProjectKnowledge({ directory: fileURLToPath(directory), source: fileURLToPath(new URL('references/', directory)) });
  assert.equal(bundle.version, '2026-11-03.1');
  assert.ok(bundle.summary.includes('Исторический справочник от 10 октября'));
  for (const document of bundle.documents) {
    assert.equal(document.available, true, document.path);
    assert.equal(document.text, await readFile(new URL(document.path, project), 'utf8'), document.path);
  }
});
