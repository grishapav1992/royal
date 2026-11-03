import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SHARED_BRAIN_COMMAND = '/opt/royal-project-brain/runtime/bin/node /opt/royal-project-brain/current/scripts/shared-brain-reader.mjs';
export const MAX_SHARED_REQUEST = 16 * 1024;
export const MAX_SHARED_RESPONSE = 256 * 1024;
const operations = new Set(['status', 'brain', 'query', 'explain', 'path', 'affected', 'god-nodes']);
const fields = {
  status: [], brain: ['question'], query: ['question', 'budget'], explain: ['subject'],
  path: ['source', 'target', 'directed'], affected: ['subject', 'depth', 'relations'], 'god-nodes': ['top'],
};
const clean = value => String(value).replaceAll('\u2014', '-');
const fail = (code, message) => Object.assign(new Error(message), { code });
const invalid = () => fail('invalid_request', 'Invalid shared graph request. See docs/project-brain.md.');

function textKey(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.trimStart().startsWith('-')
    && Buffer.byteLength(value, 'utf8') <= 2048 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.schemaVersion !== 1
    || !operations.has(request.operation)) throw invalid();
  const allowed = new Set(['schemaVersion', 'operation', 'clientCommit', ...fields[request.operation]]);
  if (Object.keys(request).some(key => !allowed.has(key))
    || request.clientCommit !== undefined && (typeof request.clientCommit !== 'string' || !/^[a-f0-9]{40}$/.test(request.clientCommit))) throw invalid();
  for (const key of ['question', 'subject', 'source', 'target']) {
    if (request[key] !== undefined && !textKey(request[key])) throw invalid();
  }
  const required = { brain: ['question'], query: ['question'], explain: ['subject'], path: ['source', 'target'], affected: ['subject'] };
  if ((required[request.operation] ?? []).some(key => request[key] === undefined)
    || request.budget !== undefined && !integer(request.budget, 128, 4000)
    || request.depth !== undefined && !integer(request.depth, 1, 5)
    || request.top !== undefined && !integer(request.top, 1, 50)
    || request.directed !== undefined && typeof request.directed !== 'boolean'
    || request.relations !== undefined && (!Array.isArray(request.relations) || request.relations.length < 1
      || request.relations.length > 10 || request.relations.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)))) throw invalid();
  const body = Buffer.from(JSON.stringify(request) + '\n');
  if (body.length > MAX_SHARED_REQUEST) throw invalid();
  return body;
}

/** Map only supported read operations to the shared protocol. */
export function parseSharedCommand(command, args, clientCommit) {
  if (!operations.has(command) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw invalid();
  const request = { schemaVersion: 1, operation: command, ...(clientCommit ? { clientCommit } : {}) };
  const positional = [], seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    const equal = arg.indexOf('=');
    const flag = equal < 0 ? arg : arg.slice(0, equal);
    let value = equal < 0 ? undefined : arg.slice(equal + 1);
    if (command === 'path' && ['--directed', '--undirected'].includes(flag) && value === undefined) {
      if (seen.has('directed')) throw invalid();
      seen.add('directed'); request.directed = flag === '--directed'; continue;
    }
    const key = ({ '--budget': 'budget', '--depth': 'depth', '--relation': 'relations', '--top': 'top' })[flag];
    if (!key || !fields[command].includes(key) || key !== 'relations' && seen.has(key)) throw invalid();
    if (value === undefined) value = args[++index];
    if (typeof value !== 'string' || !value || value.startsWith('-')) throw invalid();
    if (key === 'relations') { request.relations ??= []; request.relations.push(value); }
    else { if (!/^\d+$/.test(value)) throw invalid(); request[key] = Number(value); seen.add(key); }
  }
  if (command === 'brain' || command === 'query') request.question = positional.join(' ');
  else if (command === 'explain' || command === 'affected') {
    if (positional.length !== 1) throw invalid(); request.subject = positional[0];
  } else if (command === 'path') {
    if (positional.length !== 2) throw invalid(); [request.source, request.target] = positional;
  } else if (positional.length) throw invalid();
  validateRequest(request);
  return request;
}

function transportEnvironment(environment) {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'SYSTEMROOT',
    'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID'];
  return Object.fromEntries(allowed.filter(key => typeof environment[key] === 'string').map(key => [key, environment[key]]));
}

