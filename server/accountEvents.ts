import { normalizeAppearance } from '../src/shared/appearance';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Presence } from '@colyseus/core';

export type AccountEvent = 'logout' | 'name' | 'skin' | 'appearance' | 'security' | 'drinking';
export type AccountEventFailure = 'subscribe' | 'publish' | 'receive' | 'unsubscribe' | 'overflow';
type SharedPresence = Pick<Presence, 'subscribe' | 'unsubscribe' | 'publish'>;
type Envelope = { version: 1; origin: string; sequence: number; event: AccountEvent; args: unknown[] };
export type AccountEventsOptions = {
  resolveRemote?: (event: AccountEvent, args: readonly unknown[]) => Promise<readonly unknown[] | undefined>;
};
export type AccountEventsConnectionOptions = {
  topic?: string;
  onFailure?: (phase: AccountEventFailure) => void;
  operationTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxPendingEvents?: number;
};
const EVENTS = new Set<AccountEvent>(['logout', 'name', 'skin', 'appearance', 'security', 'drinking']);
const MAX_SEEN_KEYS = 4096;

function validArgs(event: AccountEvent, args: unknown): args is unknown[] {
  if (!Array.isArray(args) || typeof args[0] !== 'string' || !args[0] || args[0].length > 128) return false;
  if (event === 'logout') return args.length === 1 && /^[a-f0-9]{64}$/.test(args[0]);
  if (args.length !== 2) return false;
  const value = args[1];
  if (event === 'name') return typeof value === 'string' && value.length > 0 && value.length <= 128;
  if (event === 'appearance') return value === null || normalizeAppearance(value) !== null;
  if (event === 'skin') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  if (event === 'security') return (state.kind === 'warning' || state.kind === 'ejecting')
    && Number.isSafeInteger(state.until) && Number(state.until) > 0
    && (state.reason === undefined || ['spam', 'insult', 'collision'].includes(String(state.reason)));
  return Number.isSafeInteger(state.soberAt) && Number(state.soberAt) >= 0
    && Number.isSafeInteger(state.lastDrinkAt) && Number(state.lastDrinkAt) >= 0
    && typeof state.lastDrink === 'string' && state.lastDrink.length <= 128;
}

