import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatBrainQuery } from './project-brain.mjs';
import { loadActiveSnapshot, readStatus, SharedBrainError } from './shared-brain-store.mjs';
import { verifyReceiptRuntime } from './shared-brain-update.mjs';

export const SHARED_GRAPHIFY_VERSION = '0.9.101';
const MAX_REQUEST = 16 * 1024, MAX_RESPONSE = 256 * 1024, MAX_TEXT = 64 * 1024;
const READ_ONLY_DISPATCH = [
  'import sys, pathlib, contextlib',
  'import graphify.cli as cli',
  'import graphify.serve as serve',
  'import graphify.reflect as reflect',
  'import graphify.querylog as querylog',
  '_graph_path = sys.argv[sys.argv.index("--graph") + 1]',
  'class SnapshotPath(type(pathlib.Path())):',
  '    def resolve(self, *args, **kwargs):',
  '        return self if str(self) == _graph_path else super().resolve(*args, **kwargs)',
  '    @property',
  '    def suffix(self):',
  '        return ".json" if str(self) == _graph_path else super().suffix',
  'cli.Path = SnapshotPath',
  'cli._touch_query_stamp = lambda *args, **kwargs: None',
  'querylog.log_query = lambda *args, **kwargs: None',
  'reflect.load_learning_overlay = lambda *args, **kwargs: {}',
  'serve._display_graph_path = lambda *args, **kwargs: "production graph.json"',
  'with contextlib.redirect_stderr(sys.stdout):',
  '    cli.dispatch_command(sys.argv[1])',
].join('\n');
const operations = {
  status: [], brain: ['question'], query: ['question', 'budget'], explain: ['subject'],
  path: ['source', 'target', 'directed'], affected: ['subject', 'depth', 'relations'], 'god-nodes': ['top'],
};
const invalid = message => { throw new SharedBrainError('invalid_request', message, 1); };

export function validateSharedRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || request.schemaVersion !== 1 || !Object.hasOwn(operations, request.operation)) invalid('Unsupported shared graph request.');
  let encoded;
  try { encoded = Buffer.byteLength(JSON.stringify(request)); } catch { invalid('Invalid shared graph request.'); }
  if (encoded > MAX_REQUEST) invalid('Shared graph request is too large.');
  const permitted = new Set(['schemaVersion', 'operation', 'clientCommit', ...operations[request.operation]]);
  if (Object.keys(request).some(key => !permitted.has(key))) invalid('Unexpected fields in shared graph request.');
  if (request.clientCommit !== undefined && !/^[a-f0-9]{40}$/.test(request.clientCommit)) invalid('Invalid client commit.');
  for (const name of ['question', 'subject', 'source', 'target']) {
    if (!operations[request.operation].includes(name)) continue;
    const value = request[name];
    if (typeof value !== 'string' || !value.trim() || value.trimStart().startsWith('-')
      || Buffer.byteLength(value) > 2048 || /[\u0000-\u001f\u007f]/.test(value)) invalid('Invalid graph question or subject.');
  }
  for (const [name, minimum, maximum] of [['budget', 128, 4000], ['depth', 1, 5], ['top', 1, 50]]) {
    if (request[name] !== undefined && (!Number.isInteger(request[name]) || request[name] < minimum || request[name] > maximum)) invalid('Invalid graph result bound.');
  }
  if (request.directed !== undefined && typeof request.directed !== 'boolean') invalid('Invalid path direction.');
  if (request.relations !== undefined && (!Array.isArray(request.relations) || request.relations.length > 10
    || request.relations.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)))) invalid('Invalid relationship filter.');
  return request;
}

function graphArguments(request, graphPath) {
  const args = [request.operation];
  if (request.operation === 'query') args.push(request.question, '--budget', String(request.budget ?? 2000));
  if (request.operation === 'explain') args.push(request.subject);
  if (request.operation === 'path') args.push(request.source, request.target, request.directed === false ? '--undirected' : '--directed');
  if (request.operation === 'affected') {
    args.push(request.subject, '--depth', String(request.depth ?? 2));
    for (const relation of request.relations ?? []) args.push('--relation', relation);
  }
  if (request.operation === 'god-nodes') args.push('--top', String(request.top ?? 10));
  args.push('--graph', graphPath);
  return args;
}

export function graphQueryEnvironment(environment = process.env, { production = false } = {}) {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR'];
  const result = { ...Object.fromEntries(allowed.filter(key => environment[key]).map(key => [key, environment[key]])),
    GRAPHIFY_BACKEND: 'none', GRAPHIFY_NO_AUTO_REFRESH: '1', GRAPHIFY_QUERY_LOG_DISABLE: '1',
    GRAPHIFY_NO_TIPS: '1', UV_NO_ENV_FILE: '1', PYTHONUTF8: '1' };
  if (production) Object.assign(result, { PATH: '/opt/royal-project-brain/runtime/bin:' + (result.PATH || '/usr/local/bin:/usr/bin:/bin'),
    UV_CACHE_DIR: '/var/cache/royal-project-brain/uv', UV_PYTHON_INSTALL_DIR: '/var/cache/royal-project-brain/python' });
  return result;
}

