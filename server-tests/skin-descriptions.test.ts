import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PostgresDatabase } from '../server/database';
import { SkinStudioStore } from '../server/skinStudio';
import { CodexSkinDescriptions, skinDescription, skinDescriptionImage, type SkinDescriptionGenerator } from '../server/skinDescriptions';
import { SKIN_PRICE_UNITS, type SkinPurchase } from '../src/shared/skinStudio';

async function fixture(generator: SkinDescriptionGenerator) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,skin INTEGER DEFAULT 0,appearance JSONB); INSERT INTO accounts(id) VALUES ('alice'),('bob')");
  let now = Date.now(), imageCalls = 0, descriptionsEnabled = false;
  const payments: string[] = [];
  const images = { available: () => true, generate: async () => Buffer.from('different-artwork-' + ++imageCalls) };
  const wallet = { skinPurchase: async (_id: string, id: string, action: 'reserve' | 'capture' | 'refund'): Promise<SkinPurchase> => {
    payments.push(action); return { id, amountUnits: SKIN_PRICE_UNITS, state: action === 'reserve' ? 'reserved' : action === 'capture' ? 'captured' : 'refunded' };
  } };
  const makeStore = (descriptions = generator) => new SkinStudioStore(db, wallet, images, () => true, () => {}, undefined, () => now,
    { available: () => descriptionsEnabled && descriptions.available(), describe: image => descriptions.describe(image) });
  const store = makeStore(); await store.ready;
  const order = async () => {
    descriptionsEnabled = false;
    const request = { id: randomUUID(), prompt: 'Сумбурный запрос с придуманными деталями, которые не нарисовались' };
    await store.create('alice', request); await store.tick();
    const job = (await store.snapshot('alice')).job!;
    await store.choose('alice', job.id, job.variants[0].id);
    descriptionsEnabled = true;
    return job;
  };
  return { db, store, makeStore, order, payments, imageCalls: () => imageCalls, advance: (ms: number) => { now += ms; } };
}

test('vision input contains four actual standing views, no player brief or previous image', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">'
    + ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map((fill, i) => `<rect width="1024" height="384" y="${i * 384}" fill="${fill}"/>`).join('') + '</svg>';
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const view = await skinDescriptionImage(image), metadata = await sharp(view).metadata();
  assert.equal(metadata.width, 512); assert.equal(metadata.height, 768);
  const { data, info } = await sharp(view).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  assert.deepEqual([rgb(1, 1), rgb(257, 1), rgb(1, 385), rgb(257, 385)], [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]);
  let calls = 0;
  const provider = new CodexSkinDescriptions((async (url, init) => {
    calls++; assert.equal(url, 'https://codex.sale/v1/responses');
    const body = JSON.parse(String(init!.body));
    assert.equal(body.model, 'vision-test'); assert.equal(body.store, false); assert.equal(body.stream, false);
    assert.equal(body.previous_response_id, undefined); assert.equal(body.input.length, 1);
    assert.equal(body.input[0].role, 'user'); assert.equal(body.input[0].content[1].type, 'input_image');
    assert.equal(body.input[0].content[1].image_url, 'data:image/png;base64,' + view.toString('base64'));
    assert.equal(body.input[0].content.length, 3); assert.equal(body.input[0].content[2].type, 'input_image');
    assert.doesNotMatch(JSON.stringify(body), /Сумбурный запрос|different-artwork/);
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"description":"Сопливый бродяга в рваном чёрном плаще"}' }] }] });
  }) as typeof fetch, { CODEX_SALE_API_KEY: 'test-only', CODEX_SALE_NPC_MODEL: 'vision-test' });
  assert.equal(await provider.describe(image), 'Сопливый бродяга в рваном чёрном плаще'); assert.equal(calls, 1);
  await assert.rejects(() => provider.describe(Buffer.from('bad PNG'))); assert.equal(calls, 1);
  assert.equal(skinDescription('x'.repeat(150)), null); assert.equal(skinDescription(''), null);
  for (const result of [
    { status: 'incomplete', output: [] },
    { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"description":"' + 'длинное '.repeat(30) + '"}' }] }] },
    { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"description":"Пират с попугаем","biography":"Выдуманная история"}' }] }] },
  ]) {
    const invalid = new CodexSkinDescriptions((async () => Response.json(result)) as typeof fetch, { CODEX_SALE_API_KEY: 'test-only' });
    await assert.rejects(() => invalid.describe(image));
  }
});

