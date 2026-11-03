import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, writeFile, mkdir, open, rename, rm, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, extname, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { git } from './sync-work.mjs';
import { BRAIN_SCHEMA, knowledgeSeed, mathPolicy, collectBrain, formatBrainQuery, brainReport } from './project-brain.mjs';

export const GRAPHIFY_VERSION = '0.9.101';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.sh', '.md', '.yaml', '.yml']);
const excluded = /(^|\/)(?:node_modules|artifacts|data|dist(?:-[^/]*)?|module-dist|module-build|\.git|\.venv|\.state|secrets?|credentials?|__pycache__)(\/|$)/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const clean = value => value.replaceAll('\u2014', '-');

export function inputKind(path) {
  if (excluded.test(path) || /(^|\/)\.env(?:\.|$)/i.test(path)
    || path.startsWith('deployment/releases/') || path.startsWith('public/assets/')
    || path.startsWith('ai-factory/project-knowledge/references/')) return null;
  if (extensions.has(extname(path))) return 'source';
  if (path === 'deployment/finance/haproxy.cfg') return 'config';
  if (extname(path) === '.json' && /^(?:src|server|docs\/game-math|deployment\/qualifications)\//.test(path)) return 'config';
  if ([knowledgeSeed, mathPolicy].includes(path) || /^docs\/game-math\/qualifications\/[^/]+\.json$/.test(path)) return 'config';
  if (basename(path) === 'package.json' || /^tsconfig[^/]*\.json$/.test(basename(path))) return 'config';
  return null;
}

export async function inventory(directory) {
  const paths = [...new Set((await git(directory, ['ls-files', '-z', '--cached'])).split('\0').filter(Boolean))].sort();
  const inputs = [], sources = [];
  const anchor = await realpath(directory);
  for (const path of paths) {
    const kind = inputKind(path);
    if (!kind) continue;
    const full = resolve(directory, path);
    let info;
    try { info = await lstat(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!info.isFile()) continue;
    const local = relative(anchor, await realpath(full));
    if (local === '..' || local.startsWith('..' + sep) || resolve(anchor, local) !== full) {
      throw Error('Graph input must be a regular file inside this checkout: ' + path);
    }
    inputs.push({ path, sha256: digest(await readFile(full)) });
    if (kind === 'source') sources.push(path);
  }
  return { sources, inputs, sourceHash: digest(JSON.stringify({ version: GRAPHIFY_VERSION, inputs })) };
}

export function localEnvironment(environment, output) {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'SYSTEMROOT', 'WINDIR',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR'];
  return { ...Object.fromEntries(allowed.filter(key => environment[key]).map(key => [key, environment[key]])),
    GRAPHIFY_BACKEND: 'none', GRAPHIFY_NO_AUTO_REFRESH: '1', GRAPHIFY_QUERY_LOG_DISABLE: '1',
    GRAPHIFY_NO_TIPS: '1', GRAPHIFY_OUT: output, UV_NO_ENV_FILE: '1', PYTHONUTF8: '1' };
}

async function runUv(directory, args, input) {
  return new Promise((accept, reject) => {
    const child = spawn('uv', ['tool', 'run', '--python', '3.12', '--from', 'graphifyy==' + GRAPHIFY_VERSION, ...args],
      { cwd: directory, env: localEnvironment(process.env, resolve(directory, 'graphify-out')), stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => process.stdout.write(clean(chunk)));
    child.stderr.on('data', chunk => process.stderr.write(clean(chunk)));
    child.on('error', error => reject(error.code === 'ENOENT' ? Error('Install uv, then rerun this command. See docs/graphify.md.') : error));
    child.on('close', code => accept(code ?? 1));
    child.stdin.on('error', () => {});
    child.stdin.end(input ? JSON.stringify(input) : '');
  });
}

export async function status(directory, current = null) {
  const input = current ?? await inventory(directory);
  const output = resolve(directory, 'graphify-out');
  let manifest;
  try { manifest = JSON.parse(await readFile(resolve(output, 'royal-manifest.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return { state: 'missing', files: input.sources.length }; throw error; }
  if (manifest?.schemaVersion !== 1 || manifest.graphifyVersion !== GRAPHIFY_VERSION || manifest.brainSchema !== BRAIN_SCHEMA
    || !['commit', 'sourceHash', 'graphHash', 'brainHash'].every(key => typeof manifest[key] === 'string')) {
    return { state: 'stale', files: input.sources.length };
  }
  let graphHash;
  try { graphHash = digest(await readFile(resolve(output, 'graph.json'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let brainHash;
  try { brainHash = digest(await readFile(resolve(output, 'project-brain.json'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const commit = await git(directory, ['rev-parse', 'HEAD']);
  const fresh = manifest.sourceHash === input.sourceHash && manifest.commit === commit && manifest.graphHash === graphHash && manifest.brainHash === brainHash;
  return { state: fresh ? 'current' : 'stale', files: input.sources.length,
    commit: manifest.commit, builtAt: manifest.builtAt, nodes: manifest.nodes, edges: manifest.edges,
    brain: manifest.brain, knowledgeNeedingReview: manifest.knowledgeNeedingReview };
}

async function build(directory) {
  const output = resolve(directory, 'graphify-out');
  await mkdir(output, { recursive: true });
  const lockPath = resolve(output, 'build.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw Error('Graph build is locked. Check the PID in graphify-out/build.lock before removing an abandoned lock.'); throw error; }
  const pending = ['graph.next.json', 'GRAPH_REPORT.next.md', 'royal-manifest.next.json', 'project-brain.next.json', 'PROJECT_BRAIN.next.md'];
  try {
    await lock.writeFile(String(process.pid));
    const input = await inventory(directory);
    const commit = await git(directory, ['rev-parse', 'HEAD']);
    const started = Date.now();
    const brain = await collectBrain(directory, input, { commit, tree: await git(directory, ['rev-parse', 'HEAD^{tree}']),
      workingTreeModified: Boolean(await git(directory, ['status', '--porcelain', '--untracked-files=no'])) });
    const brainBody = clean(JSON.stringify(brain.index, null, 2)) + '\n';
    const code = await runUv(directory, ['python', resolve(directory, 'scripts/graphify-build.py')],
      { ...input, commit, brain: { nodes: brain.nodes, edges: brain.edges, fileLinks: brain.fileLinks } });
    if (code) throw Error('Graphify build failed. The previous graph was preserved.');
    const after = await inventory(directory);
    if (after.sourceHash !== input.sourceHash || await git(directory, ['rev-parse', 'HEAD']) !== commit) {
      throw Error('Sources changed during indexing. Rerun graph:build. The previous graph was preserved.');
    }
    const graph = await readFile(resolve(output, 'graph.next.json'));
    const data = JSON.parse(graph);
    const manifest = { schemaVersion: 1, graphifyVersion: GRAPHIFY_VERSION, commit, sourceHash: input.sourceHash,
      graphHash: digest(graph), builtAt: new Date().toISOString(), durationMs: Date.now() - started,
      files: input.sources.length, nodes: data.nodes.length, edges: (data.links ?? data.edges).length, inputs: input.inputs,
      brainSchema: BRAIN_SCHEMA, brainHash: digest(brainBody), brain: brain.index.counts, knowledgeNeedingReview: brain.index.knowledgeNeedingReview };
    await writeFile(resolve(output, 'project-brain.next.json'), brainBody);
    await writeFile(resolve(output, 'PROJECT_BRAIN.next.md'), brainReport(brain.index));
    const next = await open(resolve(output, 'royal-manifest.next.json'), 'w');
    try { await next.writeFile(JSON.stringify(manifest, null, 2) + '\n'); } finally { await next.close(); }
    await rename(resolve(output, 'graph.next.json'), resolve(output, 'graph.json'));
    await rename(resolve(output, 'GRAPH_REPORT.next.md'), resolve(output, 'GRAPH_REPORT.md'));
    await rename(resolve(output, 'project-brain.next.json'), resolve(output, 'project-brain.json'));
    await rename(resolve(output, 'PROJECT_BRAIN.next.md'), resolve(output, 'PROJECT_BRAIN.md'));
    await rename(resolve(output, 'royal-manifest.next.json'), resolve(output, 'royal-manifest.json'));
    console.log(JSON.stringify({ state: 'current', files: manifest.files, nodes: manifest.nodes,
      edges: manifest.edges, durationMs: manifest.durationMs, commit, brain: manifest.brain, knowledgeNeedingReview: manifest.knowledgeNeedingReview }));
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    for (const name of pending) await rm(resolve(output, name), { force: true });
  }
}

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  if (command === 'build') return build(root);
  if (command === 'status') {
    const result = await status(root); console.log(JSON.stringify(result, null, 2));
    if (result.state !== 'current') process.exitCode = 1;
    return;
  }
  if (command === 'brain') {
    if (!args.length) throw Error('Supply a project topic or game ID. See docs/project-brain.md.');
    if ((await status(root)).state !== 'current') await build(root);
    const index = JSON.parse(await readFile(resolve(root, 'graphify-out/project-brain.json'), 'utf8'));
    const result = formatBrainQuery(index, args.join(' '));
    console.log(result.text);
    if (!result.found) process.exitCode = 4;
    return;
  }
  if (!['query', 'explain', 'path', 'affected', 'god-nodes'].includes(command)
    || args.some(arg => arg === '--graph' || arg.startsWith('--graph='))) {
    throw Error('Use build, status, brain, query, explain, path, affected or god-nodes. See docs/graphify.md.');
  }
  if (!args.length && command !== 'god-nodes') throw Error('Supply a question, symbol or path. See docs/graphify.md.');
  if ((await status(root)).state !== 'current') await build(root);
  process.exitCode = await runUv(root, ['python', '-c',
    'import sys; from graphify.cli import dispatch_command; dispatch_command(sys.argv[1])', command, ...args,
    '--graph', resolve(root, 'graphify-out/graph.json')]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(clean(error.message)); process.exitCode = 1; });
}
