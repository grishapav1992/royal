import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { collectBrain, knowledgeSeed } from './project-brain.mjs';

const HASH = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const FILE_CAP = 8 * 1024 * 1024, TOTAL_CAP = 512 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clean = text => String(text).replaceAll('\u2014', '-');
const native = path => /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|sh|md|yaml|yml)$/.test(path);
const textConfig = path => /\.(?:json|cfg|css|html|txt|toml|ini)$/.test(path);
const prefixFor = id => 'production_' + digest(id).slice(0, 20) + '_';
const assetReference = path => typeof path === 'string'
  && /\.(?:png|jpe?g|webp|gif|svg|avif|ico|mp3|mp4|webm|ogg|wav|woff2?|ttf|otf|glb|gltf|zip|tar|gz)$/i.test(path)
  && safeSourcePath(path.replace(/\.[^.]+$/, '.reference'));

export function safeSourcePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length < 1024
    && !/[\\\u0000-\u001f\u007f]/.test(path) && !path.startsWith('/')
    && path.split('/').every(part => part && part !== '.' && part !== '..'
      && !/^(?:\.env(?:\..*)?|node_modules|artifacts|dist|dist-server|\.git|data|private|secrets)$/i.test(part))
    && !/\.(?:pem|key|sqlite|db|zip|tar|gz|png|jpg|webp|mp3|mp4|woff2?)$/i.test(path);
}

export function restoreSource(base, row) {
  const origin = row.origin;
  if (!origin || !COMMIT.test(origin.commit) || !safeSourcePath(origin.path)
    || !HASH.test(origin.baseSha256) || !HASH.test(row.sha256)) throw Error('Missing immutable source origin.');
  let bytes = Buffer.from(Buffer.from(base).toString('utf8').replaceAll('\r\n', '\n'));
  if (digest(bytes) !== origin.baseSha256) throw Error('Git source differs from its recorded base hash.');
  for (const patch of origin.patches ?? []) {
    if (typeof patch.from !== 'string' || !patch.from || typeof patch.to !== 'string') throw Error('Invalid projection patch.');
    const parts = bytes.toString('utf8').split(patch.from);
    if (parts.length !== 2) throw Error('Projection patch is not unique.');
    bytes = Buffer.from(parts.join(patch.to));
  }
  if (digest(bytes) !== row.sha256) throw Error('Reconstructed source differs from deployed projection.');
  return bytes;
}

async function boundedFile(root, path) {
  if (!safeSourcePath(path)) throw Error('Unsafe graph source path.');
  const base = await realpath(root), candidate = resolve(base, path);
  // Check every parent too: a symlink must never escape through an intermediate directory.
  let cursor = base;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw Error('Graph sources cannot be symbolic links.');
  }
  if (!candidate.startsWith(base + sep)) throw Error('Graph source escaped its root.');
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.size > FILE_CAP) throw Error('Graph source exceeds the file limit.');
  const bytes = await readFile(candidate);
  if (bytes.length > FILE_CAP) throw Error('Graph source exceeds the file limit.');
  return bytes;
}

