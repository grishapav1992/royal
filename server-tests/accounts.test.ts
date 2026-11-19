import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresDatabase } from '../server/database';
import { AccountStore } from '../server/accounts';
import { createHash, scryptSync } from 'node:crypto';
import { PLAYER_CHARACTERS } from '../src/shared/characters';

test('accounts and sessions survive reopening; passwords are hashed and logout revokes access', async () => {
  const dir = mkdtempSync(join(tmpdir(),'royal-auth-')), file = join(dir,'accounts.sqlite');
  let store = new AccountStore(file);
  try {
    const first = await store.login('  Player@Example.test  ','Correct-password-42!');
    (await store.select(first.account.id,4,'  Лунный кот 🎮  '));
    (await store.close()); store = new AccountStore(file);
    assert.equal((await store.session(first.token))?.account.skin,4);
    assert.equal((await store.session(first.token))?.account.name,'Лунный кот 🎮');
    const second = await store.login('player@example.test','Correct-password-42!');
    assert.equal(second.account.id,first.account.id);
    await assert.rejects(store.login('player@example.test','incorrect-password'),/Неверная/);
    (await assert.rejects(()=>store.select(first.account.id,6)));
    (await assert.rejects(()=>store.select(first.account.id,'1')));
    for (const name of ['', '   ', 'x'.repeat(25), null, '\u200b', 'a\u202eb']) (await assert.rejects(()=>store.select(first.account.id,2,name)));
    assert.equal((await store.session(first.token))?.account.skin,4);
    (await store.rename(first.account.id,'<b>Игрок ★</b>'));
    assert.equal((await store.session(second.token))?.account.name,'<b>Игрок ★</b>');
    const db = new PostgresDatabase(file);
    assert(!String((await db.prepare('SELECT password FROM accounts').get())!.password).includes('Correct-password-42!'));
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
    const results = await Promise.allSettled([store.login('race@example.test','Password-one-42!'),store.login('race@example.test','Password-two-42!')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
  } finally { (await store.close()); }
});

test('parallel first sign-ins with the same password retain one account and independent sessions', async () => {
  const store = new AccountStore(':memory:');
  try {
    const sessions = await Promise.all(Array.from({length: 4}, () => store.login('shared@example.test', 'Same-password-42!')));
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
    const first = await store.login('expiry@example.test', 'Expiry-password-42!');
    const hash = (await store.session(first.token))!.hash;
    await db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(now-1, hash);
    const second = await store.login('expiry@example.test', 'Expiry-password-42!');
    assert.equal(await store.session(first.token), undefined);
    assert.equal(await store.active(hash), false);
    assert.ok(await db.prepare('SELECT hash FROM sessions WHERE hash=?').get(hash), 'expiration is enforced before the next physical cleanup');
    now += 60000;
    const third = await store.login('expiry@example.test', 'Expiry-password-42!');
    assert.equal(await db.prepare('SELECT hash FROM sessions WHERE hash=?').get(hash), undefined);
    assert.ok(await store.session(second.token)); assert.ok(await store.session(third.token));
  } finally { await store.close(); await db.close(); rmSync(dir, {recursive: true}); }
});

test('character profiles and active sessions retain integrity through PostgreSQL reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(),'royal-profile-')), file = join(dir,'accounts');
  let store = new AccountStore(file);
  const first = await store.login('profile@example.test','Profile-password-42!');
  await store.select(first.account.id,4,'Старый профиль'); await store.close();
  store = new AccountStore(file);
  try {
    assert.equal((await store.session(first.token))?.account.name,'Старый профиль');
    assert.equal((await store.session(first.token))?.account.skin,4);
    assert.equal((await store.login('profile@example.test','Profile-password-42!')).account.id,first.account.id);
    for (const skin of PLAYER_CHARACTERS.map(character => character.id)) {
      await store.select(first.account.id,skin);
      assert.equal((await store.session(first.token))?.account.skin,skin);
    }
    for (const invalid of [6,13,14,15,16,17,-1,1.5,'16',null]) await assert.rejects(()=>store.select(first.account.id,invalid));
    await store.close(); store = new AccountStore(file);
    assert.equal((await store.session(first.token))?.account.skin,PLAYER_CHARACTERS.at(-1)!.id);
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
    assert.deepEqual(await db.prepare('SELECT * FROM accounts').get(), { ...account, appearance: null, failed_logins: 0, locked_until: null });
    assert.deepEqual(await db.prepare('SELECT * FROM sessions').get(), session);
    assert.equal((await store.session(token))?.account.name, account.name);
    assert.equal((await store.login(account.email, 'upgrade-password')).account.id, account.id);
    const indexes = await db.prepare("SELECT indexdef FROM pg_indexes WHERE schemaname=? AND tablename='sessions'").all(db.schema);
    assert.ok(indexes.some(index => /\(account_id\)/.test(String(index.indexdef))));
    await store.close(); store = new AccountStore(file); await store.ready;
    assert.equal((await store.session(token))?.account.skin, account.skin);
    assert.deepEqual(await db.prepare('SELECT * FROM accounts').get(), { ...account, appearance: null, failed_logins: 0, locked_until: null });
    assert.deepEqual(await db.prepare('SELECT * FROM sessions WHERE hash=?').get(session.hash), session);
  } finally { if (store) await store.close(); await db.close(); rmSync(dir, {recursive: true}); }
});

test('new accounts require strong passwords and the fifth wrong password locks across stores', async context => {
  const name = 'auth_lockout_' + crypto.randomUUID().replaceAll('-', '');
  const store = new AccountStore(name), second = new AccountStore(name);
  const email = 'lockout@example.test';
  const password = 'Royal-Test42!';
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  try {
    for (const weak of ['Aa1!', 'OnlyLetters!', 'lowercase42!', 'UPPERCASE42!', 'NoSpecial42']) {
      await assert.rejects(store.login(email, weak), { status: 400, code: 'password_requirements' });
    }
    const auth = await store.login(email, password);
    for (let index = 0; index < 4; index++) {
      await assert.rejects(store.login(email, 'x'), { status: 401 });
    }
    assert.equal((await second.login(email, password)).account.id, auth.account.id);
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
      (index % 2 === 0 ? store : second).login(email.toUpperCase(), 'wrong-password')));
    const codes = attempts.map(result => result.status === 'rejected' ? result.reason.status : 200);
    assert.deepEqual(codes.sort(), [401, 401, 401, 401, 429]);
    const retryAt = now + 30 * 60_000;
    assert.ok(await store.session(auth.token));
    await assert.rejects(second.login(email, password), { status: 429, code: 'login_locked', retryAt });
    now = retryAt - 1;
    await assert.rejects(store.login(email, password), { status: 429, code: 'login_locked', retryAt });
    now++;
    assert.equal((await second.login(email, password)).account.id, auth.account.id);
    await assert.rejects(store.login(email, 'x'), { status: 401 });
  } finally { await store.close(); await second.close(); }
});

