import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MiraService, MiraError } from '../server/mira';
import { MiraMemoryStore } from '../server/miraMemory';
import express from 'express';
import { accounts } from '../server/accounts';
import { installMira } from '../server/miraRoutes';

const output = (value: object) => new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), 'royal-mira-'));
  const path = join(directory, 'memory.sqlite'); const db = new PostgresDatabase(path);
  (await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('a'),('b');")); (await db.close());
  return { path, remove: () => rmSync(directory, { recursive: true, force: true }) };
};

test('Mira API initializes its memory in the account PostgreSQL schema and persists accepted replies', async context => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  const nativeFetch = fetch;
  context.mock.method(globalThis, 'fetch', async () => output({ reply: 'Джаз запомню.', facts: ['Гость любит джаз'], impression: '', tone: 'interest', choices: [], endConversation: false }));
  const app = express(); await installMira(app);
  const login = await accounts.login(`mira-route-${crypto.randomUUID()}@example.test`, 'Mira-test-password!');
  const memory = new MiraMemoryStore(accounts.schema, accounts.ready);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/npc/mira`;
  const headers = { Cookie: 'royal_session='+login.token, 'Content-Type': 'application/json' };
  try {
    const greeting = await nativeFetch(endpoint, { headers }); assert.equal(greeting.status, 200);
    assert.equal((await greeting.json()).turns.at(-1).content, 'Ну? Чем удивишь?');
    const reply = await nativeFetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ message: 'Люблю джаз' }) });
    assert.equal(reply.status, 200); assert.equal((await reply.json()).reply, 'Джаз запомню.');
    assert.deepEqual((await memory.read(login.account.id))?.facts, ['Гость любит джаз']);
    const englishHeaders = { ...headers, 'Accept-Language': 'ru;q=0.2,en-US;q=0.9' };
    const english = await nativeFetch(endpoint, { headers: englishHeaders });
    assert.equal(english.headers.get('Content-Language'), 'en');
    assert.equal((await english.json()).turns.at(-1).content, 'Go on. I remember you.');
    const russian = await nativeFetch(endpoint, { headers: { ...headers, 'Accept-Language': 'ru-RU' } });
    assert.equal((await russian.json()).turns.at(-1).content, 'Продолжим. Я тебя помню.');
    assert.deepEqual((await memory.read(login.account.id))?.facts, ['Гость любит джаз']);
    const invalid = await nativeFetch(endpoint, { method: 'POST', headers: englishHeaders, body: JSON.stringify({ message: '' }) });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'Write 1 to 600 characters.');
    await accounts.logout(login.token);
    const signedOut = await nativeFetch(endpoint, { headers: englishHeaders });
    assert.equal(signedOut.status, 401); assert.equal((await signedOut.json()).error, 'Enter the online hall to talk to Mira.');
  } finally {
    await memory.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous;
  }
});

test('Mira can reset malformed persisted memory without decoding it', async () => {
  const fixture = await setup(); const store = new MiraMemoryStore(fixture.path); const db = new PostgresDatabase(fixture.path);
  try {
    await store.ready;
    await db.prepare('INSERT INTO mira_memory(account_id,data,updated_at) VALUES(?,?,?)').run('a', '{invalid', 0);
    await new MiraService(fetch, store).reset('a');
    assert.equal(await store.read('a'), undefined);
    assert.deepEqual((await new MiraService(fetch, store).resume('a')).turns.map(turn => turn.content), ['Ну? Чем удивишь?']);
  } finally { await store.close(); await db.close(); fixture.remove(); }
});

test('Mira remembers details after restart, recognizes tomorrow and five days away, and can forget one account', async () => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  const fixture = await setup(); let store = new MiraMemoryStore(fixture.path);
  let now = Date.parse('2026-10-07T12:00:00Z'); const bodies: any[] = [];
  const request = (async (_url: unknown, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    return output({ reply: 'Джаз? Уже интереснее.', facts: ['Гость играет на саксофоне', 'Любит кислый лимонад'], impression: 'Остроумный собеседник', tone: 'interest', choices: ['Любишь саксофон?', 'Налей лимонад', 'Расскажи про джаз'], endConversation: false });
  }) as typeof fetch;
  try {
    const first = new MiraService(request, store, () => now);
    (await first.resume('a', 'Антон')); await first.respond('a', 'Я играю на саксофоне и люблю кислый лимонад.');
    (await store.close()); store = new MiraMemoryStore(fixture.path); now += 86400000;
    const tomorrow = new MiraService(request, store, () => now);
    assert.match((await tomorrow.resume('a', 'Антон')).turns.at(-1)!.content, /Антон.*Опять ты/);
    assert.match((await store.read('a'))!.facts.join(' '), /саксофоне/);
    await tomorrow.respond('a', 'Помнишь мой любимый напиток?');
    assert.match(bodies.at(-1).instructions, /кислый лимонад/);
    assert.match(bodies.at(-1).instructions, /"absenceDays":1/);
    assert.equal((await store.read('a'))!.warmth, 2);
    now += 5 * 86400000;
    const later = new MiraService(request, store, () => now);
    assert.match((await later.resume('a', 'Антон')).turns.at(-1)!.content, /^5 дней/);
    assert.deepEqual((await later.resume('b')).turns.map(turn => turn.content), ['Ну? Чем удивишь?']);
    assert.deepEqual((await store.read('b'))!.facts, []);
    (await later.reset('a'));
    assert.equal((await store.read('a')), undefined);
    assert.equal((await new MiraService(request, store, () => now).resume('a')).turns.length, 1);
    assert.ok((await store.read('b')));
  } finally { (await store.close()); fixture.remove(); if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous; }
});

test('Mira really dismisses persistent repeats across restart, preserves failures and listens to repeated distress', async () => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  const fixture = await setup(); const store = new MiraMemoryStore(fixture.path); let now = 1800000000000;
  let fail = false, confiding = false, calls = 0;
  const request = (async () => {
    calls++; if (fail) return new Response('broken', { status: 502 });
    return output({ reply: 'Я уже ответила.', facts: [], impression: '', tone: confiding ? 'confiding' : 'neutral', choices: ['Расскажи ещё', 'Поговорим о джазе', 'Я пойду'], endConversation: false });
  }) as typeof fetch;
  try {
    const service = new MiraService(request, store, () => now);
    for (let i = 0; i < 3; i++) { await service.respond('a', 'Как смена?'); now += 2100; }
    const before = (await store.read('a')); fail = true;
    await assert.rejects(service.respond('a', 'КАК СМЕНА!'), (error: unknown) => error instanceof MiraError && error.status === 502);
    assert.deepEqual((await store.read('a')), before); fail = false; now += 2100;
    const fourth = await service.respond('a', 'КАК СМЕНА!');
    assert.match(fourth.reply, /займусь стаканами/);
    assert.equal(fourth.cooldownUntil, now + 45000);
    const restored = new MiraService(request, store, () => now);
    const count = calls; await assert.rejects(restored.respond('a', 'Новая тема'), (error: unknown) => error instanceof MiraError && error.status === 429);
    assert.equal(calls, count);
    now += 46000; await restored.respond('a', 'Новая тема');
    confiding = true;
    for (let i = 0; i < 5; i++) { now += 2100; assert.equal((await restored.respond('b', 'Мне очень плохо, можно рассказать?')).cooldownUntil, 0); }
  } finally { (await store.close()); fixture.remove(); if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous; }
});
