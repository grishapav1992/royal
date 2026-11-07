import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { auditCleanupSourceRelations, inspectAuditCleanupSources } from '../server/audit/cleanup-guards';
import { AuditDatasets } from '../server/audit/datasets';
import { cryptoConfig } from '../server/crypto/config';
import { NowPayments } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PaymentCredits } from '../server/payments/credits';
import { PaymentOutbox } from '../server/payments/outbox';
import { SandboxPaymentStore } from '../server/payments/sandbox';
import { SandboxNowPayments, sandboxConfig } from '../server/payments/sandbox-provider';
import { TelegramBot, telegramStarsConfig } from '../server/payments/telegram-provider';
import { TelegramStarsStore } from '../server/payments/telegram-stars';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { CommonSkinPayments } from '../server/skinPayments';

async function fixture(t: TestContext, withPayments = false) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const payments = withPayments ? new PostgresDatabase(':memory:') : undefined;
  const accounts = Array.from({ length: 4 }, () => randomUUID());
  t.after(async () => { await Promise.all([game.close(), audit.close(), payments?.close()]); });
  const bootstrapAccounts = async (db: PostgresDatabase) => {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    for (const account of accounts) await db.prepare('INSERT INTO accounts VALUES (?)').run(account);
  };
  await bootstrapAccounts(game);
  const wallet = new DemoWalletStore(game, () => 0);
  await wallet.ready;
  for (const account of accounts) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const ledger = new VirtualPvpLedger(game, wallet);
  const pvp = new PvpStore(ledger), combat = new NileCombatEscrow(ledger);
  const credits = new PaymentCredits(game, wallet.ready);
  const config = sandboxConfig({ NOWPAYMENTS_SANDBOX_ENABLED: 'true', PUBLIC_ORIGIN: 'https://fixture.invalid',
    NOWPAYMENTS_SANDBOX_API_KEY: 'fixture-only', NOWPAYMENTS_SANDBOX_IPN_SECRET: 'fixture-only-secret' });
  const sandbox = new SandboxPaymentStore(game, config, new SandboxNowPayments(config), wallet.ready);
  await Promise.all([pvp.ready, combat.ready, credits.ready, sandbox.ready]);

  let crypto: CryptoStore | undefined;
  if (payments) {
    await bootstrapAccounts(payments);
    const outbox = new PaymentOutbox(payments, '', '');
    const cryptoSettings = cryptoConfig({});
    crypto = new CryptoStore(payments, cryptoSettings, new NowPayments(cryptoSettings), outbox.ready, undefined, undefined, change => outbox.record(change));
    const stars = telegramStarsConfig({});
    await new TelegramStarsStore(crypto, stars, new TelegramBot(stars)).ready;
  }

  const sources = { game: game.schema, ...(payments ? { payments: payments.schema } : {}) };
  const datasets = new AuditDatasets(audit, sources);
  const open = async () => (await datasets.startTest()).datasetId;
  const inspect = (datasetId: string) => audit.transaction(() => inspectAuditCleanupSources(audit, sources, datasetId), { readOnly: true });
  const hold = (account = 0) => ledger.pvpHold(accounts[account], { matchId: randomUUID(), gameId: 'chess', stakeUnits: '1000000' });
  return { game, audit, payments, crypto, accounts, wallet, ledger, combat, open, inspect, hold, datasets, sources };
}

