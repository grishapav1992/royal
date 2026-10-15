import { rejectedStore } from './helpers/rejected-store';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN, validateNileTestConfig, type NileTestConfig } from '../../server/finance/nile-test-ledger';
import { creditNileObservedBlocks } from '../../server/finance/nile-test-creditor';
import { nileBase58, nileHex, nilePublicKeyAddress } from '../../server/finance/nile-address';
import { snapshotNileTestLedger, verifyNileTestSnapshot } from '../../server/finance/nile-test-snapshot';
import { NILE_GENESIS, type TronBlock, type TronTransfer } from '../../server/finance/tron-protocol';
import { NILE_ORIGINS } from '../../server/finance/tron-rpc';
import { TronReadStore } from '../../server/finance/tron-store';
function account(userId: string, number: number) {
    const key = createECDH('secp256k1');
    key.setPrivateKey(Buffer.from(number.toString(16).padStart(64, '0'), 'hex'));
    const publicKey = key.getPublicKey('hex', 'uncompressed');
    return { userId, address: nilePublicKeyAddress(publicKey), publicKey };
}
const alice = account('alice', 1), bob = account('bob', 2), external = account('sender', 3);
const config: NileTestConfig = { version: 1, network: 'nile', genesis: NILE_GENESIS, token: NILE_TEST_TOKEN, scale: 6, asset: NILE_TEST_ASSET,
    startHeight: 100, readerStartHeight: 100, origins: [...NILE_ORIGINS], addresses: [alice, bob] };
const hash = (height: number, suffix = 'a') => height.toString(16).padStart(16, '0') + suffix.repeat(48);
const txId = (number: number) => number.toString(16).padStart(64, '0');
const event = (number: number, changes: Partial<TronTransfer> = {}): TronTransfer => ({ txId: txId(number), logIndex: 0,
    contract: NILE_TEST_TOKEN, from: external.address, to: alice.address, amountUnits: '1000001', ...changes });
const block = (height: number, transfers: TronTransfer[] = [], suffix = 'a'): TronBlock => ({ height, hash: hash(height, suffix), parentHash: hash(height - 1),
    timestamp: Date.now(), txIds: [...new Set(transfers.map(row => row.txId))],
    outcomes: [...new Set(transfers.map(row => row.txId))].map(txId => ({ txId, status: 'SUCCESS' })), transfers });