export async function runPinnedGraphify(args, snapshot) {
  return new Promise((accept, reject) => {
    const child = spawn('uv', ['tool', 'run', '--python', '3.12', '--from', 'graphifyy==' + SHARED_GRAPHIFY_VERSION,
      'python', '-c', READ_ONLY_DISPATCH, ...args],
    { cwd: snapshot.queryDirectory, env: graphQueryEnvironment(process.env, { production: snapshot.productionRuntime }),
      stdio: ['ignore', 'pipe', 'pipe', ...(snapshot.graphHandle ? [snapshot.graphHandle.fd] : [])] });
    const chunks = []; let bytes = 0, overflow = false;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_RESPONSE) { overflow = true; child.kill(); } else chunks.push(chunk); });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 120000); timer.unref();
    child.once('error', () => { clearTimeout(timer); reject(new SharedBrainError('query_unavailable', 'The server graph query runtime is unavailable.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (overflow || ![0, 3, 4].includes(code)) return reject(new SharedBrainError('query_failed', 'The shared graph query could not be completed.'));
      accept({ text: Buffer.concat(chunks).toString('utf8'), exitCode: code });
    });
  });
}

function warningsFor(provenance, index, request) {
  const warnings = [];
  for (const component of provenance.components) {
    if (component.coverage === 'partial') warnings.push({ code: 'partial_source_coverage', component: component.id ?? component.scope, gameId: component.gameId });
    if (component.mixedSources) warnings.push({ code: 'mixed_source_provenance', component: component.id ?? component.scope, gameId: component.gameId });
  }
  if (index?.knowledgeNeedingReview) warnings.push({ code: 'knowledge_needs_review', count: index.knowledgeNeedingReview });
  if (request.clientCommit) {
    const sourceCommits = provenance.components.filter(component => component.scope !== 'knowledge')
      .flatMap(component => [component.sourceCommit, ...component.sourceCommits]).filter(Boolean);
    if (!sourceCommits.length || sourceCommits.some(commit => commit !== request.clientCommit)) warnings.push({ code: 'local_checkout_differs_from_production', clientCommit: request.clientCommit });
  }
  return warnings;
}

function productionHeader(provenance) {
  const lines = ['Общий граф production: выпуск ' + provenance.releaseId + '.',
    'Runtime fingerprint: ' + provenance.runtimeFingerprint + '.',
    'Проверка опубликованной версии: ' + provenance.verifiedAt + '.',
    'Компоненты могут происходить из разных коммитов; идентификатор выпуска не является единым деревом Git.'];
  for (const component of provenance.components.filter(component => component.scope === 'knowledge')) {
    const commits = [component.sourceCommit, ...component.sourceCommits].filter(Boolean);
    lines.push('Источник знаний: ' + ([...new Set(commits)].join(', ') || 'происхождение указано в манифесте') + '.');
  }
  return lines.join('\n');
}

function boundedText(value) {
  const text = String(value ?? '').replaceAll('\u2014', '-');
  if (Buffer.byteLength(text) <= MAX_TEXT) return text;
  let result = Buffer.from(text).subarray(0, MAX_TEXT - 128).toString('utf8');
  if (result.endsWith('\ufffd')) result = result.slice(0, -1);
  return result + '\nРезультат сокращён. Уточни запрос.';
}

