import { DEFAULT_APPEARANCE } from '../src/shared/appearance';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountEvents, type AccountEvent, type AccountEventFailure } from '../server/accountEvents';

class SharedPresence {
  listeners = new Map<string, Set<Function>>();
  messages: { topic: string; value: any }[] = [];
  autoDeliver = true;
  failPublish = false;
  failUnsubscribe = false;
  publishGate?: Promise<void>;
  subscribeGate?: Promise<void>;
  async subscribe(topic: string, callback: Function) {
    if (this.subscribeGate) await this.subscribeGate;
    let listeners = this.listeners.get(topic);
    if (!listeners) this.listeners.set(topic, listeners = new Set());
    listeners.add(callback); return this;
  }
  async unsubscribe(topic: string, callback?: Function) {
    if (this.failUnsubscribe) throw new Error('unsubscribe unavailable');
    if (callback) this.listeners.get(topic)?.delete(callback); else this.listeners.delete(topic);
    return this;
  }
  async publish(topic: string, value: unknown) {
    if (this.publishGate) await this.publishGate;
    if (this.failPublish) throw new Error('publish unavailable');
    this.messages.push({ topic, value: structuredClone(value) });
    if (this.autoDeliver) this.deliver(topic, value);
  }
  deliver(topic: string, value: unknown) {
    for (const listener of this.listeners.get(topic) ?? []) listener(structuredClone(value));
  }
}
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const hash = 'a'.repeat(64);