async function setup(file = ':memory:', readerFile = ':memory:') {
    const ledger = new NileTestLedger(file, config), reader = new TronReadStore(readerFile, { network: 'nile', startHeight: 100, origins: [...NILE_ORIGINS] });
    await ledger.ready;
    await reader.ready;
    await reader.acquire('reader');
    await reader.commit('reader', block(99), true);
    await reader.commit('reader', block(100, [event(1)]));
    await reader.success('reader', 100);
    return { ledger, reader, close: async () => { await ledger.close(); await reader.close(); } };
}
test('TRON address vectors, checksum and curve validation; one immutable test contract', () => {
    assert.equal(alice.address, '417e5f4552091a69125d5dfcb7b8c2659029395bdf');
    assert.equal(nileHex('TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'), NILE_TEST_TOKEN);
    assert.equal(nileHex(nileBase58(alice.address)), alice.address);
    assert.throws(() => nileHex('TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBa'));
    assert.throws(() => nilePublicKeyAddress('04' + '00'.repeat(64)));
    for (const change of [{ network: 'mainnet' }, { scale: 18 }, { token: alice.address }, { genesis: hash(0) }, { asset: 'USDT_SIM' }, { extra: 1 },
        { addresses: [alice, alice] }, { addresses: [{ ...alice, address: bob.address }] }, { origins: [NILE_ORIGINS[0], NILE_ORIGINS[0]] }]) {
        assert.throws(() => validateNileTestConfig({ ...config, ...change }));
    }
});
test('confirmed test deposit and two balanced entries commit once, including restart after lost response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nile-ledger-')), file = join(dir, 'ledger.sqlite');
    const context = await setup(file);
    try {
        assert.equal((await creditNileObservedBlocks(context.ledger, context.reader)).credits, 1);
        await context.ledger.close();
        context.ledger = new NileTestLedger(file, config);
        await context.ledger.ready;
        assert.equal((await creditNileObservedBlocks(context.ledger, context.reader)).credits, 0);
        assert.equal((await context.ledger.snapshot('alice')).availableUnits, '1000001');
        assert.equal((await context.ledger.snapshot('bob')).availableUnits, '0');
        assert.equal((await context.ledger.snapshot('alice')).spendable, false);
        assert.equal((await context.ledger.audit()).totalUnits, '0');
    }
    finally {
        await context.ledger.close();
        await context.reader.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('unknown tokens, unknown recipients, mint, zero and custody transfers cannot create a claim', async () => {
    const context = await setup();
    try {
        await creditNileObservedBlocks(context.ledger, context.reader);
        await context.reader.commit('reader', block(101, [event(2, { contract: external.address }), event(3, { to: external.address }),
            event(4, { from: '410000000000000000000000000000000000000000' }), event(5, { amountUnits: '0' }), event(6, { from: bob.address }),
            event(7, { to: bob.address, amountUnits: '7' })]));
        await context.reader.success('reader', 101);
        assert.equal((await creditNileObservedBlocks(context.ledger, context.reader)).credits, 1);
        assert.equal((await context.ledger.snapshot('alice')).availableUnits, '1000001');
        assert.equal((await context.ledger.snapshot('bob')).availableUnits, '7');
        assert.equal((await context.ledger.audit()).credits, 2);
    }
    finally {
        await context.close();
    }
});
test('amounts above JS safe integer remain exact; uint256 overflow and failed receipt are rejected', async () => {
    const ledger = new NileTestLedger(':memory:', config);
    await ledger.ready;
    try {
        await ledger.ingest(block(99), true);
        const amount = '999999999999999999999999999999';
        await ledger.ingest(block(100, [event(1, { amountUnits: amount })]));
        assert.equal((await ledger.snapshot('alice')).availableUnits, amount);
        assert.equal((await ledger.audit()).credits, 1);
        await assert.rejects(async () => await ledger.ingest(block(101, [event(2, { amountUnits: (2n ** 256n).toString() })])));
        const failed = block(101, [event(2)]);
        failed.outcomes[0].status = 'REVERT';
        await assert.rejects(async () => await ledger.ingest(failed));
        assert.equal((await ledger.state()).cursor_height, 100);
    }
    finally {
        await ledger.close();
    }
});
test('partial write failure rolls back block, credit, entries and cursor together', async () => {
    const context = await setup();
    try {
        await context.ledger.db.exec("CREATE OR REPLACE FUNCTION injected_failure_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account='user:alice' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER injected_failure BEFORE INSERT ON entries FOR EACH ROW EXECUTE FUNCTION injected_failure_fn();");
        await assert.rejects(async () => await creditNileObservedBlocks(context.ledger, context.reader));
        assert.equal((await context.ledger.db.prepare('SELECT count(*) AS n FROM credits').get())!.n, 0);
        assert.equal((await context.ledger.state()).cursor_height, 99);
        assert.equal((await context.ledger.audit()).credits, 0);
        await context.ledger.db.exec('DROP TRIGGER injected_failure ON entries');
        assert.equal((await creditNileObservedBlocks(context.ledger, context.reader)).credits, 1);
    }
    finally {
        await context.close();
    }
});
test('a stale, errored or halted reader cannot authorize new credits', async () => {
    for (const sql of ["UPDATE reader_state SET last_success_at=1", "UPDATE reader_state SET last_error='rpc_unavailable'",
        "UPDATE reader_state SET halted_reason='finalized_block_changed'", 'UPDATE reader_state SET finalized_height=99', 'UPDATE reader_state SET finalized_height=1000']) {
        const context = await setup();
        try {
            await context.reader.db.exec(sql);
            await assert.rejects(async () => await creditNileObservedBlocks(context.ledger, context.reader));
            assert.equal((await context.ledger.snapshot('alice')).availableUnits, '0');
        }
        finally {
            await context.close();
        }
    }
});
test('saved history changes cause a durable halt before processing another deposit', async () => {
    const context = await setup();
    try {
        await creditNileObservedBlocks(context.ledger, context.reader);
        await context.reader.db.exec("DROP TRIGGER protected_blocks_update ON blocks; UPDATE blocks SET payload_sha256='bad' WHERE height=100; UPDATE reader_state SET last_error='rpc_unavailable';");
        await assert.rejects(async () => await creditNileObservedBlocks(context.ledger, context.reader));
        assert.equal((await context.ledger.state()).halted_reason, 'test_chain_changed');
        await assert.rejects(async () => await context.ledger.db.exec('UPDATE state SET halted_reason=NULL'));
        assert.equal((await context.ledger.snapshot('alice')).availableUnits, '1000001');
    }
    finally {
        await context.close();
    }
});
test('restarting the real CLI with a corrupted source durably blocks credits even after the source is repaired', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nile-cli-')), file = join(dir, 'ledger.sqlite'), readerFile = join(dir, 'reader.sqlite');
    const context = await setup(file, readerFile), configFile = join(dir, 'config.json');
    try {
        await creditNileObservedBlocks(context.ledger, context.reader);
        await context.ledger.close();
        const sha = (await context.reader.db.prepare('SELECT payload_sha256 FROM blocks WHERE height=100').get())!.payload_sha256;
        await context.reader.db.exec("DROP TRIGGER protected_blocks_update ON blocks; UPDATE blocks SET payload_sha256='bad' WHERE height=100;");
        writeFileSync(configFile, JSON.stringify(config));
        const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/finance-nile-creditor.ts', 'once'], {
            encoding: 'utf8', timeout: 20000, env: { ...process.env, NILE_TEST_MODE: 'testnet-only', NILE_TEST_NETWORK: 'nile',
                NILE_TEST_CONFIG_FILE: configFile, NILE_TEST_SCHEMA: context.ledger.db.schema, TRON_READER_SCHEMA: context.reader.db.schema },
        });
        assert.equal(run().status, 1);
        await context.reader.db.prepare('UPDATE blocks SET payload_sha256=? WHERE height=100').run(sha);
        await context.reader.commit('reader', block(101, [event(2)]));
        await context.reader.success('reader', 101);
        assert.equal(run().status, 1);
        context.ledger = new NileTestLedger(file, config);
        await context.ledger.ready;
        assert.equal((await context.ledger.state()).halted_reason, 'test_source_corrupted');
        assert.equal((await context.ledger.snapshot('alice')).availableUnits, '1000001');
        assert.equal((await context.ledger.audit()).credits, 1);
    }
    finally {
        await context.ledger.close();
        await context.reader.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('SQL mutations, reassignment and an unbacked entry fail; full reconciliation catches missing entries', async () => {
    const context = await setup();
    try {
        await creditNileObservedBlocks(context.ledger, context.reader);
        for (const sql of ["UPDATE addresses SET user_id='bob' WHERE user_id='alice'", 'DELETE FROM credits', 'DELETE FROM entries', 'UPDATE state SET config=\'{}\'',
            "INSERT INTO entries VALUES('" + txId(1) + "',0,'attacker','1000001')"])
            await assert.rejects(async () => await context.ledger.db.exec(sql));
        await context.ledger.db.exec("DROP TRIGGER \"immutable_entries_DELETE\" ON entries; DELETE FROM entries WHERE account='external'");
        await assert.rejects(async () => await context.ledger.audit());
    }
    finally {
        await context.close();
    }
});
test('audits reconcile events on both sides of page boundaries and detect a missing entry in the final page', async () => {
    const ledger = new NileTestLedger(':memory:', config);
    const reader = new TronReadStore(':memory:', { network: 'nile', startHeight: 100, origins: [...NILE_ORIGINS] });
    await ledger.ready;
    await reader.ready;
    const amount = '9007199254740993';
    const boundaryHeights = new Set([226, 227, 354, 355]);
    const history = Array.from({ length: 260 }, (_, index) => {
        const height = index + 99;
        const events = boundaryHeights.has(height) ? [event(height, { amountUnits: amount })] : [];
        if (height === 355)
            events.push(event(height, { logIndex: 1, to: bob.address, amountUnits: '7' }));
        return block(height, events);
    });
    try {
        await reader.acquire('reader');
        await reader.db.transaction(async () => {
            for (const row of history)
                await reader.commit('reader', row, row.height === 99);
        });
        await ledger.db.transaction(async () => {
            for (const row of history)
                await ledger.ingest(row, row.height === 99);
        });
        const readerAudit = await reader.audit(), ledgerAudit = await ledger.audit();
        assert.equal(readerAudit.blocks, history.length);
        assert.equal(readerAudit.transfers, 5);
        assert.equal(readerAudit.cursorHeight, 358);
        assert.equal(ledgerAudit.blocks, history.length);
        assert.equal(ledgerAudit.credits, 5);
        assert.equal(ledgerAudit.cursorHeight, 358);
        assert.equal(ledgerAudit.balances.find(row => row.userId === 'alice')!.availableUnits, (4n * BigInt(amount)).toString());
        assert.equal(ledgerAudit.balances.find(row => row.userId === 'bob')!.availableUnits, '7');
        await reader.db.exec('DROP TRIGGER protected_transfers_delete ON transfers');
        await reader.db.prepare('DELETE FROM transfers WHERE tx_id=? AND log_index=1').run(txId(355));
        await assert.rejects(reader.audit(), /saved_event_mismatch/);
        await ledger.db.exec('DROP TRIGGER "immutable_entries_DELETE" ON entries');
        await ledger.db.prepare("DELETE FROM entries WHERE tx_id=? AND log_index=1 AND account='external'").run(txId(355));
        await assert.rejects(ledger.audit(), /test_ledger_corrupted/);
    }
    finally {
        await ledger.close();
        await reader.close();
    }
});
test('bounded batches resume, concurrent writers cannot replay a committed block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nile-concurrency-')), context = await setup(join(dir, 'ledger.sqlite'));
    const second = new NileTestLedger(context.ledger.file, config);
    await second.ready;
    try {
        await context.reader.commit('reader', block(101, [event(2)]));
        await context.reader.success('reader', 101);
        assert.equal((await creditNileObservedBlocks(context.ledger, context.reader, 1)).credits, 1);
        assert.equal((await creditNileObservedBlocks(second, context.reader, 1)).credits, 1);
        await assert.rejects(async () => await context.ledger.ingest(block(101, [event(2)])));
        assert.equal((await context.ledger.snapshot('alice')).availableUnits, '2000002');
        assert.equal((await context.ledger.audit()).credits, 2);
    }
    finally {
        await second.close();
        await context.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('validated snapshot restores the exact balance; changed checksum and schema config fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nile-backup-')), context = await setup(join(dir, 'ledger.sqlite'));
    try {
        await creditNileObservedBlocks(context.ledger, context.reader);
        const saved = await snapshotNileTestLedger(context.ledger, join(dir, 'backups'));
        const verified = await verifyNileTestSnapshot(join(dir, 'backups', saved.file), config, saved.sha256);
        assert.equal(verified.balances[0].availableUnits, '1000001');
        assert.equal(verified.credits, 1);
        await assert.rejects(verifyNileTestSnapshot(join(dir, 'backups', saved.file), config, '0'.repeat(64)));
        await rejectedStore(() => new NileTestLedger(context.ledger.file, { ...config, startHeight: 101 }, true));
    }
    finally {
        await context.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
