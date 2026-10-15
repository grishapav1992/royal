import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LocalPresence } from '@colyseus/core';
import { AccountStore, accounts, AuthError } from '../server/accounts';
import { PostgresDatabase } from '../server/database';
import { DEFAULT_APPEARANCE, appearanceKey, normalizeAppearance, parseAppearance, serializeAppearance } from '../src/shared/appearance';

test('custom appearance persists across stores and account events use current database values', async () => {
  const store = new AccountStore(`appearance-${randomUUID()}`), remote = new AccountStore(store.schema), presence = new LocalPresence();
  try {
    await Promise.all([store.ready, remote.ready]); await Promise.all([store.events.connect(presence), remote.events.connect(presence)]);
    const login = await store.login(`appearance-${randomUUID()}@example.test`, 'appearance-test-password');
    const value = { ...DEFAULT_APPEARANCE, gender: 1, body: 2, earrings: 4, tattoo: 5, makeup: 5, makeupColor: 3 };
    const updates: unknown[] = []; remote.events.on('appearance', (_id, appearance) => updates.push(appearance));
    await store.select(login.account.id, undefined, 'Мой персонаж', value);
    for (let i = 0; i < 100 && !updates.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(updates, [value]);
    assert.deepEqual((await remote.session(login.token))?.account.appearance, value);
    assert.equal((await remote.currentAccount(login.account.id))?.name, 'Мой персонаж');
    for (const bad of [{ ...value, body: 3 }, { ...value, glasses: -1 }, { ...value, makeup: 6 }, { ...value, makeupColor: -1 }, { ...value, version: 2 }, { ...value, extra: true }, {}, null]) {
      await assert.rejects(store.select(login.account.id, undefined, 'Не сохранять', bad), (error: unknown) => error instanceof AuthError && error.status === 400);
    }
    assert.equal((await store.currentAccount(login.account.id))?.name, 'Мой персонаж');
    assert.deepEqual((await store.currentAccount(login.account.id))?.appearance, value);
    await store.select(login.account.id, 12);
    assert.equal((await remote.currentAccount(login.account.id))?.appearance, null);
    assert.equal(serializeAppearance(null), '');
  } finally { await Promise.all([store.close(), remote.close(), accounts.close()]); }
});

test('saved outfits from before makeup keep every selection and default to no makeup', async () => {
  const store = new AccountStore(`appearance-compat-${randomUUID()}`), db = new PostgresDatabase(store.schema);
  try {
    await store.ready;
    const login = await store.login(`appearance-compat-${randomUUID()}@example.test`, 'appearance-test-password');
    const { makeup, makeupColor, ...old } = { ...DEFAULT_APPEARANCE, gender: 1, body: 1, hair: 2, hat: 5, earrings: 4 };
    const expected = { ...old, makeup: 0, makeupColor: 0 };
    await db.prepare('UPDATE accounts SET skin=0,appearance=?::jsonb WHERE id=?').run(JSON.stringify(old), login.account.id);
    assert.deepEqual((await store.session(login.token))?.account.appearance, expected);
    assert.deepEqual(parseAppearance(JSON.stringify(old)), expected);
    await store.select(login.account.id, undefined, undefined, old);
    assert.deepEqual((await store.currentAccount(login.account.id))?.appearance, expected);
    assert.equal(normalizeAppearance({ ...old, makeup: 999 }), null);
    assert.equal(normalizeAppearance({ ...old, makeupColor: undefined }), null);
    assert.equal(normalizeAppearance({ ...old, unknown: 0 }), null);
    assert.equal(appearanceKey({ ...expected, gender: 0 }), appearanceKey({ ...expected, gender: 1 }));
    assert.notEqual(appearanceKey(expected), appearanceKey({ ...expected, makeup: 1 }));
  } finally { await Promise.all([db.close(), store.close()]); }
});
