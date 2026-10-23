import { PostgresDatabase } from '../../server/database';
import { rejectedStore } from './helpers/rejected-store';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NilePlayLedger, validateNilePlayConfig, type NilePlayConfig } from '../../server/finance/nile-play-ledger';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN } from '../../server/finance/nile-test-ledger';
import { nilePublicKeyAddress } from '../../server/finance/nile-address';
import { NILE_GENESIS, type TronBlock } from '../../server/finance/tron-protocol';
import { NILE_ORIGINS } from '../../server/finance/tron-rpc';
import { playTestConfig, playTestSetup, block } from './helpers/nile-play-fixture';

test('source freshness is recorded after the full source audit finishes', async () => {
    const c = await playTestSetup(':memory:');
    try {
        const audit = c.source.audit.bind(c.source); let finished = 0;
        c.source.audit = async () => { const result = await audit(); await new Promise(resolve => setTimeout(resolve, 25)); finished = Date.now(); return result; };
        await c.ledger.sync(c.source, await c.reconciliation());
        assert.ok(Number((await c.ledger.state()).source_at) >= finished);
        assert.equal(await c.ledger.isReady(), true);
    } finally { await c.close(); }
});
test('only confirmed deposits fund the player and reserve; importing twice and restarting do not mint tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'royal-play-')), file = join(dir, 'play.sqlite'), c = await playTestSetup(file);
    const owner = randomUUID();
    try {
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        assert.equal((await c.ledger.wallet(owner) as any).balanceUnits, '200000000');
        assert.equal((await c.ledger.audit()).houseUnits, '800000000');
        assert.equal(await c.ledger.sync(c.source, await c.reconciliation()), 0);
        await c.ledger.close();
        c.ledger = new NilePlayLedger(file, playTestConfig);
        await c.ledger.ready;
        assert.equal((await c.ledger.audit()).totalUnits, '1000000000');
        assert.equal((await c.ledger.wallet(owner) as any).balanceUnits, '200000000');
        assert.equal((await c.source.snapshot('player')).availableUnits, '1000000000');
        assert.equal((await c.source.snapshot('player')).spendable, false);
        await c.source.ingest(block(101, '1234567'));
        assert.equal(await c.ledger.sync(c.source, await c.reconciliation()), 1);
        assert.equal((await c.ledger.wallet(owner) as any).balanceUnits, '201234567');
        assert.equal((await c.ledger.audit()).houseUnits, '800000000');
    }
    finally {
        await c.source.close();
        await c.ledger.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('wins, losses and refunds conserve backing; retrying a committed round preserves the outcome after a lost response', async () => {
    let numbers = [0, 0, 0, 0, 1, 2, 1, 1, 2], draws = 0;
    const c = await playTestSetup(':memory:', () => { draws++; return numbers.shift()!; });
    try {
        const owner = randomUUID();
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        const request = { id: randomUUID(), stakeUnits: '10000000' }, win = await c.ledger.spin(owner, request);
        assert.equal(win.round.payoutUnits, '120000000');
        assert.equal((win.wallet as any).balanceUnits, '310000000');
        assert.equal((await c.ledger.audit()).houseUnits, '690000000');
        await c.ledger.failure('offline');
        const replay = await c.ledger.spin(owner, request);
        assert.equal(replay.replayed, true);
        assert.deepEqual(replay.round, win.round);
        assert.equal(draws, 3);
        await assert.rejects(async () => await c.ledger.spin(owner, { ...request, stakeUnits: '1000000' }), /play_idempotency_conflict/);
        await c.ledger.sync(c.source, await c.reconciliation());
        const loss = await c.ledger.spin(owner, { id: randomUUID(), stakeUnits: '1000000' });
        assert.equal(loss.round.payoutUnits, '0');
        const refund = await c.ledger.spin(owner, { id: randomUUID(), stakeUnits: '2000000' });
        assert.equal(refund.round.payoutUnits, '2000000');
        const audit = await c.ledger.audit();
        assert.equal(audit.rounds, 3);
        assert.equal(BigInt(audit.playerUnits) + BigInt(audit.houseUnits), 1000000000n);
    }
    finally {
        await c.close();
    }
});
test('insolvency and insufficient balances reject before RNG; stale sources and manipulated payouts cannot place bets', async () => {
    let draws = 0;
    const config = { ...playTestConfig, initialReserveUnits: '0' }, c = await playTestSetup(':memory:', () => { draws++; return 0; }, config);
    try {
        const owner = randomUUID();
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        await assert.rejects(async () => await c.ledger.spin(owner, { id: randomUUID(), stakeUnits: '1000000' }), /play_reserve_insufficient/);
        assert.equal(draws, 0);
        for (const value of [{ id: randomUUID(), stakeUnits: '1000000', payoutUnits: '999999' }, { id: randomUUID(), stakeUnits: '1' }, { id: randomUUID(), stakeUnits: 1000000 }, { id: randomUUID(), stakeUnits: '-1000000' }])
            await assert.rejects(async () => await c.ledger.spin(owner, value), /invalid_play_request/);
        await c.ledger.db.exec('UPDATE state SET source_at=1');
        await assert.rejects(async () => await c.ledger.spin(owner, { id: randomUUID(), stakeUnits: '1000000' }), /play_source_not_ready/);
        assert.equal((await c.ledger.audit()).rounds, 0);
    }
    finally {
        await c.close();
    }
    const small = await playTestSetup(':memory:', () => { draws++; return 0; }, playTestConfig, '801000000');
    try {
        const owner = randomUUID();
        await small.ledger.claim(owner, await small.ledger.invite('player'));
        await assert.rejects(async () => await small.ledger.spin(owner, { id: randomUUID(), stakeUnits: '10000000' }), /play_insufficient_balance/);
        assert.equal(draws, 0);
    }
    finally {
        await small.close();
    }
});
test('an invitation can assign only one owner; expired and house invitations reject without leaking another wallet', async () => {
    const c = await playTestSetup();
    try {
        const owner = randomUUID(), other = randomUUID(), code = await c.ledger.invite('player');
        assert.equal((await c.ledger.claim(owner, code)).state, 'assigned');
        assert.equal((await c.ledger.claim(owner, code)).state, 'assigned');
        await assert.rejects(async () => await c.ledger.claim(other, code), /invalid_play_invite/);
        await assert.rejects(async () => await c.ledger.invite('player'), /play_already_assigned/);
        await assert.rejects(async () => await c.ledger.invite('reserve'), /invalid_invite_user/);
        assert.equal((await c.ledger.wallet(other)).state, 'unassigned');
        assert.equal((await c.ledger.audit()).bindings, 1);
    }
    finally {
        await c.close();
    }
    const expired = await playTestSetup();
    try {
        const code = await expired.ledger.invite('player', Date.now() - 86400001);
        await assert.rejects(async () => await expired.ledger.claim(randomUUID(), code), /invalid_play_invite/);
    }
    finally {
        await expired.close();
    }
});
test('atomic write failure leaves the round and every journal entry unchanged, then the same ID succeeds', async () => {
    const c = await playTestSetup();
    try {
        const owner = randomUUID(), req = { id: randomUUID(), stakeUnits: '1000000' };
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        await c.ledger.db.exec("CREATE OR REPLACE FUNCTION injected_failure_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.line=3 THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER injected_failure BEFORE INSERT ON entries FOR EACH ROW EXECUTE FUNCTION injected_failure_fn();");
        await assert.rejects(async () => await c.ledger.spin(owner, req), /injected/);
        await c.ledger.db.exec('DROP TRIGGER injected_failure ON entries');
        assert.equal((await c.ledger.audit()).rounds, 0);
        assert.equal((await c.ledger.wallet(owner) as any).balanceUnits, '200000000');
        assert.equal((await c.ledger.spin(owner, req)).replayed, false);
        assert.equal((await c.ledger.audit()).rounds, 1);
    }
    finally {
        await c.close();
    }
});
test('BigInt balances remain exact and an isolated restored database audits without access to the deposit journal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'royal-play-large-')), config = { ...playTestConfig, initialReserveUnits: '0' }, amount = '999999999999999999999999999999';
    const c = await playTestSetup(':memory:', () => 0, config, amount, amount);
    try {
        const owner = randomUUID();
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        await c.ledger.spin(owner, { id: randomUUID(), stakeUnits: '1000000' });
        assert.equal((await c.ledger.wallet(owner) as any).balanceUnits, (BigInt(amount) + 11000000n).toString());
        const file = join(dir, 'copy.pg.json');
        await c.ledger.db.snapshot(file);
        const database = await PostgresDatabase.restore(file);
        const restored = new NilePlayLedger(database.schema, config, true, undefined, undefined, database);
        await restored.ready;
        try {
            assert.equal((await restored.audit()).totalUnits, (BigInt(amount) * 2n).toString());
            assert.equal((await restored.audit()).rounds, 1);
        }
        finally {
            await database.dropSchema();
            await restored.close();
        }
    }
    finally {
        await c.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('wrong networks, changed immutable configuration and corrupt entries fail a full restore audit', async () => {
    assert.throws(() => validateNilePlayConfig({ ...playTestConfig, source: { ...playTestConfig.source, network: 'mainnet' } }));
    const dir = mkdtempSync(join(tmpdir(), 'royal-play-corrupt-')), file = join(dir, 'play.sqlite'), c = await playTestSetup(file);
    try {
        await assert.rejects(async () => await c.ledger.db.exec("UPDATE entries SET units='1'"), /immutable/);
        await assert.rejects(async () => await c.ledger.db.exec("UPDATE state SET config='{}'"), /sealed/);
        await rejectedStore(() => new NilePlayLedger(file, { ...playTestConfig, initialReserveUnits: '0' }, true), /saved_play_config_mismatch/);
        await c.ledger.db.exec("DROP TRIGGER \"immutable_entries_UPDATE\" ON entries; UPDATE entries SET units='1' WHERE account='house'");
        await assert.rejects(async () => await c.ledger.audit(), /play_journal_corrupted/);
    }
    finally {
        await c.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('an unhealthy reconciliation or source mismatch cannot import deposits or unblock new stakes', async () => {
    const c = await playTestSetup();
    try {
        for (const change of [{ ok: false }, { network: 'mainnet' }, { spendable: true }, { credits: 0 }, { liabilitiesUnits: '0' }, { deficitUnits: '1' }, { checked_at: new Date(Date.now() - 600001).toISOString() }])
            await assert.rejects(async () => await c.ledger.sync(c.source, { ...await c.reconciliation(), ...change }), /play_source_not_ready/);
        await c.source.failure('reader_offline');
        await assert.rejects(async () => await c.ledger.sync(c.source, await c.reconciliation()), /play_source_not_ready/);
        assert.equal((await c.ledger.audit()).credits, 1);
    }
    finally {
        await c.close();
    }
});
test('operator reserve allocation is balanced, recorded once and inaccessible after a wallet has an owner', async () => {
    const config = { ...playTestConfig, initialReserveUnits: '0' }, c = await playTestSetup(':memory:', () => 0, config);
    try {
        assert.deepEqual(await c.ledger.allocateReserve('player', '800000000'), { ok: true, houseUnits: '800000000', playerUnits: '200000000' });
        assert.equal((await c.ledger.audit()).totalUnits, '1000000000');
        await assert.rejects(async () => await c.ledger.allocateReserve('player', '1'), /reserve_already_started/);
        const owner = randomUUID();
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        assert.equal((await c.ledger.wallet(owner) as any).reserveAllocatedUnits, '800000000');
        await assert.rejects(async () => await c.ledger.allocateReserve('player', '1'), /reserve_requires_unassigned_wallet/);
        assert.equal((await c.ledger.spin(owner, { id: randomUUID(), stakeUnits: '1000000' })).round.payoutUnits, '12000000');
        assert.equal((await c.ledger.audit()).rounds, 1);
    }
    finally {
        await c.close();
    }
});
test('a committed round survives process restart and cannot be charged again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'royal-play-restart-')), file = join(dir, 'play.sqlite'), c = await playTestSetup(file), owner = randomUUID(), request = { id: randomUUID(), stakeUnits: '5000000' };
    try {
        await c.ledger.claim(owner, await c.ledger.invite('player'));
        const first = await c.ledger.spin(owner, request);
        await c.ledger.close();
        c.ledger = new NilePlayLedger(file, playTestConfig, false, () => { throw new Error('must not draw again'); });
        await c.ledger.ready;
        const retry = await c.ledger.spin(owner, request);
        assert.equal(retry.replayed, true);
        assert.deepEqual(retry.round, first.round);
        assert.equal((retry.wallet as any).balanceUnits, (first.wallet as any).balanceUnits);
        assert.equal((await c.ledger.audit()).rounds, 1);
    }
    finally {
        await c.source.close();
        await c.ledger.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