async function githubSource(commit, path) {
  if (!COMMIT.test(commit) || !safeSourcePath(path)) throw Error('Invalid immutable Git source request.');
  const response = await fetch('https://raw.githubusercontent.com/grishapav1992/royal/' + commit + '/' + path.split('/').map(encodeURIComponent).join('/'),
    { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > FILE_CAP) throw Error('Immutable Git source is unavailable.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > FILE_CAP) { await response.body.cancel().catch(() => {}); throw Error('Immutable Git source exceeds the file limit.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function materialize(root, path, bytes) {
  if (!safeSourcePath(path)) throw Error('Unsafe graph output path.');
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
}

async function extractGraph(request, { programRoot, workRoot }) {
  const requestPath = join(workRoot, 'extraction-request.json'), output = join(workRoot, 'graph.json');
  await writeFile(requestPath, JSON.stringify({ ...request, output }), { mode: 0o600 });
  const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR'];
  const env = Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { GRAPHIFY_BACKEND: 'none', GRAPHIFY_NO_AUTOUPDATE: '1', GRAPHIFY_NO_SKILL_UPDATE: '1', GRAPHIFY_NO_UPDATE_CHECK: '1', GRAPHIFY_NO_LOG: '1', GRAPHIFY_LITELLM_LOG: '0', PYTHONUNBUFFERED: '1' });
  await new Promise((accept, reject) => {
    const child = spawn('uv', ['run', '--python', '3.12', '--with', 'graphifyy==0.9.101', 'python', join(programRoot, 'scripts/production-brain-extract.py'), requestPath],
      { cwd: workRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 25 * 60 * 1000); timer.unref();
    child.on('error', () => { clearTimeout(timer); reject(Error('Production graph extractor could not start.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? accept() : reject(Error('Production graph extraction failed.')); });
  });
  return readFile(output);
}

function qualifyBrain(brain, component) {
  const prefix = component.prefix, id = value => prefix + value;
  for (const record of brain.index.records) {
    record.id = id(record.id); record.key = component.id + ':' + record.key;
    record.title = clean(record.title + ' [' + component.id + ']'); record.component = component.id;
    record.sourceCoverage = component.coverage;
    record.links = record.links.map(link => ({ ...link, ...(link.record ? { record: component.id + ':' + link.record } : {}) }));
  }
  brain.nodes = brain.nodes.map(node => ({ ...node, id: id(node.id), label: clean(node.label + ' [' + component.id + ']'), component: component.id }));
  brain.edges = brain.edges.map(edge => ({ ...edge, source: id(edge.source), target: id(edge.target), component: component.id }));
  brain.fileLinks = brain.fileLinks.map(link => ({ ...link, source: id(link.source), component: component.id }));
  return brain;
}

export async function buildProductionArtifacts(receipt, { programRoot, liveRoot = '/opt/royal', workRoot,
  fetchSource = githubSource, runExtract = extractGraph } = {}) {
  if (receipt?.schemaVersion !== 1 || receipt.verified !== true || !HASH.test(receipt.runtimeFingerprint)
    || !COMMIT.test(receipt.sourceCommit) || !Array.isArray(receipt.components) || !receipt.components.length
    || receipt.components.length > 512 || !programRoot || !workRoot) throw Error('Invalid production graph build input.');
  programRoot = resolve(programRoot); liveRoot = resolve(liveRoot); workRoot = resolve(workRoot);
  const install = JSON.parse(await boundedFile(programRoot, 'install-receipt.json'));
  if (!COMMIT.test(install.sourceCommit) || install.githubVerified !== true) throw Error('Graph knowledge must come from a verified installed Git commit.');
  const sourceRoot = join(workRoot, 'sources');
  await mkdir(sourceRoot, { mode: 0o700 });
  const components = [], brains = [], sourceCache = new Map(), sourceHashes = new Map();
  let total = 0, fileCount = 0;
  const remember = (path, sha256, component) => {
    if (!sourceHashes.has(path)) sourceHashes.set(path, new Map());
    sourceHashes.get(path).set(sha256, [...(sourceHashes.get(path).get(sha256) ?? []), component]);
  };
  async function bytesFor(row) {
    if (!safeSourcePath(row?.path) || !HASH.test(row.sha256)) throw Error('Invalid deployed source descriptor.');
    try { const bytes = await boundedFile(liveRoot, row.path); if (digest(bytes) === row.sha256) return bytes; }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !row.origin) throw error; }
    if (!row.origin) throw Error('Verified live source is no longer available.');
    const key = row.origin.commit + ':' + row.origin.path;
    if (!sourceCache.has(key)) sourceCache.set(key, Promise.resolve().then(() => fetchSource(row.origin.commit, row.origin.path)));
    return restoreSource(await sourceCache.get(key), row);
  }
  try {
    for (const value of receipt.components) {
      if (!['host', 'backend', 'module'].includes(value.kind) || typeof value.id !== 'string' || value.id.length > 200
        || components.some(item => item.id === value.id) || !Array.isArray(value.sources) || value.sources.length > 5000) throw Error('Invalid production component.');
      const exact = value.sourceSet === 'verified-projection-inputs';
      const component = { ...value, scope: value.kind, prefix: prefixFor(value.id), root: join(sourceRoot, prefixFor(value.id)),
        coverage: exact && value.coverage === 'complete' ? 'complete' : 'partial', referenceOnly: !exact, inputs: [], sources: [] };
      await mkdir(component.root, { mode: 0o700 });
      const seen = new Set();
      // Retrieval is deliberately bounded. A graph update does not compete with gameplay for a large worker pool.
      for (const row of value.sources) {
        if (seen.has(row.path)) throw Error('Duplicate production source descriptor.'); seen.add(row.path);
        fileCount += 1;
        if (fileCount > 12000) throw Error('Production graph exceeds its source reference limit.');
        if ((assetReference(row.path) || safeSourcePath(row.path) && !native(row.path) && !textConfig(row.path)) && HASH.test(row.sha256)) {
          // Verified receipt hashes describe assets without copying or parsing their bodies.
          component.inputs.push({ path: row.path, sha256: row.sha256, referenceOnly: true, materialized: false });
          remember(row.path, row.sha256, value.id);
          continue;
        }
        const bytes = await bytesFor(row);
        total += bytes.length;
        if (total > TOTAL_CAP || fileCount > 12000) throw Error('Production graph exceeds its sparse source limits.');
        await materialize(component.root, row.path, bytes);
        component.inputs.push({ path: row.path, sha256: row.sha256 });
        if (exact && native(row.path)) component.sources.push(row.path);
        remember(row.path, row.sha256, value.id);
      }
      if (exact) {
        const brain = await collectBrain(component.root, component, { commit: receipt.sourceCommit, workingTreeModified: false, scope: 'production', component: value.id });
        brains.push(qualifyBrain(brain, component));
      }
      components.push(component);
    }
    // Evidence can also be bound to the independently verified live source inventory.
    for (const [path, sha256] of Object.entries(receipt.sourceInventory ?? {})) if (safeSourcePath(path) && HASH.test(sha256)) remember(path, sha256, 'verified-live-inventory');
    const manifest = JSON.parse(await boundedFile(programRoot, 'ai-factory/project-knowledge/manifest.json'));
    const contextPaths = [...new Set(['AGENTS.md', 'ai-factory/project-knowledge/manifest.json', knowledgeSeed,
      'ai-factory/project-knowledge/' + manifest.summary, ...manifest.documents])];
    const context = { id: 'approved-git-knowledge', scope: 'knowledge', coverage: 'source-reviewed', sourceCommit: install.sourceCommit,
      prefix: prefixFor('approved-git-knowledge'), root: join(sourceRoot, 'knowledge'), inputs: [], sources: [], referenceOnly: false };
    await mkdir(context.root, { mode: 0o700 });
    for (const path of contextPaths) {
      const bytes = await boundedFile(programRoot, path);
      await materialize(context.root, path, bytes);
      context.inputs.push({ path, sha256: digest(bytes) });
      if (native(path)) context.sources.push(path);
    }
    const seed = JSON.parse(await readFile(join(context.root, knowledgeSeed), 'utf8'));
    const evidencePaths = new Set([...seed.nodes, ...seed.edges].flatMap(item => (item.evidence ?? []).map(proof => proof.path.startsWith('project-knowledge/') ? 'ai-factory/' + proof.path : proof.path)));
    for (const path of evidencePaths) {
      if (context.inputs.some(item => item.path === path)) continue;
      const hashes = sourceHashes.get(path);
      if (hashes?.size === 1) context.inputs.push({ path, sha256: hashes.keys().next().value, evidenceOnly: true });
    }
    const knowledge = qualifyBrain(await collectBrain(context.root, context, { commit: install.sourceCommit,
      workingTreeModified: false, scope: 'approved-git-knowledge' }), context);
    brains.push(knowledge); components.push(context);
    const published = (receipt.modules ?? []).map(module => {
      const component = components.find(item => item.gameId === module.gameId && item.scope === 'module');
      const id = prefixFor('published:' + module.gameId) + 'package';
      return { id, kind: 'module', key: 'published-module:' + module.gameId, title: 'Опубликованный пакет ' + module.gameId,
        source: 'verified-production-receipt', gameId: module.gameId, version: module.version, component: component?.id,
        summary: 'Пакет установлен на сервере. Доступность игры для новых раундов этим не подтверждается.',
        availability: 'published-package-only', manifestSha256: module.manifestSha256, pointerSha256: module.pointerSha256, links: [] };
    });
    const records = [...brains.flatMap(brain => brain.index.records), ...published];
    const index = { schemaVersion: 1, provenance: { commit: receipt.sourceCommit, scope: 'production', runtimeFingerprint: receipt.runtimeFingerprint,
      releaseId: receipt.release, workingTreeModified: false, knowledgeSourceCommit: install.sourceCommit }, records,
      counts: Object.fromEntries(['repository', 'module', 'command', 'math_policy', 'knowledge'].map(kind => [kind, records.filter(item => item.kind === kind).length])),
      evidenceDrift: brains.flatMap(brain => brain.index.evidenceDrift), unresolvedReferences: brains.flatMap(brain => brain.index.unresolvedReferences),
      reviewedKnowledge: records.filter(item => item.reviewedAt).length, knowledgeNeedingReview: records.filter(item => item.evidenceState === 'needs_review').length };
    const nodes = [...brains.flatMap(brain => brain.nodes), ...published.map(item => ({ id: item.id, label: item.title,
      file_type: 'concept', brain_kind: 'module', source_file: item.source, source_location: 'L1', _origin: 'ast', component: item.component }))];
    const extraction = { components, nodes, edges: brains.flatMap(brain => brain.edges), fileLinks: brains.flatMap(brain => brain.fileLinks),
      commit: receipt.sourceCommit, runtimeFingerprint: receipt.runtimeFingerprint };
    const graph = await runExtract(extraction, { programRoot, workRoot });
    const production = { schemaVersion: 1, scope: 'production', runtimeFingerprint: receipt.runtimeFingerprint, releaseId: receipt.release,
      verifiedAt: receipt.collectedAt, toolSourceCommit: install.sourceCommit,
      components: components.map(({ root, prefix, inputs, sources, ...item }) => ({ ...item, sourceCount: inputs.length,
        sources: item.scope === 'knowledge' ? inputs : item.sources ?? receipt.components.find(value => value.id === item.id)?.sources ?? [] })) };
    const lines = ['# Общие знания проекта «Рояль»', '', 'Публикация: `' + receipt.release + '`. Отпечаток: `' + receipt.runtimeFingerprint + '`.', '',
      'Основа: проверенные компоненты работающей публикации. Версии компонентов могут различаться.', '',
      '| Компонент | Покрытие | Источники |', '| --- | --- | --- |',
      ...components.map(item => '| ' + clean(item.id) + ' | ' + item.coverage + (item.referenceOnly ? ', только ссылки на исходники' : '') + ' | ' + item.inputs.length + ' |'), '',
      'Сохранённых записей знаний: ' + index.counts.knowledge + '. Требуют пересмотра: ' + index.knowledgeNeedingReview + '.',
      'Проверка хешей сохраняет исходные доказательства. Она не подтверждает заново смысл старых утверждений.',
      'Опубликованный игровой пакет не означает доступность игры для игроков.', ''];
    return { artifacts: { 'graph.json': graph, 'project-brain.json': Buffer.from(clean(JSON.stringify(index))), 'PROJECT_BRAIN.md': Buffer.from(lines.join('\n')) }, production };
  } finally { await rm(sourceRoot, { recursive: true, force: true }); }
}
