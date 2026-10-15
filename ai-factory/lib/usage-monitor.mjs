import { randomUUID } from 'node:crypto';

const SAMPLE_KEY = '_codex_usage';
const REQUEST_KEY = '_codex_usage_request';
const MAX_AGE = 180000;
const unavailable = () => ({ status: 'unavailable', checked_at: null, limits: [], account_usage: null,
  error: 'Данные лимитов пока не получены.' });
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

async function readValue(store, key) {
  return (await store.pool.query(`SELECT value FROM ${store.table}.settings WHERE key=$1`, [key])).rows[0]?.value;
}
async function saveValue(store, key, value) {
  await store.pool.query(`INSERT INTO ${store.table}.settings(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`, [key, JSON.stringify(value)]);
}

export async function subscriptionUsage(store, now = Date.now()) {
  const saved = await readValue(store, SAMPLE_KEY);
  const value = saved && ['ready', 'unavailable'].includes(saved.status) ? saved : unavailable();
  const checked = validDate(value.checked_at) ? value.checked_at : null;
  const limits = Array.isArray(value.limits) ? value.limits : [];
  const resetPassed = limits.some(limit => Array.isArray(limit.windows) && limit.windows.some(window =>
    validDate(window.resets_at) && Date.parse(window.resets_at) <= now && (!checked || Date.parse(checked) < Date.parse(window.resets_at))));
  return { status: value.status, checked_at: checked, limits,
    account_usage: value.account_usage ?? null, error: value.error ?? null,
    last_attempt_at: validDate(value.last_attempt_at) ? value.last_attempt_at : null,
    stale: value.status !== 'ready' || !checked || now - Date.parse(checked) > MAX_AGE || Date.parse(checked) > now + 30000 || resetPassed };
}

export async function requestUsageRefresh(store, now = Date.now()) {
  const previous = await readValue(store, REQUEST_KEY);
  const elapsed = now - Date.parse(previous?.at);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 15000) return { requested: false, retry_after_seconds: Math.ceil((15000 - elapsed) / 1000) };
  await saveValue(store, REQUEST_KEY, { id: randomUUID(), at: new Date(now).toISOString() });
  return { requested: true };
}

export class UsageMonitor {
  constructor(store, { readUsage, now = Date.now, intervalMs = 60000 } = {}) {
    if (typeof readUsage !== 'function') throw new TypeError('A read-only usage source is required.');
    this.store = store; this.readUsage = readUsage; this.now = now; this.intervalMs = intervalMs;
    this.lastPoll = -Infinity; this.lastRead = -Infinity; this.requestId = null;
    this.authenticated = null; this.pending = null; this.stopped = false; this.controller = null;
  }
  poll({ authenticated = false } = {}) {
    if (this.stopped || this.pending) return this.pending || Promise.resolve();
    const changed = this.authenticated !== authenticated;
    this.authenticated = authenticated;
    if (!changed && this.now() - this.lastPoll < 10000) return Promise.resolve();
    this.lastPoll = this.now();
    const pending = this._poll(authenticated, changed).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }
  async _poll(authenticated, changed) {
    if (!authenticated) {
      if (changed) await saveValue(this.store, SAMPLE_KEY, { ...unavailable(), error: 'Для проверки лимитов подключи Codex по подписке.' });
      return;
    }
    const request = await readValue(this.store, REQUEST_KEY);
    const requested = typeof request?.id === 'string' && request.id !== this.requestId;
    const elapsed = this.now() - this.lastRead;
    if (!changed && elapsed < (requested ? 15000 : this.intervalMs)) return;
    this.lastRead = this.now(); this.requestId = request?.id || null;
    this.controller = new AbortController();
    let sample;
    try { sample = await this.readUsage({ signal: this.controller.signal }); }
    catch { sample = { ...unavailable(), checked_at: new Date(this.now()).toISOString(), error: 'Не удалось обновить лимиты Codex. Повторим проверку.' }; }
    finally { this.controller = null; }
    if (this.stopped) return;
    if (!sample || !['ready', 'unavailable'].includes(sample.status)) sample = unavailable();
    const previous = await readValue(this.store, SAMPLE_KEY);
    const successful = sample.status === 'ready';
    const keepPrevious = !successful && validDate(previous?.checked_at) && Array.isArray(previous?.limits);
    await saveValue(this.store, SAMPLE_KEY, {
      status: sample.status,
      checked_at: successful ? sample.checked_at : keepPrevious ? previous.checked_at : null,
      limits: successful ? sample.limits : keepPrevious ? previous.limits : [],
      account_usage: successful ? sample.account_usage : keepPrevious ? previous.account_usage ?? null : null,
      error: successful ? null : sample.error || 'Не удалось обновить лимиты Codex. Повторим проверку.',
      last_attempt_at: validDate(sample.checked_at) ? sample.checked_at : new Date(this.now()).toISOString(),
    });
  }
  async close() { this.stopped = true; this.controller?.abort(); await this.pending?.catch(() => {}); }
}