function validateResponse(envelope, operation) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.schemaVersion !== 1
    || typeof envelope.ok !== 'boolean' || !envelope.result || typeof envelope.result.text !== 'string'
    || !Array.isArray(envelope.warnings) || envelope.warnings.length > 100
    || envelope.warnings.some(value => !value || typeof value !== 'object' || typeof value.code !== 'string'
      || value.code.length > 128 || value.message !== undefined && (typeof value.message !== 'string' || Buffer.byteLength(value.message) > 4096))) {
    throw fail('invalid_response', 'The shared graph server returned an invalid response.');
  }
  const proof = envelope.provenance;
  if (proof !== null && proof !== undefined) {
    if (typeof proof !== 'object' || proof.scope !== 'production' || !/^[a-f0-9]{64}$/.test(proof.snapshotId)
      || !/^[a-f0-9]{64}$/.test(proof.runtimeFingerprint) || typeof proof.releaseId !== 'string'
      || !proof.releaseId || proof.releaseId.length > 240 || typeof proof.verifiedAt !== 'string'
      || !Number.isFinite(Date.parse(proof.verifiedAt)) || !Array.isArray(proof.components) || proof.components.length > 1024) {
      throw fail('invalid_response', 'The shared graph server returned invalid production provenance.');
    }
  } else if (envelope.ok && operation !== 'status') {
    throw fail('invalid_response', 'The shared graph response has no production snapshot identity.');
  }
  if (!envelope.ok && (!envelope.error || typeof envelope.error.code !== 'string'
    || typeof envelope.error.message !== 'string')) throw fail('invalid_response', 'The shared graph server returned an invalid error.');
  return envelope;
}

/** Send JSON through a fixed SSH command. No local graph is used after an error. */
export async function requestSharedBrain(request, { spawnImpl = spawn, env = process.env, timeoutMs = 480000 } = {}) {
  const body = validateRequest(request);
  const target = env.ROYAL_BRAIN_SSH_TARGET || 'root@45.192.12.242';
  const identity = env.ROYAL_BRAIN_SSH_KEY || join(homedir(), '.ssh', 'royal_server_ed25519');
  if (typeof target !== 'string' || !/^[a-zA-Z0-9_.@-]{1,255}$/.test(target) || target.startsWith('-')
    || typeof identity !== 'string' || !identity || /[\u0000\r\n]/u.test(identity)) throw invalid();
  const args = ['-T', '-i', identity, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', target, SHARED_BRAIN_COMMAND];
  return new Promise((accept, reject) => {
    let child, settled = false, timer, size = 0;
    const chunks = [];
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else accept(result);
    };
    const unavailable = () => fail('shared_graph_unavailable', 'Shared graph unavailable. Check SSH access and the installed server. No local fallback was used.');
    try { child = spawnImpl('ssh', args, { env: transportEnvironment(env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch { finish(unavailable()); return; }
    timer = setTimeout(() => { child.kill(); finish(fail('shared_graph_timeout', 'The shared graph request timed out. No local fallback was used.')); }, timeoutMs);
    timer.unref?.();
    child.on('error', () => finish(unavailable()));
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_SHARED_RESPONSE) {
        child.kill(); finish(fail('response_too_large', 'The shared graph response exceeded its size limit.')); return;
      }
      chunks.push(bytes);
    });
    child.on('close', code => {
      if (settled) return;
      if (![0, 1, 2, 3, 4].includes(code) || size === 0) { finish(unavailable()); return; }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const envelope = validateResponse(JSON.parse(text), request.operation);
        if (envelope.ok && code !== 0) throw unavailable();
        finish(null, { envelope, exitCode: envelope.ok ? 0 : code || 1 });
      } catch (error) {
        finish(['invalid_response', 'shared_graph_unavailable'].includes(error?.code) ? error
          : fail('invalid_response', 'The shared graph server returned an invalid response.'));
      }
    });
    child.stdin.end(body);
  });
}

export function formatSharedResponse(envelope, clientCommit) {
  const proof = envelope.provenance;
  const lines = [proof ? 'Общий серверный граф: выпуск ' + proof.releaseId + '.' : 'Общий серверный граф.'];
  if (proof) lines.push('Снимок: ' + proof.snapshotId + '. Runtime: ' + proof.runtimeFingerprint + '.', 'Подтверждение: ' + proof.verifiedAt + '.');
  if (clientCommit) lines.push('Рабочий коммит этого ПК: ' + clientCommit + '.');
  const groups = new Map();
  for (const warning of envelope.warnings ?? []) {
    const key = warning.code + ':' + (warning.message ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(warning);
  }
  const labels = { partial_source_coverage: 'Частичное покрытие исходников', mixed_source_provenance: 'Несколько исходных версий',
    knowledge_needs_review: 'Записи знаний требуют пересмотра', local_checkout_differs_from_production: 'Рабочая копия отличается от опубликованной версии' };
  for (const group of groups.values()) {
    const warning = group[0];
    const label = warning.message || (labels[warning.code] ? labels[warning.code] + ' [' + warning.code + ']' : warning.code);
    const count = group.length > 1 ? ' (' + group.length + ' компонентов)' : warning.count ? ' (' + warning.count + ')' : '';
    const examples = group.map(item => item.component).filter(Boolean).slice(0, 3);
    lines.push('Предупреждение: ' + label + count + (examples.length ? ': ' + examples.join(', ') + (group.length > examples.length ? ', ...' : '') : ''));
  }
  if (!envelope.ok) lines.push('Ошибка: ' + envelope.error.message);
  if (envelope.result.text) lines.push('', envelope.result.text);
  return clean(lines.join('\n'));
}