test('only equipped owned artwork supplies NPC context, and context survives reopening the store', async () => {
  const seen: string[] = [];
  const f = await fixture({ available: () => true, describe: async image => { seen.push(image.toString()); return 'Одногий пират с попугаем'; } });
  try {
    const job = await f.order();
    assert.equal(await f.store.appearanceContext('alice'), null);
    await f.store.tick();
    const expected = { skinId: job.variants[0].id, description: 'Одногий пират с попугаем' };
    assert.deepEqual(await f.store.appearanceContext('alice'), expected);
    assert.deepEqual(await f.makeStore().appearanceContext('alice'), expected);
    assert.equal((await f.store.snapshot('alice')).wardrobe[0].description, expected.description);
    assert.equal(await f.store.appearanceContext('bob'), null);
    await f.db.prepare('UPDATE accounts SET appearance=?::jsonb WHERE id=?').run(JSON.stringify({ version: 2, skinId: expected.skinId, theme: 'south-park' }), 'bob');
    assert.equal(await f.store.appearanceContext('bob'), null);
    await f.db.prepare('UPDATE accounts SET appearance=NULL WHERE id=?').run('alice');
    assert.equal(await f.store.appearanceContext('alice'), null);
    assert.equal(await f.store.asset(job.variants[1].id, 'alice'), null);
    assert.equal(seen.length, 1); assert.match(seen[0], /^different-artwork-/);
    assert.deepEqual(f.payments, ['reserve', 'capture']); assert.equal(f.imageCalls(), 2);
  } finally { await f.store.drain(); await f.db.close(); }
});

test('description failures retry independently without regenerating, refunding or charging the skin', async () => {
  let fail = true, calls = 0;
  const f = await fixture({ available: () => true, describe: async () => { calls++; if (fail) throw new Error('Offline'); return 'Космонавт в белом скафандре'; } });
  try {
    await f.order(); await f.store.tick();
    assert.equal((await f.store.snapshot('alice')).job?.state, 'selected');
    assert.equal(await f.store.appearanceContext('alice'), null);
    await f.store.tick(); assert.equal(calls, 1);
    f.advance(15001); fail = false; await f.store.tick();
    assert.equal((await f.store.appearanceContext('alice'))?.description, 'Космонавт в белом скафандре');
    assert.equal(calls, 2); assert.equal(f.imageCalls(), 2); assert.deepEqual(f.payments, ['reserve', 'capture']);
  } finally { await f.store.drain(); await f.db.close(); }
});

test('two workers lease once and an expired caption cannot overwrite a newer caption', async () => {
  let calls = 0, started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ available: () => true, describe: async () => {
    calls++; if (calls === 1) { started(); await gate; return 'Устаревшее описание пирата'; }
    return 'Пират с попугаем на плече';
  } });
  const second = f.makeStore();
  try {
    await f.order(); const first = f.store.tick(); await began;
    await second.tick(); assert.equal(calls, 1);
    f.advance(60001); await second.tick(); assert.equal(calls, 2);
    release(); await first;
    assert.equal((await f.store.appearanceContext('alice'))?.description, 'Пират с попугаем на плече');
    assert.deepEqual(f.payments, ['reserve', 'capture']);
  } finally { release(); await Promise.all([f.store.drain(), second.drain()]); await f.db.close(); }
});

test('legacy wardrobe artwork is analyzed on demand, never from its original brief', async () => {
  let calls = 0;
  const f = await fixture({ available: () => true, describe: async () => { calls++; return 'Бродяга в дырявой шапке'; } });
  try {
    await f.order();
    await f.db.prepare('UPDATE generated_skins SET description_requested=false').run();
    await f.store.tick(); assert.equal(calls, 0);
    assert.equal(await f.store.appearanceContext('alice'), null);
    await f.store.tick(); assert.equal(calls, 1);
    assert.equal((await f.store.appearanceContext('alice'))?.description, 'Бродяга в дырявой шапке');
    assert.deepEqual(f.payments, ['reserve', 'capture']);
  } finally { await f.store.drain(); await f.db.close(); }
});
