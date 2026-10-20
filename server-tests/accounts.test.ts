import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresDatabase } from '../server/database';
import { AccountStore } from '../server/accounts';
import { createHash, scryptSync } from 'node:crypto';

test('accounts and sessions survive reopening; passwords are hashed and logout revokes access', async () => {
  const dir = mkdtempSync(join(tmpdir(),'royal-auth-')), file = join(dir,'accounts.sqlite');
  let store = new AccountStore(file);
  try {
    const first = await store.login('  Player@Example.test  ','correct-password');
    (await store.select(first.account.id,4,'  Лунный кот 🎮  '));
    (await store.close()); store = new AccountStore(file);
    assert.equal((await store.session(first.token))?.account.skin,4);
    assert.equal((await store.session(first.token))?.account.name,'Лунный кот 🎮');
    const second = await store.login('player@example.test','correct-password');
    assert.equal(second.account.id,first.account.id);
    await assert.rejects(store.login('player@example.test','incorrect-password'),/Неверная/);
    (await assert.rejects(()=>store.select(first.account.id,6)));
    (await assert.rejects(()=>store.select(first.account.id,'1')));
    for (const name of ['', '   ', 'x'.repeat(25), null, '\u200b', 'a\u202eb']) (await assert.rejects(()=>store.select(first.account.id,2,name)));
    assert.equal((await store.session(first.token))?.account.skin,4);
    (await store.rename(first.account.id,'<b>Игрок ★</b>'));
    assert.equal((await store.session(second.token))?.account.name,'<b>Игрок ★</b>');
    const db = new PostgresDatabase(file);
    assert(!String((await db.prepare('SELECT password FROM accounts').get())!.password).includes('correct-password'));
    assert.notEqual((await db.prepare('SELECT hash FROM sessions LIMIT 1').get())!.hash,first.token);
    (await store.logout(first.token)); assert.equal((await store.session(first.token)),undefined);
    assert((await store.session(second.token)));
    (await db.prepare('UPDATE sessions SET expires=0').run());
    assert.equal((await store.session(second.token)),undefined); (await db.close());
  } finally { (await store.close()); rmSync(dir,{recursive:true}); }
});

