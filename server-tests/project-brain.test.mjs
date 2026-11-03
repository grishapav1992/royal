import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBrain, formatBrainQuery, brainReport, knowledgeSeed, mathPolicy } from '../scripts/project-brain.mjs';

const temporaryRoot = fileURLToPath(new URL('../graphify-out/', import.meta.url));
const sha = text => createHash('sha256').update(text).digest('hex');
const provenance = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), workingTreeModified: false };

async function fixture(callback) {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(resolve(temporaryRoot, 'brain-test-'));
  const inputs = [], sources = [];
  async function put(path, value, source = false) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), text);
    inputs.push({ path, sha256: sha(text) });
    if (source) sources.push(path);
  }
  try {
    await put('AGENTS.md', '# Rules\n', true);
    await put('docs/current.md', '# Recorded source\n', true);
    await put('docs/changed.md', '# New content\n', true);
    await put('src/wallet.ts', 'export const balance = 0;\n', true);
    await put('server-tests/wallet.test.ts', 'export const walletTest = true;\n', true);
    await put('games/test/entry.ts', 'export const game = true;\n', true);
    await put('package.json', { scripts: { 'test:wallet': 'node --test server-tests/*wallet*.ts && touch marker', 'test:all': 'npm run test:wallet' } });
    await put('games/test/package.json', { gameId: 'studio-test', version: '1.0.0', entry: 'entry.ts', rulesVersion: 2,
      apiVersion: 1, progressVersion: 1, scripts: { build: 'node ../../src/wallet.ts' } });
    await put('docs/game-math/qualifications/test.json', { recorded: true });
    await put(mathPolicy, { schemaVersion: 1,
      profiles: { 'studio-test': { rulesVersion: 2, target: 0.96, sources: ['src/wallet.ts', 'deployment/releases/old/source.ts'], proof: 'docs/game-math/qualifications/test.json' } },
      stakePolicies: { 'studio-test': { sources: ['server-tests/wallet.test.ts'] } },
      versionProfiles: { 'studio-test': { '1': { rulesVersion: 1, sources: ['src/wallet.ts'] } } },
      nonWagered: { cosmetics: 'Declared free cosmetics' } });
    const current = [{ path: 'docs/current.md', sha256: sha('# Recorded source\n') }];
    const changed = [{ path: 'docs/changed.md', sha256: '0'.repeat(64) }];
    await put(knowledgeSeed, { schema_version: 1, version: '2026-10-10.1', nodes: [
      { id: 'mechanic:wallet', name: 'Кошелёк', summary: 'Записанное утверждение', entity_type: 'mechanic', status: 'verified', environment: 'production', evidence: current },
      { id: 'service:old_wallet', name: 'Старый кошелёк', summary: 'Историческое утверждение', entity_type: 'service', status: 'verified', environment: 'sandbox', evidence: changed },
    ], edges: [{ id: 'relation:wallet', source: 'mechanic:wallet', target: 'service:old_wallet', predicate: 'uses',
      text: 'Историческая связь', status: 'verified', environment: 'sandbox', evidence: changed }] });
    await callback(root, { inputs, sources });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('the project layer connects declared modules, commands, policy sources and proof files without executing commands', async () => fixture(async (root, input) => {
  const brain = await collectBrain(root, input, provenance);
  assert.equal(brain.index.counts.module, 1);
  assert.equal(brain.index.counts.command, 3);
  assert.equal(brain.index.counts.math_policy, 4);
  const module = brain.index.records.find(item => item.key === 'module:studio-test');
  assert.ok(module.links.some(link => link.relation === 'entry' && link.path === 'games/test/entry.ts'));
  assert.ok(module.links.some(link => link.relation === 'declared_policy'));
  assert.equal(module.availability, undefined);
  const command = brain.index.records.find(item => item.key === 'command:package.json:test:wallet');
  assert.ok(command.links.some(link => link.path === 'server-tests/wallet.test.ts'));
  const all = brain.index.records.find(item => item.key === 'command:package.json:test:all');
  assert.ok(all.links.some(link => link.record === command.key));
  const query = formatBrainQuery(brain.index, 'test:wallet');
  assert.match(query.text, /\[command\] npm test:wallet/);
  assert.doesNotMatch(query.text, /\[command\] npm test:all/);
  const policy = brain.index.records.find(item => item.key === 'math:profiles:studio-test');
  assert.equal(policy.qualificationState, 'not_evaluated');
  assert.ok(policy.links.some(link => link.path === 'docs/game-math/qualifications/test.json'));
  assert.ok(brain.index.unresolvedReferences.some(link => link.path === 'deployment/releases/old/source.ts'));
  const ids = new Set(brain.nodes.map(node => node.id));
  assert.ok(brain.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
  await assert.rejects(access(resolve(root, 'marker')), { code: 'ENOENT' });
}));

test('historical knowledge retains its status and hashes while changed evidence marks nodes and relations for review', async () => fixture(async (root, input) => {
  const { index, nodes, edges } = await collectBrain(root, input, provenance);
  const old = index.records.find(item => item.key === 'knowledge:service:old_wallet');
  assert.equal(old.recordedStatus, 'verified');
  assert.equal(old.recordedEnvironment, 'sandbox');
  assert.equal(old.evidenceState, 'needs_review');
  assert.equal(old.evidence[0].expected, '0'.repeat(64));
  assert.equal(old.evidence[0].state, 'changed');
  assert.equal(index.knowledgeNeedingReview, 2);
  assert.equal(index.evidenceDrift.length, 1);
  const current = index.records.find(item => item.key === 'knowledge:mechanic:wallet');
  assert.equal(current.evidenceState, 'matches_recorded_hash');
  assert.equal(current.liveProductionState, 'not_checked');
  const relation = index.records.find(item => item.key === 'knowledge:relation:wallet');
  assert.equal(relation.evidenceState, 'needs_review');
  assert.ok(edges.some(edge => edge.source === relation.id && edge.relation === 'recorded_object' && edge.target === old.id));
  assert.ok(nodes.find(node => node.id === old.id).label.includes('needs_review'));
  const result = formatBrainQuery(index, 'старый кошелек');
  assert.equal(result.found, true);
  assert.match(result.text, /требует пересмотра/);
  assert.match(result.text, /docs\/changed\.md \[changed\]/);
  assert.match(result.text, /2026-10-10\.1/);
  const report = brainReport(index);
  assert.ok(report.includes(provenance.commit));
  assert.match(report, /docs\/changed\.md/);
  assert.match(report, /check:rtp/);
}));

test('missing evidence is not silently promoted and absent topics produce an explicit no-match result', async () => fixture(async (root, input) => {
  const reduced = { ...input, inputs: input.inputs.filter(file => file.path !== 'docs/current.md') };
  const { index } = await collectBrain(root, reduced, { ...provenance, workingTreeModified: true });
  const record = index.records.find(item => item.key === 'knowledge:mechanic:wallet');
  assert.equal(record.evidence[0].state, 'not_indexed');
  assert.equal(record.evidenceState, 'needs_review');
  const result = formatBrainQuery(index, 'doesnotexistanything');
  assert.equal(result.found, false);
  assert.match(result.text, /graph:query/);
  assert.match(result.text, /локальные изменения/);
}));
