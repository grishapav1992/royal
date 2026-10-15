import { spawn as nodeSpawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { sanitizedEnv } from './codex.mjs';

const MAX_BYTES = 1024 * 1024;
const MAX_LINE_BYTES = 128 * 1024;
const MAX_MESSAGES = 512;
const PLAN_TYPES = new Set(['free', 'go', 'plus', 'pro', 'prolite', 'promax', 'team',
  'self_serve_business_prolite', 'self_serve_business_usage_based', 'business', 'ent26',
  'enterprise_cbp_automation', 'enterprise_cbp_usage_based', 'enterprise', 'edu', 'edu_plus', 'edu_pro', 'unknown']);
const UNAVAILABLE = 'Не удалось прочитать лимиты подписки Codex.';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new Error('invalid_usage'); };
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const sensitive = value => /\b(?:sk-[\w-]{8,}|Bearer\s|eyJ[\w-]+\.[\w-]+\.|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:])|@|:\/\//i.test(value);

function idValue(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(value) || sensitive(value)) invalid();
  return value;
}

function displayName(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > 120 || sensitive(value)) return fallback;
  const name = value.replace(/\u2014/g, '-').trim();
  return /^[\p{L}\p{N} ._:+()/\-]{1,120}$/u.test(name) ? name : fallback;
}