export async function handleSharedRequest(request, { storeRoot, runGraphify = runPinnedGraphify, verifyRuntime = verifyReceiptRuntime, productionRuntime = false } = {}) {
  let snapshot;
  try {
    validateSharedRequest(request);
    if (typeof storeRoot !== 'string' || !storeRoot) throw new SharedBrainError('graph_unavailable', 'The shared graph store is not configured.');
    const initialStatus = await readStatus(storeRoot);
    const expectedFingerprint = initialStatus.target?.runtimeFingerprint ?? initialStatus.provenance?.runtimeFingerprint;
    if (expectedFingerprint) {
      try {
        const result = await verifyRuntime(join(resolve(storeRoot), 'receipts', expectedFingerprint + '.json'), { runtimeFingerprint: expectedFingerprint });
        if ((typeof result === 'string' ? result : result?.runtimeFingerprint) !== expectedFingerprint) throw Error();
      } catch { throw new SharedBrainError('runtime_unverified', 'The shared graph cannot verify the current deployed program.', 4); }
    }
    if (request.operation === 'status') {
      const status = await readStatus(storeRoot);
      if (status.current !== initialStatus.current || status.target?.runtimeFingerprint !== initialStatus.target?.runtimeFingerprint
        || status.state !== initialStatus.state) throw new SharedBrainError('graph_changed', 'The production graph changed while the status was being checked. Retry the request.', 4);
      return { envelope: { schemaVersion: 1, ok: true, provenance: status.provenance ?? null,
        result: { state: status.state, current: status.current, previous: status.previous,
          desired: status.target ? { runtimeFingerprint: status.target.runtimeFingerprint, releaseId: status.target.releaseId } : null,
          text: 'Состояние общего production-графа: ' + status.state + '.' },
        warnings: status.state === 'ready' ? warningsFor(status.provenance, null, request) : [{ code: 'production_graph_' + status.state }] }, exitCode: 0 };
    }
    snapshot = await loadActiveSnapshot(storeRoot);
    const warnings = warningsFor(snapshot.provenance, snapshot.index, request);
    let text, exitCode;
    if (request.operation === 'brain') {
      const result = formatBrainQuery(snapshot.index, request.question);
      const separator = result.text.indexOf('\n\n');
      text = productionHeader(snapshot.provenance) + '\n\n' + (separator >= 0 ? result.text.slice(separator + 2) : result.text);
      exitCode = result.found ? 0 : 4;
    } else {
      // The Linux SSH reader keeps the verified inode open even if two later
      // publications retire this directory while Graphify is starting.
      const graphPath = snapshot.graphHandle ? (process.platform === 'linux'
        ? '/proc/' + process.pid + '/fd/' + snapshot.graphHandle.fd : '/dev/fd/3') : join(snapshot.directory, 'graph.json');
      const result = await runGraphify(graphArguments(request, graphPath), { ...snapshot, queryDirectory: resolve(storeRoot), productionRuntime });
      if (!result || ![0, 3, 4].includes(result.exitCode) || typeof result.text !== 'string') throw new SharedBrainError('query_failed', 'Invalid graph query response.');
      text = productionHeader(snapshot.provenance) + '\n\n' + result.text; exitCode = result.exitCode;
    }
    const finalStatus = await readStatus(storeRoot);
    if (finalStatus.state !== 'ready' || finalStatus.current !== snapshot.snapshotId
      || finalStatus.provenance.runtimeFingerprint !== snapshot.provenance.runtimeFingerprint) {
      throw new SharedBrainError('graph_changed', 'The production graph changed while the query was running. Retry the request.', 4);
    }
    const envelope = { schemaVersion: 1, ok: exitCode === 0, provenance: snapshot.provenance,
      result: { text: boundedText(text) }, warnings };
    if (exitCode) envelope.error = { code: exitCode === 3 ? 'ambiguous' : 'not_found', message: exitCode === 3 ? 'The graph subject is ambiguous.' : 'No matching graph subject was found.' };
    if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_RESPONSE) throw new SharedBrainError('query_failed', 'The shared graph response exceeds its bound.');
    return { envelope, exitCode };
  } catch (error) {
    const safe = error instanceof SharedBrainError ? error : new SharedBrainError('graph_unavailable', 'The production graph is unavailable or failed integrity verification.');
    return { envelope: { schemaVersion: 1, ok: false, provenance: null, result: { text: '', ...(safe.code === 'runtime_unverified' ? { state: 'unverified' } : {}) }, warnings: [],
      error: { code: safe.code, message: safe.message.replaceAll('\u2014', '-') } }, exitCode: safe.exitCode };
  } finally { await snapshot?.close(); }
}

async function main() {
  let bytes = 0, body = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { bytes += Buffer.byteLength(chunk); if (bytes > MAX_REQUEST) invalid('Shared graph request is too large.'); body += chunk; }
  let request;
  try { request = JSON.parse(body); } catch { invalid('Shared graph request is not valid JSON.'); }
  const response = await handleSharedRequest(request, { storeRoot: process.env.ROYAL_BRAIN_STORE || '/var/lib/royal-project-brain', productionRuntime: true });
  process.stdout.write(JSON.stringify(response.envelope) + '\n'); process.exitCode = response.exitCode;
}

const isMain = process.argv[1] && await realpath(resolve(process.argv[1])).then(path => pathToFileURL(path).href === import.meta.url).catch(() => false);
if (isMain) {
  main().catch(error => { const safe = error instanceof SharedBrainError ? error : new SharedBrainError('invalid_request', 'Invalid shared graph request.', 1);
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, provenance: null, result: { text: '' }, warnings: [], error: { code: safe.code, message: safe.message } }) + '\n'); process.exitCode = safe.exitCode; });
}