test('simultaneous registration cannot overwrite an existing password', async () => {
  const store = new AccountStore(':memory:');
  try {
    const results = await Promise.allSettled([store.login('race@example.test','password-one'),store.login('race@example.test','password-two')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
  } finally { (await store.close()); }
});

test('parallel first sign-ins with the same password retain one account and independent sessions', async () => {
  const store = new AccountStore(':memory:');
  try {
    const sessions = await Promise.all(Array.from({length: 4}, () => store.login('shared@example.test', 'same-password')));
    assert.equal(new Set(sessions.map(session => session.account.id)).size, 1);
    assert.equal(new Set(sessions.map(session => session.token)).size, 4);
    for (const session of sessions) assert.equal((await store.session(session.token))?.account.id, sessions[0].account.id);
    await store.logout(sessions[0].token);
    assert.equal(await store.session(sessions[0].token), undefined);
    for (const session of sessions.slice(1)) assert.ok(await store.session(session.token));
  } finally { await store.close(); }
});

test('expired sessions cannot authenticate between bounded cleanup runs and are eventually purged', async context => {
  const dir = mkdtempSync(join(tmpdir(), 'royal-expiry-')), file = join(dir, 'accounts');
  const store = new AccountStore(file), db = new PostgresDatabase(file);
  let now = Date.now(); context.mock.method(Date, 'now', () => now);
  try {
    const first = await store.login('expiry@example.test', 'expiry-password');
    const hash = (await store.session(first.token))!.hash;
    await db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(now-1, hash);
    const second = await store.login('expiry@example.test', 'expiry-password');
    assert.equal(await store.session(first.token), undefined);
    assert.equal(await store.active(hash), false);
    assert.ok(await db.prepare('SELECT hash FROM sessions WHERE hash=?').get(hash), 'expiration is enforced before the next physical cleanup');
    now += 60000;
    const third = await store.login('expiry@example.test', 'expiry-password');
    assert.equal(await db.prepare('SELECT hash FROM sessions WHERE hash=?').get(hash), undefined);
    assert.ok(await store.session(second.token)); assert.ok(await store.session(third.token));
  } finally { await store.close(); await db.close(); rmSync(dir, {recursive: true}); }
});

test('character profiles and active sessions retain integrity through PostgreSQL reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(),'royal-profile-')), file = join(dir,'accounts');
  let store = new AccountStore(file);
  const first = await store.login('profile@example.test','profile-password');
  await store.select(first.account.id,4,'Старый профиль'); await store.close();
  store = new AccountStore(file);
  try {
    assert.equal((await store.session(first.token))?.account.name,'Старый профиль');
    assert.equal((await store.session(first.token))?.account.skin,4);
    assert.equal((await store.login('profile@example.test','profile-password')).account.id,first.account.id);
    for (const skin of [0,1,2,3,4,5,7,8,9,10,11,12,13,14,15,16]) {
      await store.select(first.account.id,skin);
      assert.equal((await store.session(first.token))?.account.skin,skin);
      if (skin >= 13) {
        await store.close(); store = new AccountStore(file);
        assert.equal((await store.session(first.token))?.account.skin,skin);
      }
    }
    for (const invalid of [6,17,-1,1.5,'16',null]) await assert.rejects(()=>store.select(first.account.id,invalid));
    await store.close(); store = new AccountStore(file);
    assert.equal((await store.session(first.token))?.account.skin,16);
    assert.equal((await store.session(first.token))?.account.name,'Старый профиль');
    const check = new PostgresDatabase(file);
    try { assert.equal(await check.integrityCheck(),true); }
    finally { await check.close(); }
  } finally { await store.close(); rmSync(dir,{recursive:true}); }
});

test('account schema upgrades retain imported credentials, profile and active session identifiers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royal-account-upgrade-')), file = join(dir, 'accounts');
  const db = new PostgresDatabase(file);
  let store: AccountStore | undefined;
  const token = 'b'.repeat(64), salt = '17'.repeat(16), now = Date.now();
  const password = salt+':'+scryptSync('upgrade-password', salt, 64, {N: 16384, r: 8, p: 1}).toString('hex');
  const account = {id: 'imported-account', email: 'upgrade@example.test', name: 'Импортированный профиль', password, skin: 7, created_at: now-86400000};
  const session = {hash: createHash('sha256').update(token).digest('hex'), account_id: account.id, expires: now+86400000};
  try {
    await db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,skin INTEGER CHECK(skin>=0),created_at INTEGER NOT NULL);
      CREATE TABLE sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires INTEGER NOT NULL);`);
    await db.prepare('INSERT INTO accounts(id,email,name,password,skin,created_at) VALUES(?,?,?,?,?,?)').run(...Object.values(account));
    await db.prepare('INSERT INTO sessions(hash,account_id,expires) VALUES(?,?,?)').run(...Object.values(session));
    store = new AccountStore(file); await store.ready;
    assert.deepEqual(await db.prepare('SELECT * FROM accounts').get(), { ...account, appearance: null });
    assert.deepEqual(await db.prepare('SELECT * FROM sessions').get(), session);
    assert.equal((await store.session(token))?.account.name, account.name);
    assert.equal((await store.login(account.email, 'upgrade-password')).account.id, account.id);
    const indexes = await db.prepare("SELECT indexdef FROM pg_indexes WHERE schemaname=? AND tablename='sessions'").all(db.schema);
    assert.ok(indexes.some(index => /\(account_id\)/.test(String(index.indexdef))));
    await store.close(); store = new AccountStore(file); await store.ready;
    assert.equal((await store.session(token))?.account.skin, account.skin);
    assert.deepEqual(await db.prepare('SELECT * FROM accounts').get(), { ...account, appearance: null });
    assert.deepEqual(await db.prepare('SELECT * FROM sessions WHERE hash=?').get(session.hash), session);
  } finally { if (store) await store.close(); await db.close(); rmSync(dir, {recursive: true}); }
});