function windowValue(value, kind) {
  if (value == null) return null;
  if (!object(value) || !Number.isInteger(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 2_147_483_647) invalid();
  if (value.windowDurationMins != null && (!safeInteger(value.windowDurationMins) || value.windowDurationMins === 0
    || value.windowDurationMins > 10 * 365 * 24 * 60)) invalid();
  if (value.resetsAt != null && (!safeInteger(value.resetsAt) || value.resetsAt > 253402300799)) invalid();
  return { kind, used_percent: value.usedPercent, remaining_percent: Math.min(100, Math.max(0, 100 - value.usedPercent)),
    window_minutes: value.windowDurationMins ?? null,
    resets_at: value.resetsAt == null ? null : new Date(value.resetsAt * 1000).toISOString() };
}

function normalizeLimits(result) {
  if (!object(result)) invalid();
  let entries;
  if (result.rateLimitsByLimitId != null) {
    if (!object(result.rateLimitsByLimitId)) invalid();
    entries = Object.entries(result.rateLimitsByLimitId);
  }
  if (!entries?.length && result.rateLimits != null) {
    if (!object(result.rateLimits)) invalid();
    entries = [[result.rateLimits.limitId ?? 'codex', result.rateLimits]];
  }
  if (!entries?.length || entries.length > 32) invalid();
  const seen = new Set();
  return entries.map(([key, value]) => {
    if (!object(value)) invalid();
    const id = idValue(value.limitId ?? key);
    if (seen.has(id)) invalid();
    seen.add(id);
    const windows = ['primary', 'secondary'].map(kind => windowValue(value[kind], kind)).filter(Boolean);
    return { id, name: displayName(value.limitName, id),
      plan_type: PLAN_TYPES.has(value.planType) ? value.planType : null, windows };
  });
}

function normalizeAccountUsage(result) {
  if (!object(result) || !object(result.summary)) invalid();
  const lifetime = result.summary.lifetimeTokens ?? null;
  if (lifetime !== null && !safeInteger(lifetime)) invalid();
  const buckets = result.dailyUsageBuckets ?? [];
  if (!Array.isArray(buckets) || buckets.length > 3660) invalid();
  const dates = new Set();
  const daily = buckets.map(value => {
    if (!object(value) || typeof value.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)
      || !safeInteger(value.tokens)) invalid();
    const parsed = new Date(`${value.startDate}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.startDate || dates.has(value.startDate)) invalid();
    dates.add(value.startDate);
    return { date: value.startDate, tokens: value.tokens };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return lifetime === null && !daily.length ? null : { lifetime_tokens: lifetime, daily_tokens: daily };
}

/** Read-only subscription telemetry. Never starts a thread, turn, login, purchase or limit reset. */
export async function readCodexUsage({ binary = 'codex', spawn = nodeSpawn, env = process.env,
  timeoutMs = 12_000, signal } = {}) {
  let child;
  let closed = false;
  let finished = false;
  let fatal = null;
  let timer;
  let requestId = 0;
  let bytes = 0;
  let messages = 0;
  let buffer = '';
  let limits = [];
  let accountUsage = null;
  const pending = new Map();
  const stop = code => {
    fatal ??= new Error(code);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(fatal); }
    pending.clear();
  };
  const cancel = () => stop('cancelled');
  const write = message => {
    if (closed || fatal || !child?.stdin?.writable) throw new Error('unavailable');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params, budget) => new Promise((resolve, reject) => {
    if (fatal || closed) { reject(fatal ?? new Error('unavailable')); return; }
    const id = ++requestId;
    const waiter = { resolve, reject, timer: setTimeout(() => {
      pending.delete(id);
      reject(new Error('request_timeout'));
    }, budget) };
    pending.set(id, waiter);
    try { write({ id, method, params }); }
    catch { clearTimeout(waiter.timer); pending.delete(id); reject(new Error('unavailable')); }
  });
  const terminate = sig => {
    if (!child) return;
    if (process.platform !== 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
      try { process.kill(-child.pid, sig); return; } catch { /* A child implementation may not create a process group. */ }
    }
    if (!closed) { try { child.kill(sig); } catch { /* Already exited. */ } }
  };
  try {
    if (typeof binary !== 'string' || !binary || /[\r\n\0]/.test(binary)
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000 || typeof spawn !== 'function') invalid();
    if (signal?.aborted) throw new Error('cancelled');
    child = spawn(binary, ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
      '-c', 'analytics.enabled=false', 'app-server', '--stdio'], {
      cwd: tmpdir(), env: sanitizedEnv(env), shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', () => stop('unavailable'));
    child.on('close', () => { closed = true; if (!finished) stop('closed'); });
    child.stdin?.on('error', () => stop('unavailable'));
    if (!child.stdin || !child.stdout || !child.stderr) throw new Error('unavailable');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (finished || fatal) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) { stop('output_limit'); return; }
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0 && !fatal) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > MAX_LINE_BYTES || ++messages > MAX_MESSAGES) { stop('output_limit'); return; }
        let message;
        try { message = JSON.parse(line); } catch { stop('invalid_protocol'); return; }
        if (!object(message) || (message.jsonrpc != null && message.jsonrpc !== '2.0')) { stop('invalid_protocol'); return; }
        if (typeof message.method === 'string') {
          // Notifications are deliberately ignored; sparse updates must not replace a fresh read.
          if (message.id != null) { stop('unexpected_request'); return; }
          continue;
        }
        if (!Number.isSafeInteger(message.id) || !pending.has(message.id)
          || (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error'))) { stop('invalid_protocol'); return; }
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (Object.hasOwn(message, 'error')) waiter.reject(new Error('rpc_error'));
        else waiter.resolve(message.result);
      }
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) stop('output_limit');
    });
    // Drain diagnostics without retaining or exposing authentication and account details.
    child.stderr.on('data', chunk => {
      if (finished || fatal) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) stop('output_limit');
    });
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const started = Date.now();
    const budget = () => Math.max(1, timeoutMs - (Date.now() - started));
    const initialized = await request('initialize', {
      clientInfo: { name: 'royal_usage_monitor', title: 'Royal usage monitor', version: '1.0.0' },
      capabilities: { experimentalApi: true, explicitGatewayOauth: true },
    }, budget());
    if (!object(initialized)) invalid();
    write({ method: 'initialized', params: {} });
    limits = normalizeLimits(await request('account/rateLimits/read', {
      excludeResetCreditDetails: true, supportsLunaReserve: false,
    }, budget()));
    try {
      accountUsage = normalizeAccountUsage(await request('account/usage/read', {}, Math.min(2500, budget())));
    } catch { /* Older CLI versions and unavailable token statistics do not invalidate the limits read. */ }
    if (fatal && !['closed', 'timeout'].includes(fatal.message)) throw fatal;
    return { status: 'ready', checked_at: new Date().toISOString(), limits,
      account_usage: accountUsage, error: null };
  } catch {
    return { status: 'unavailable', checked_at: new Date().toISOString(), limits: [], account_usage: null, error: UNAVAILABLE };
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('closed')); }
    pending.clear();
    if (child) {
      try { child.stdin?.end(); } catch { /* Closing a broken pipe is harmless. */ }
      terminate('SIGTERM');
      if (!closed) await new Promise(resolve => {
        const cleanupTimer = setTimeout(() => { terminate('SIGKILL'); resolve(); }, 200);
        child.once('close', () => { clearTimeout(cleanupTimer); resolve(); });
      });
      // Kill remaining detached descendants after the parent exits, including helpers that ignore SIGTERM.
      if (closed && process.platform !== 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The whole group has already exited. */ }
      }
    }
  }
}