test('old completed payments, refunds, games and empty scheduled pools allow a stable scoped proof after derived deletion', async t => {
  const f = await fixture(t, true);
  const { accounts, game, audit, payments, crypto, wallet, ledger, sources } = f;
  await crypto!.creditStarsDeposit(accounts[0], randomUUID(), '1000000', randomUUID(), 100);
  await payments!.exec('UPDATE payment_outbox SET delivered_at=1');
  const matchId = randomUUID();
  await ledger.pvpHold(accounts[0], { matchId, gameId: 'chess', stakeUnits: '1000000' }, 1);
  await ledger.pvpFinish(accounts[0], { matchId, winnerId: null, reason: 'cancel' }, 2);
  const minesId = randomUUID();
  await wallet.mines.operate(accounts[1], { id: minesId, action: 'start', amount: 10, mineCount: 3 });
  await wallet.mines.operate(accounts[1], { id: randomUUID(), action: 'reveal', sessionId: minesId, cell: 12 });
  await wallet.mines.operate(accounts[1], { id: randomUUID(), action: 'cashout', sessionId: minesId });
  await wallet.tote.snapshot(accounts[0]);
  await game.prepare(`INSERT INTO nowpayments_sandbox_deposits
    (id,account_id,request_key,amount,scenario,currency,state,credited_units,created_at,updated_at)
    VALUES (?,?,'completed fixture',1,'success','btc','finished',100,1,2)`).run(randomUUID(), accounts[0]);
  await payments!.prepare(`INSERT INTO telegram_stars_orders
    (id,account_id,bot_id,stars,amount_units,state,terms_url,created_at,expires_at,updated_at)
    VALUES (?,?,'fixture',100,1000000,'waiting','https://fixture.invalid',1,2,1)`).run(randomUUID(), accounts[0]);

  const datasetId = await f.open();
  await wallet.operate(accounts[0], { id: randomUUID(), kind: 'deposit', amount: 1 });
  await crypto!.creditStarsDeposit(accounts[1], randomUUID(), '1000000', randomUUID(), 100);
  await payments!.exec('UPDATE payment_outbox SET delivered_at=1');
  await f.datasets.sealTest(datasetId);
  const dry = await f.inspect(datasetId);
  assert.deepEqual(dry.blockers, []);
  assert.match(dry.proof, /^[a-f0-9]{64}$/);
  assert.deepEqual(new Set(dry.refKeys.map(ref => ref.sourceNamespace)), new Set([game.schema + '.demo_ledger', payments!.schema + '.crypto_ledger']));
  assert.equal(dry.refKeys.length, 2);
  assert(!JSON.stringify(dry).includes(accounts[0]));

  const names = await auditCleanupSourceRelations(audit, sources);
  assert.deepEqual(names, [...names].sort());
  assert.ok(names.includes(payments!.schema + '.payment_outbox'));
  assert.ok(names.includes(game.schema + '.payment_credit_wallets'));
  await audit.transaction(async () => {
    await audit.exec('LOCK TABLE ' + names.map(name => name.split('.').map(identifier).join('.')).join(', ') + ' IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    const before = await inspectAuditCleanupSources(audit, sources, datasetId);
    assert.deepEqual(before, dry);
    await audit.prepare('DELETE FROM audit_posting_refs WHERE dataset_id=?').run(datasetId);
    await audit.prepare('DELETE FROM audit_dataset_sources WHERE dataset_id=?').run(datasetId);
    const after = await inspectAuditCleanupSources(audit, sources, datasetId, [...before.refKeys].reverse());
    assert.deepEqual(after.blockers, []);
    assert.equal(after.proof, before.proof);
  });
});

test('reports open canonical obligations and undelivered payment work by source', async t => {
  const f = await fixture(t, true);
  const { game, payments, accounts, wallet } = f;
  const datasetId = await f.open();
  await wallet.mines.operate(accounts[0], { id: randomUUID(), action: 'start', amount: 10, mineCount: 3 });
  await f.hold(0);
  const combatId = randomUUID();
  await f.combat.fund(accounts[2], { id: combatId, accounts: [accounts[2], accounts[3]], stakeUnits: '1000000' });
  await new CommonSkinPayments(game, wallet.ready).skinPurchase(accounts[1], randomUUID(), 'reserve');
  await game.prepare("INSERT INTO capro_pending_balances(account_id,pending_units) VALUES (?,'5')").run(accounts[0]);
  await game.prepare(`INSERT INTO nowpayments_sandbox_deposits
    (id,account_id,request_key,amount,scenario,currency,state,created_at,updated_at)
    VALUES (?,?,'pending fixture',1,'success','btc','credit_pending',1,2)`).run(randomUUID(), accounts[0]);
  await f.crypto!.creditStarsDeposit(accounts[0], randomUUID(), '1000000', randomUUID(), 100);
  await payments!.prepare(`INSERT INTO crypto_operations(id,account_id,kind,request_key,state,amount_units,detail,created_at,updated_at)
    VALUES (?,?,'withdrawal','fixture','review',100,'{}',1,2)`).run(randomUUID(), accounts[0]);
  await payments!.prepare('UPDATE crypto_wallets SET reserved_units=100 WHERE account_id=?').run(accounts[0]);
  await payments!.prepare("INSERT INTO crypto_wallet_holds VALUES (?,?,'fixture hold',1)").run(accounts[0], randomUUID());
  await payments!.prepare(`INSERT INTO telegram_stars_orders
    (id,account_id,bot_id,stars,amount_units,state,terms_url,created_at,expires_at,updated_at)
    VALUES (?,?,'fixture',100,1000000,'checkout','https://fixture.invalid',1,2,1)`).run(randomUUID(), accounts[0]);

  const { blockers } = await f.inspect(datasetId);
  for (const name of [
    ...['demo_mines_sessions', 'virtual_pvp_banks', 'virtual_pvp_holds', 'combat_matches', 'combat_seats',
      'skin_purchases', 'capro_pending_balances', 'nowpayments_sandbox_deposits'].map(table => game.schema + '.' + table),
    ...['crypto_operations', 'crypto_wallet_holds', 'crypto_wallets', 'payment_outbox', 'telegram_stars_orders']
      .map(table => payments!.schema + '.' + table),
  ]) assert(blockers.includes('open-financial-source:' + name), name);
});

test('proof detects wallet, retained operation, ledger boundary and exact middle captured-row changes', async t => {
  const f = await fixture(t);
  const { accounts, wallet, audit, game, sources } = f;
  const datasetId = await f.open();
  for (let i = 0; i < 38; i++) await wallet.operate(accounts[0], { id: randomUUID(), kind: 'deposit', amount: 1 });
  const before = await f.inspect(datasetId);
  assert.deepEqual(before.blockers, []);
  assert.equal(before.refKeys.length, 38);
  const g = identifier(game.schema);
  const selected = before.refKeys[18].rowId;
  const proofAfter = async (mutate: () => Promise<unknown>) => {
    await assert.rejects(audit.transaction(async () => {
      await mutate();
      const checked = await inspectAuditCleanupSources(audit, sources, datasetId, before.refKeys);
      assert.deepEqual(checked.blockers, []);
      assert.notEqual(checked.proof, before.proof);
      throw Error('fixture rollback');
    }), /fixture rollback/);
  };
  await proofAfter(() => audit.prepare(`UPDATE ${g}.demo_wallets SET balance=balance+CASE WHEN account_id=? THEN 1 ELSE -1 END
    WHERE account_id IN (?,?)`).run(accounts[0], accounts[0], accounts[1]));
  await proofAfter(() => audit.prepare(`UPDATE ${g}.demo_operations SET result='{"fixtureChanged":true}'
    WHERE operation_id=(SELECT operation_id FROM ${g}.demo_ledger ORDER BY id LIMIT 1)`).run());
  await proofAfter(() => audit.prepare(`UPDATE ${g}.demo_ledger SET amount_units=amount_units+1 WHERE id=?`).run(selected));
  await proofAfter(() => audit.prepare(`UPDATE ${g}.demo_ledger SET amount_units=amount_units+1
    WHERE id=(SELECT id FROM ${g}.demo_ledger ORDER BY id LIMIT 1)`).run());
  assert.equal((await f.inspect(datasetId)).proof, before.proof);

  await game.prepare('UPDATE demo_ledger SET operation_id=? WHERE id=?').run(randomUUID(), selected);
  assert.ok((await f.inspect(datasetId)).blockers.includes('captured-posting-unavailable:' + game.schema + '.demo_ledger'));
});

test('rejects unexpected source registrations, malformed post-delete reference keys and optional source substitutions', async t => {
  const f = await fixture(t);
  const datasetId = await f.open();
  await f.audit.prepare('INSERT INTO audit_dataset_sources VALUES (?,?)').run(datasetId, f.game.schema + '.outside_source');
  assert.ok((await f.inspect(datasetId)).blockers.includes('dataset-source-set-mismatch'));
  const malformed = await f.audit.transaction(() => inspectAuditCleanupSources(f.audit, f.sources, datasetId,
    [{ sourceNamespace: f.game.schema + '.demo_ledger', rowId: '9223372036854775808' }]), { readOnly: true });
  assert.deepEqual(malformed.blockers, ['posting-reference-invalid']);

  await f.game.exec("UPDATE demo_operations SET result=repeat('x',1048577) WHERE operation_id=(SELECT operation_id FROM demo_operations LIMIT 1)");
  assert.ok((await f.inspect(datasetId)).blockers.includes('retained-proof-limit:' + f.game.schema + '.demo_operations'));
  await f.game.exec('ALTER TABLE nowpayments_sandbox_deposits RENAME TO old_sandbox_source');
  await f.game.exec('CREATE VIEW nowpayments_sandbox_deposits AS SELECT * FROM old_sandbox_source');
  const name = f.game.schema + '.nowpayments_sandbox_deposits';
  assert.ok((await f.inspect(datasetId)).blockers.includes('source-unavailable:' + name));
  assert.ok(!(await auditCleanupSourceRelations(f.audit, f.sources)).includes(name));
});
