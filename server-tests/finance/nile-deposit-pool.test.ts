import { rejectedStore } from './helpers/rejected-store';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NileTestLedger } from '../../server/finance/nile-test-ledger';
import { NilePlayLedger } from '../../server/finance/nile-play-ledger';
import { validateNileDepositPool } from '../../server/finance/nile-deposit-pool';
import { block, playTestConfig } from './helpers/nile-play-fixture';
import { customerPool } from './helpers/nile-pool-fixture';
async function reconciliation(source: NileTestLedger) { const audit = await source.audit(); return { ok: true, checked_at: new Date().toISOString(), network: 'nile', asset: 'USDT_NILE_TEST', testOnly: true, spendable: false, poolSha256: audit.poolSha256 ?? null, credits: audit.credits, liabilitiesUnits: audit.balances.reduce((s, a) => s + BigInt(a.availableUnits), 0n).toString(), deficitUnits: '0' }; }
test('existing journals keep their configuration, deposits and private invitation owner when a pool is added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nile-pool-migration-')), config = { ...playTestConfig, initialReserveUnits: '0' };
    let source = new NileTestLedger(join(dir, 'source.sqlite'), config.source), play = new NilePlayLedger(join(dir, 'play.sqlite'), config);
    await source.ready;
    await play.ready;
    const oldOwner = randomUUID();
    await source.ingest(block(99), true);
    await source.ingest(block(100, '1000000000'));
    await play.sync(source, await reconciliation(source));
    await play.claim(oldOwner, await play.invite('player'));
    const sourceBefore = await source.db.prepare('SELECT * FROM credits').all(), eventsBefore = await play.db.prepare('SELECT * FROM events').all();
    await source.close();
    await play.close();
    try {
        source = new NileTestLedger(join(dir, 'source.sqlite'), config.source, false, customerPool);
        await source.ready;
        play = new NilePlayLedger(join(dir, 'play.sqlite'), config, false, () => 0, customerPool);
        await play.ready;
        await source.success();
        await play.sync(source, await reconciliation(source));
        assert.deepEqual(await source.db.prepare('SELECT * FROM credits').all(), sourceBefore);
        assert.deepEqual(await play.db.prepare('SELECT * FROM events').all(), eventsBefore);
        assert.equal((await play.provision(oldOwner) as any).balanceUnits, '1000000000');
        assert.equal((await play.audit()).autoBindings, 0);
        const owner = randomUUID(), other = randomUUID(), wallet = await play.provision(owner) as any;
        assert.equal(wallet.balanceUnits, '0');
        assert.equal((await play.provision(owner)).state, 'assigned');
        assert.equal((await play.provision(owner) as any).address, wallet.address);
        assert.notEqual((await play.provision(other) as any).address, wallet.address);
        assert.equal((await play.wallet(other) as any).balanceUnits, '0');
        await source.ingest(block(101, '1000000000', config.source.addresses[1].address));
        await source.ingest(block(102, '125000000', customerPool.addresses[0].address));
        await play.sync(source, await reconciliation(source));
        await play.sync(source, await reconciliation(source));
        assert.equal((await play.wallet(owner) as any).balanceUnits, '125000000');
        const request = { id: randomUUID(), stakeUnits: '1000000' }, round = await play.spin(owner, request);
        assert.equal(round.round.payoutUnits, '12000000');
        assert.equal((round.wallet as any).balanceUnits, '136000000');
        assert.equal((await play.wallet(other) as any).balanceUnits, '0');
        assert.equal((await play.audit()).totalUnits, '2125000000');
        assert.equal((await play.spin(owner, request)).replayed, true);
        await play.close();
        play = new NilePlayLedger(join(dir, 'play.sqlite'), config, false, () => { throw Error('no new draw'); }, customerPool);
        await play.ready;
        assert.equal((await play.spin(owner, request)).replayed, true);
        await rejectedStore(() => new NilePlayLedger(join(dir, 'play.sqlite'), config, true), /deposit_pool_pin_mismatch/);
    }
    finally {
        await source.close();
        await play.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('pre-funded addresses are quarantined, pool exhaustion and stale source cannot allocate or mint', async () => {
    const config = { ...playTestConfig, initialReserveUnits: '0' }, source = new NileTestLedger(':memory:', config.source, false, customerPool), play = new NilePlayLedger(':memory:', config, false, undefined, customerPool);
    await source.ready;
    await play.ready;
    try {
        await source.ingest(block(99), true);
        await source.ingest(block(100));
        await source.ingest(block(101, '1000000', customerPool.addresses[0].address));
        await play.sync(source, await reconciliation(source));
        const a = randomUUID(), b = randomUUID();
        assert.equal((await play.provision(a) as any).balanceUnits, '0');
        assert.notEqual((await play.provision(a) as any).address, customerPool.addresses[0].address);
        await play.provision(b);
        await assert.rejects(async () => await play.provision(randomUUID()), /play_deposit_pool_exhausted/);
        assert.equal((await play.audit()).totalUnits, '1000000');
        await play.failure('offline');
        assert.equal((await play.provision(a)).state, 'assigned');
        await assert.rejects(async () => await play.spin(a, { id: randomUUID(), stakeUnits: '1000000' }), /play_source_not_ready/);
        await assert.rejects(async () => await play.db.exec('DELETE FROM auto_bindings'), /immutable wallet owner/);
        await assert.rejects(async () => await source.db.exec('UPDATE deposit_pool SET manifest=\'{}\''), /sealed deposit pool/);
    }
    finally {
        await source.close();
        await play.close();
    }
});
test('pool manifest rejects repeated addresses and mismatched networks or public keys', () => {
    assert.throws(() => validateNileDepositPool({ ...customerPool, network: 'mainnet' }, playTestConfig.source.addresses, 100));
    assert.throws(() => validateNileDepositPool({ ...customerPool, addresses: [customerPool.addresses[0], customerPool.addresses[0]] }, playTestConfig.source.addresses, 100));
    assert.throws(() => validateNileDepositPool({ ...customerPool, addresses: [{ ...customerPool.addresses[0], address: customerPool.addresses[1].address }] }, playTestConfig.source.addresses, 100));
});
test('future pools cannot assign an address before the observed journal reaches activation', async () => {
    const pool = { ...customerPool, startHeight: 102 }, config = { ...playTestConfig, initialReserveUnits: '0' };
    const source = new NileTestLedger(':memory:', config.source, false, pool), play = new NilePlayLedger(':memory:', config, false, undefined, pool);
    await source.ready;
    await play.ready;
    try {
        await source.ingest(block(99), true);
        await source.ingest(block(100));
        await play.sync(source, await reconciliation(source));
        const owner = randomUUID();
        await assert.rejects(async () => await play.provision(owner), /play_deposit_unavailable/);
        assert.equal((await play.audit()).autoBindings, 0);
        await source.ingest(block(101));
        await play.sync(source, await reconciliation(source));
        assert.equal((await play.provision(owner)).state, 'assigned');
        assert.equal((await play.audit()).autoBindings, 1);
    }
    finally {
        await source.close();
        await play.close();
    }
});