test('a recovery code expires, has limited attempts and gives one password change', async context => {
  const store = new AccountStore(':memory:');
  const email = 'password-recovery@example.test';
  const password = 'Royal-Old42!', replacement = 'Royal-New42!';
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const mailbox: { email: string; code: string }[] = [];
  const send = async (email: string, code: string) => { mailbox.push({ email, code }); };
  try {
    const original = await store.login(email, password);
    const second = await store.login(email, password);
    const oldHash = (await store.session(original.token))!.hash;
    const revoked: string[] = [];
    store.events.on('logout', hash => revoked.push(hash));
    for (let index = 0; index < 4; index++) await assert.rejects(store.login(email, 'x'), { status: 401 });
    await assert.rejects(store.login(email, 'x'), { status: 429 });
    await store.requestPasswordCode('missing@example.test', send);
    await store.requestPasswordCode(email.toUpperCase(), send);
    await store.requestPasswordCode(email, send);
    assert.equal(mailbox.length, 1);
    assert.equal(mailbox[0].email, email);
    assert.match(mailbox[0].code, /^\d{6}$/);
    await assert.rejects(store.resetPassword(email, mailbox[0].code, replacement), { code: 'reset_expired' });
    const wrong = mailbox[0].code === '000000' ? '000001' : '000000';
    for (let index = 0; index < 5; index++) await assert.rejects(store.verifyPasswordCode(email, wrong), { status: 400 });
    await assert.rejects(store.verifyPasswordCode(email, mailbox[0].code), { status: 400 });
    now += 60_000;
    await store.requestPasswordCode(email, send);
    now += 10 * 60_000;
    await assert.rejects(store.verifyPasswordCode(email, mailbox[1].code), { status: 400 });
    await store.requestPasswordCode(email, send);
    const grant = await store.verifyPasswordCode(email, mailbox[2].code);
    await assert.rejects(store.verifyPasswordCode(email, mailbox[2].code), { status: 400 });
    await assert.rejects(store.resetPassword(email, grant, 'weak-password'), { code: 'password_requirements' });
    assert.ok(await store.session(original.token));
    await store.resetPassword(email, grant, replacement);
    assert.equal(await store.session(original.token), undefined);
    assert.equal(await store.session(second.token), undefined);
    assert.deepEqual(revoked.length, 2);
    assert.ok(revoked.includes(oldHash));
    await assert.rejects(store.resetPassword(email, grant, password), { code: 'reset_expired' });
    await assert.rejects(store.login(email, password), { status: 401 });
    assert.equal((await store.login(email, replacement)).account.id, original.account.id);
  } finally { await store.close(); }
});