function positive(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(field + ' must be a positive safe integer');
  return value;
}

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Account event operation timed out')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export class AccountEvents extends EventEmitter {
  private origin = randomUUID();
  private sequence = 0;
  private presence?: SharedPresence;
  private topic = '';
  private startup = Promise.resolve();
  private outgoing = Promise.resolve();
  private incoming = Promise.resolve();
  private closing?: Promise<void>;
  private closed = false;
  private connected = false;
  private failed = false;
  private failures = 0;
  private pending = 0;
  private received = new Map<string, number>();
  private options: Required<Omit<AccountEventsConnectionOptions, 'onFailure' | 'topic'>> & Pick<AccountEventsConnectionOptions, 'onFailure'>
    = { operationTimeoutMs: 2000, closeTimeoutMs: 5000, maxPendingEvents: 1024 };
  private onMessage = (message: unknown) => this.receive(message);

  constructor(private resolver: AccountEventsOptions = {}) { super(); }
  get ready() { return this.startup; }

  connect(presence: SharedPresence, options: AccountEventsConnectionOptions = {}) {
    if (this.closing || this.closed) throw new Error('Account event bridge is closed');
    const topic = options.topic ?? 'royal:account-events:v1';
    if (!topic || topic.length > 200) throw new RangeError('Invalid account event topic');
    if (this.presence) {
      if (this.presence !== presence || this.topic !== topic) throw new Error('Account event bridge is already connected');
      return this.startup;
    }
    this.options = {
      onFailure: options.onFailure,
      operationTimeoutMs: positive(options.operationTimeoutMs ?? 2000, 'operationTimeoutMs'),
      closeTimeoutMs: positive(options.closeTimeoutMs ?? 5000, 'closeTimeoutMs'),
      maxPendingEvents: positive(options.maxPendingEvents ?? 1024, 'maxPendingEvents'),
    };
    this.presence = presence; this.topic = topic;
    const subscribe = Promise.resolve().then(() => presence.subscribe(topic, this.onMessage));
    // A subscription finishing after timeout/shutdown must not leave a listener behind.
    void subscribe.then(async () => {
      if (this.closing || this.failed) await bounded(Promise.resolve().then(() => presence.unsubscribe(topic, this.onMessage)), this.options.operationTimeoutMs);
    }).catch(() => { this.failure('subscribe'); });
    this.startup = bounded(subscribe, this.options.operationTimeoutMs).then(() => {
      if (!this.closing && !this.failed) this.connected = true;
    }).catch(() => { this.failure('subscribe'); throw new Error('Account event subscription unavailable'); });
    void this.startup.catch(() => {});
    return this.startup;
  }

  override emit(event: string | symbol, ...args: any[]) {
    if (typeof event === 'string' && EVENTS.has(event as AccountEvent) && this.presence && !this.closing && !this.failed) {
      if (validArgs(event as AccountEvent, args)) {
        // Queue before dispatching locally so recursive emits retain their order.
        // The Promise continuation cannot publish until synchronous local listeners finish.
        try { this.enqueue({ version: 1, origin: this.origin, sequence: ++this.sequence, event: event as AccountEvent, args: structuredClone(args) }); }
        catch { this.failure('publish'); }
      }
    }
    return super.emit(event, ...args);
  }

  private enqueue(message: Envelope) {
    if (this.pending >= this.options.maxPendingEvents) { this.failure('overflow'); return; }
    this.pending++;
    this.outgoing = this.outgoing.then(async () => {
      await this.startup;
      if (this.failed || this.closed) return;
      await bounded(Promise.resolve().then(() => this.presence!.publish(this.topic, message)), this.options.operationTimeoutMs);
    }).catch(() => { this.failure('publish'); }).finally(() => { this.pending--; });
  }

  private receive(value: unknown) {
    if (this.closing || this.failed || this.closed || !value || typeof value !== 'object') return;
    const message = value as Envelope;
    if (message.version !== 1 || message.origin === this.origin || typeof message.origin !== 'string' || !message.origin || message.origin.length > 128
      || !Number.isSafeInteger(message.sequence) || message.sequence <= 0 || !EVENTS.has(message.event) || !validArgs(message.event, message.args)) return;
    // Track each subject/event separately: a newer name must not suppress a delayed logout.
    const key = message.origin + '\0' + message.event + '\0' + message.args[0];
    if ((this.received.get(key) ?? 0) >= message.sequence) return;
    this.received.delete(key); this.received.set(key, message.sequence);
    if (this.received.size > MAX_SEEN_KEYS) this.received.delete(this.received.keys().next().value!);
    if (this.pending >= this.options.maxPendingEvents) { this.failure('overflow'); return; }
    this.pending++;
    let copy: Envelope;
    try { copy = structuredClone(message); }
    catch { this.pending--; this.failure('receive'); return; }
    this.incoming = this.incoming.then(async () => {
      if (this.failed || this.closed) return;
      const args = this.resolver.resolveRemote
        ? await bounded(Promise.resolve().then(() => this.resolver.resolveRemote!(copy.event, copy.args)), this.options.operationTimeoutMs)
        : copy.args;
      if (!this.failed && !this.closed && args && validArgs(copy.event, args)) super.emit(copy.event, ...args);
    }).catch(() => { this.failure('receive'); }).finally(() => { this.pending--; });
  }

  private failure(phase: AccountEventFailure) {
    this.failures++;
    if (this.failed) return;
    this.failed = true; this.connected = false;
    // Even a reporting callback must not interrupt synchronous local room events.
    queueMicrotask(() => {
      try { this.options.onFailure?.(phase); } catch { /* Failure reporting must not reject delivery tasks. */ }
    });
  }

  health() { return { connected: this.connected, failed: this.failed, closed: this.closed, pendingEvents: this.pending, deliveryFailures: this.failures }; }

  close() {
    if (this.closing) return this.closing;
    this.connected = false;
    this.closing = Promise.resolve().then(async () => {
      await this.startup.catch(() => {});
      try { await bounded(Promise.all([this.outgoing, this.incoming]), this.options.closeTimeoutMs); }
      catch { this.failure('publish'); }
      this.closed = true; this.connected = false;
      if (this.presence) {
        try { await bounded(Promise.resolve().then(() => this.presence!.unsubscribe(this.topic, this.onMessage)), this.options.operationTimeoutMs); }
        catch { this.failure('unsubscribe'); }
      }
      this.received.clear();
    });
    return this.closing;
  }
}