test('account events remain synchronous locally and reach another process once without echo loops', async () => {
  const presence = new SharedPresence(), sender = new AccountEvents(), receiver = new AccountEvents();
  const local: unknown[][] = [], remote: unknown[][] = [];
  const events: [AccountEvent, ...unknown[]][] = [
    ['logout', hash], ['name', 'account', 'Новое имя'], ['skin', 'account', 4], ['appearance', 'account', { ...DEFAULT_APPEARANCE, body: 2 }], ['appearance', 'account', null],
    ['security', 'account', { kind: 'ejecting', until: Date.now() + 60000, reason: 'spam' }],
    ['drinking', 'account', { soberAt: Date.now() + 60000, lastDrinkAt: Date.now(), lastDrink: 'lemonade' }],
  ];
  for (const event of new Set(events.map(([event]) => event))) {
    sender.on(event, (...args) => local.push([event, ...args]));
    receiver.on(event, (...args) => remote.push([event, ...args]));
  }
  await Promise.all([sender.connect(presence), receiver.connect(presence)]);
  try {
    for (const [event, ...args] of events) assert.equal(sender.emit(event, ...args), true);
    assert.deepEqual(local, events);
    assert.equal(presence.messages.length, 0);
    await flush();
    assert.deepEqual(remote, events);
    assert.deepEqual(local, events);
    assert.equal(presence.messages.length, events.length);
    assert.equal(receiver.listenerCount('name'), 1);
    const listener = () => {};
    receiver.on('name', listener); receiver.off('name', listener);
    assert.equal(receiver.listenerCount('name'), 1);
    sender.emit('unrelated', 'local-only'); await flush();
    assert.equal(presence.messages.length, events.length);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test('duplicate and reordered messages cannot roll back a subject, or suppress a delayed logout', async () => {
  const presence = new SharedPresence(); presence.autoDeliver = false;
  const sender = new AccountEvents(), receiver = new AccountEvents(), names: string[] = [], logouts: string[] = [];
  receiver.on('name', (_id, name) => names.push(name)); receiver.on('logout', value => logouts.push(value));
  await Promise.all([sender.connect(presence), receiver.connect(presence)]);
  try {
    sender.emit('name', 'account', 'old'); sender.emit('logout', hash); sender.emit('name', 'account', 'new');
    await flush();
    const [old, logout, latest] = presence.messages;
    presence.deliver(latest.topic, latest.value); presence.deliver(latest.topic, latest.value);
    presence.deliver(old.topic, old.value); presence.deliver(logout.topic, logout.value);
    await flush();
    assert.deepEqual(names, ['new']); assert.deepEqual(logouts, [hash]);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test('publications retain order when the first publish is delayed and local listeners recurse', async () => {
  const presence = new SharedPresence(), gate = deferred(); presence.publishGate = gate.promise;
  const sender = new AccountEvents(), receiver = new AccountEvents(), values: string[] = [];
  receiver.on('name', (_id, name) => values.push(name));
  sender.on('name', (_id, name) => { if (name === 'first') sender.emit('name', 'account', 'second'); });
  await Promise.all([sender.connect(presence), receiver.connect(presence)]);
  try {
    sender.emit('name', 'account', 'first'); await flush();
    assert.equal(presence.messages.length, 0);
    gate.resolve(); await flush();
    assert.deepEqual(values, ['first', 'second']);
    assert.deepEqual(presence.messages.map(message => message.value.sequence), [1, 2]);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test('authoritative remote resolution prevents old events from another process overwriting current state', async () => {
  const presence = new SharedPresence(); presence.autoDeliver = false;
  let persistedName = 'old';
  const sender = new AccountEvents(), receiver = new AccountEvents({ resolveRemote: async (_event, args) => [args[0], persistedName] });
  const values: string[] = []; receiver.on('name', (_id, name) => values.push(name));
  await Promise.all([sender.connect(presence), receiver.connect(presence)]);
  try {
    sender.emit('name', 'account', 'old'); await flush();
    persistedName = 'new'; receiver.emit('name', 'account', 'new');
    presence.deliver(presence.messages[0].topic, presence.messages[0].value); await flush();
    assert.deepEqual(values, ['new', 'new']);
  } finally { await Promise.all([sender.close(), receiver.close()]); }
});

test('publication failures report only the phase and never prevent local events', async () => {
  const presence = new SharedPresence(), failures: AccountEventFailure[] = [], values: string[] = [];
  const events = new AccountEvents(); await events.connect(presence, { onFailure: phase => { failures.push(phase); throw new Error('reporter failed'); } });
  events.on('name', (_id, name) => values.push(name)); presence.failPublish = true;
  try {
    events.emit('name', 'account', 'first'); assert.deepEqual(values, ['first']);
    await flush();
    events.emit('name', 'account', 'second');
    assert.deepEqual(values, ['first', 'second']); assert.deepEqual(failures, ['publish']);
    assert.equal(events.health().failed, true); assert.equal(events.health().connected, false);
    assert.equal(events.health().pendingEvents, 0);
  } finally { await events.close(); }
});

test('closing drains accepted events, unsubscribes only itself, and remains idempotent', async () => {
  const presence = new SharedPresence(), gate = deferred(), sender = new AccountEvents(), receiver = new AccountEvents();
  const values: string[] = []; receiver.on('name', (_id, name) => values.push(name));
  await Promise.all([sender.connect(presence), receiver.connect(presence)]);
  presence.publishGate = gate.promise;
  sender.emit('name', 'account', 'before-close'); await flush();
  const closing = sender.close(); assert.equal(sender.close(), closing);
  assert.equal(sender.health().connected, false);
  sender.emit('name', 'account', 'after-close');
  gate.resolve(); await closing; await flush();
  assert.deepEqual(values, ['before-close']);
  assert.equal(presence.listeners.get('royal:account-events:v1')?.size, 1);
  assert.equal(sender.health().closed, true);
  await receiver.close(); assert.equal(presence.listeners.get('royal:account-events:v1')?.size, 0);
});

test('closing finishes an already accepted authoritative read before detaching its room listeners', async () => {
  const presence = new SharedPresence(), gate = deferred(), sender = new AccountEvents();
  const receiver = new AccountEvents({ resolveRemote: async (_event, args) => { await gate.promise; return args; } });
  const values: string[] = []; receiver.on('name', (_id, name) => values.push(name));
  await Promise.all([sender.connect(presence), receiver.connect(presence)]);
  sender.emit('name', 'account', 'accepted'); await flush();
  const closing = receiver.close(); assert.equal(receiver.health().connected, false);
  assert.deepEqual(values, []); gate.resolve(); await closing;
  assert.deepEqual(values, ['accepted']);
  sender.emit('name', 'account', 'too-late'); await flush();
  assert.deepEqual(values, ['accepted']); await sender.close();
});

test('hung publication and failed unsubscribe cannot hang or reject shutdown', async () => {
  const presence = new SharedPresence(), failures: AccountEventFailure[] = [], events = new AccountEvents();
  await events.connect(presence, { operationTimeoutMs: 15, closeTimeoutMs: 5, onFailure: phase => failures.push(phase) });
  presence.publishGate = new Promise(() => {}); presence.failUnsubscribe = true;
  events.emit('name', 'account', 'accepted'); await flush();
  await events.close(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(events.health().closed, true); assert.equal(events.health().failed, true);
  assert.equal(events.health().pendingEvents, 0); assert.deepEqual(failures, ['publish']);
});

test('timed out and late subscription is cleaned up, with no unhandled rejection', async () => {
  const presence = new SharedPresence(), gate = deferred(); presence.subscribeGate = gate.promise;
  const events = new AccountEvents(), failures: AccountEventFailure[] = [];
  const ready = events.connect(presence, { operationTimeoutMs: 15, closeTimeoutMs: 25, onFailure: phase => failures.push(phase) });
  await assert.rejects(ready, /subscription unavailable/); await events.close();
  gate.resolve(); await flush();
  assert.equal(presence.listeners.get('royal:account-events:v1')?.size, 0);
  assert.deepEqual(failures, ['subscribe']);
});

test('incoming DB resolution failure and outgoing overflow fail health without breaking local events', async () => {
  const presence = new SharedPresence(), gate = deferred(), failure: AccountEventFailure[] = [];
  const sender = new AccountEvents(), receiver = new AccountEvents({ resolveRemote: async () => { throw new Error('database unavailable'); } });
  await Promise.all([sender.connect(presence), receiver.connect(presence, { onFailure: phase => failure.push(phase) })]);
  sender.emit('name', 'account', 'first'); await flush();
  assert.deepEqual(failure, ['receive']); assert.equal(receiver.health().failed, true);
  await receiver.close();
  presence.publishGate = gate.promise;
  const boundedEvents = new AccountEvents(), local: string[] = [];
  await boundedEvents.connect(presence, { maxPendingEvents: 1, onFailure: phase => failure.push(phase) });
  boundedEvents.on('name', (_id, name) => local.push(name));
  boundedEvents.emit('name', 'account', 'one'); boundedEvents.emit('name', 'account', 'two');
  assert.deepEqual(local, ['one', 'two']); await flush();
  assert.deepEqual(failure, ['receive', 'overflow']);
  gate.resolve(); await Promise.all([sender.close(), boundedEvents.close()]);
});

test('malformed external payloads are ignored and uncloneable local payloads still reach listeners', async () => {
  const presence = new SharedPresence(), events = new AccountEvents();
  let local = 0; events.on('security', () => local++);
  await events.connect(presence);
  const message = { version: 1, origin: 'other-process', sequence: 1, event: 'security', args: ['account', { kind: 'ejecting', until: 0 }] };
  presence.deliver('royal:account-events:v1', message); await flush(); assert.equal(local, 0);
  events.emit('security', 'account', { kind: 'ejecting', until: Date.now() + 1000, unsupported: () => {} });
  assert.equal(local, 1); await flush(); assert.equal(events.health().failed, true);
  await events.close();
});
