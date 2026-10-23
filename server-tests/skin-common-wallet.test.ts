import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { CommonSkinPayments } from '../server/skinPayments';
import { demoBalanceUnits, demoReservedUnits, saveDemoUnits, MAX_DEMO_UNITS } from '../server/demoWalletAmounts';
import { SkinStudioStore } from '../server/skinStudio';
import sharp from 'sharp';

async function fixture(balance = 5000) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,skin INTEGER DEFAULT 0,appearance JSONB); INSERT INTO accounts(id) VALUES ('alice'),('bob')");
  const wallet = new DemoWalletStore(db); await Promise.all([wallet.ready, wallet.expansion.ready]);
  await saveDemoUnits(db, 'alice', balance);
  return { db, wallet, payments: new CommonSkinPayments(db, wallet.ready),
    balance: () => demoBalanceUnits(db, 'alice'), reserved: () => demoReservedUnits(db, 'alice') };
}

test('atelier debits the same wallet as games once and capture never charges again', async () => {
  const f = await fixture(), id = randomUUID();
  try {
    await Promise.all([f.payments.skinPurchase('alice', id, 'reserve'), f.payments.skinPurchase('alice', id, 'reserve')]);
    assert.equal((await f.wallet.snapshot('alice')).balance, 40);
    assert.equal(await f.reserved(), 1000);
    await assert.rejects(() => f.payments.skinPurchase('bob', id, 'capture'));
    await Promise.all([f.payments.skinPurchase('alice', id, 'capture'), f.payments.skinPurchase('alice', id, 'capture')]);
    assert.equal(await f.balance(), 4000); assert.equal(await f.reserved(), 0);
    const entries = (await f.wallet.snapshot('alice')).entries;
    assert.equal(entries.length, 1); assert.equal(entries[0].amount, -10); assert.equal(entries[0].gameName, 'Ателье');
    await assert.rejects(() => f.payments.skinPurchase('alice', id, 'refund'));
  } finally { await f.db.close(); }
});

test('a pending atelier reserves refund capacity and repeated refunds return exactly ten dollars', async () => {
  const f = await fixture(MAX_DEMO_UNITS), id = randomUUID();
  try {
    await f.payments.skinPurchase('alice', id, 'reserve');
    await assert.rejects(() => saveDemoUnits(f.db, 'alice', MAX_DEMO_UNITS));
    await Promise.all([f.payments.skinPurchase('alice', id, 'refund'), f.payments.skinPurchase('alice', id, 'refund')]);
    assert.equal(await f.balance(), MAX_DEMO_UNITS); assert.equal(await f.reserved(), 0);
    assert.equal((await f.wallet.snapshot('alice')).entries.filter(e => e.kind === 'refund').length, 1);
  } finally { await f.db.close(); }
});

test('concurrent purchases cannot overspend a shared balance and insufficient funds leave no debit', async () => {
  const f = await fixture(1500);
  try {
    const attempts = await Promise.allSettled([f.payments.skinPurchase('alice', randomUUID(), 'reserve'), f.payments.skinPurchase('alice', randomUUID(), 'reserve')]);
    assert.equal(attempts.filter(v => v.status === 'fulfilled').length, 1);
    assert.equal(await f.balance(), 500); assert.equal(await f.reserved(), 1000);
    assert.equal((await f.wallet.snapshot('alice')).entries.length, 1);
    await assert.rejects(() => f.payments.skinPurchase('alice', randomUUID(), 'capture'));
    await assert.rejects(() => f.payments.skinPurchase('alice', 'bad-id', 'reserve'));
  } finally { await f.db.close(); }
});

test('provider failure refunds the shared game balance and a complete generation costs ten dollars', async () => {
  const f = await fixture();
  try {
    const png = await sharp({ create: { width: 32, height: 48, channels: 4, background: '#a23f5b' } }).png().toBuffer();
    let fail = true, calls = 0;
    const images = { available: () => true, generate: async () => { calls++; if (fail) throw new Error('provider failed'); return png; } };
    const studio = new SkinStudioStore(f.db, f.payments, images, () => true, () => {});
    const request = () => ({ id: randomUUID(), prompt: 'Гангстер', reference: 'data:image/png;base64,' + png.toString('base64') });
    await studio.create('alice', request()); await studio.tick();
    assert.equal((await studio.snapshot('alice')).job?.state, 'failed');
    assert.equal(await f.balance(), 5000); assert.equal(await f.reserved(), 0);
    fail = false; const before = calls; await studio.create('alice', request()); await studio.tick();
    const result = await studio.snapshot('alice'); assert.equal(result.job?.state, 'ready'); assert.equal(result.job?.variants.length, 3);
    assert.equal(calls - before, 3); assert.equal(await f.balance(), 4000); assert.equal(await f.reserved(), 0);
    await studio.choose('alice', result.job!.id, result.job!.variants[1].id);
    assert.equal((await studio.snapshot('alice')).wardrobe.length, 1); assert.equal(await f.balance(), 4000);
  } finally { await f.db.close(); }
});
