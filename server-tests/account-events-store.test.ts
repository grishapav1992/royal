import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LocalPresence } from '@colyseus/core';
import { AccountStore } from '../server/accounts';
import type { AccountEvent } from '../server/accountEvents';

function nextEvent(store: AccountStore, event: AccountEvent) {
  return new Promise<unknown[]>((resolve, reject) => {
    const timeout = setTimeout(() => { store.events.off(event, listener); reject(new Error('Account event was not delivered')); }, 2000);
    const listener = (...args: unknown[]) => { clearTimeout(timeout); store.events.off(event, listener); resolve(args); };
    store.events.on(event, listener);
  });
}
async function drained(...stores: AccountStore[]) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    if (stores.every(store => store.events.health().pendingEvents === 0)) return;
  }
  throw new Error('Account event bridge did not drain');
}

test('another account process resolves stale profile, drinking and security events from PostgreSQL', async () => {
  const schema = 'account_events_' + randomUUID().replaceAll('-', '');
  const first = new AccountStore(schema), second = new AccountStore(schema), presence = new LocalPresence();
  try {
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.events.connect(presence), second.events.connect(presence)]);
    const login = await first.login('account-events@example.test', 'account-event-password');
    await first.select(login.account.id, 4, 'Актуальное имя'); await drained(first, second);
    const id = login.account.id;

    let delivered = nextEvent(second, 'name');
    first.events.emit('name', id, 'Устаревшее имя');
    assert.deepEqual(await delivered, [id, 'Актуальное имя']);
    delivered = nextEvent(second, 'skin'); first.events.emit('skin', id, 0);
    assert.deepEqual(await delivered, [id, 4]);
    assert.equal((await second.currentAccount(id))?.name, 'Актуальное имя');

    const drinking = await first.drinking.consume(id, 'lemonade'); await drained(first, second);
    delivered = nextEvent(second, 'drinking');
    first.events.emit('drinking', id, { soberAt: 0, lastDrinkAt: 0, lastDrink: '' });
    const [drinkId, state] = await delivered;
    assert.equal(drinkId, id);
    assert.equal((state as any).lastDrinkAt, drinking.lastDrinkAt);
    assert.equal((state as any).lastDrink, drinking.lastDrink);
    assert.equal((state as any).soberAt, drinking.soberAt);

    const warning = await first.moderation.record(id), ban = await first.moderation.eject(id);
    delivered = nextEvent(second, 'security'); first.events.emit('security', id, warning);
    const [securityId, decision] = await delivered;
    assert.equal(securityId, id);
    assert.equal((decision as any).kind, 'ejecting');
    assert.equal((decision as any).until, ban.until);
    assert.equal(second.events.health().failed, false);
  } finally { await Promise.all([first.close(), second.close()]); }
});

test('an active session ignores a stale remote logout, while committed revocation is delivered', async () => {
  const schema = 'account_events_' + randomUUID().replaceAll('-', '');
  const first = new AccountStore(schema), second = new AccountStore(schema), presence = new LocalPresence();
  try {
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.events.connect(presence), second.events.connect(presence)]);
    const login = await first.login('account-logout@example.test', 'account-event-password');
    const session = (await first.session(login.token))!;
    let count = 0; second.events.on('logout', () => count++);
    first.events.emit('logout', session.hash); await drained(first, second);
    assert.equal(count, 0); assert.equal(await second.active(session.hash), true);
    const delivered = nextEvent(second, 'logout');
    await first.logout(login.token);
    assert.deepEqual(await delivered, [session.hash]);
    assert.equal(count, 1); assert.equal(await second.active(session.hash), false);
  } finally { await Promise.all([first.close(), second.close()]); }
});
