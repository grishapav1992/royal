import { rejectedStore } from './helpers/rejected-store';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PostgresDatabase } from '../../server/database';
import { digest, NILE_GENESIS, normalizeHeader, normalizeTronBlock, TronReadError, type TronBlock } from '../../server/finance/tron-protocol';
import { NILE_ORIGINS, NileRpc, type TronSource } from '../../server/finance/tron-rpc';
import { scanNile } from '../../server/finance/tron-reader';
import { TronReadStore } from '../../server/finance/tron-store';
import { snapshotTronStore, verifyTronSnapshot } from '../../server/finance/tron-snapshot';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/nile-block-71590295.json', import.meta.url), 'utf8'));
const clone = <T>(value: T): T => structuredClone(value);
const code = (expected: string) => (error: unknown) => error instanceof TronReadError && error.code === expected;
const config = { network: 'nile' as const, startHeight: 100, origins: [...NILE_ORIGINS] };
function chain(): TronBlock[] {
    return [99, 100, 101, 102].map((height, n, all) => ({ height, hash: digest('block-' + height),
        parentHash: digest('block-' + (all[n] - 1)), timestamp: Date.now(), txIds: height === 100 ? [digest('tx')] : [],
        outcomes: height === 100 ? [{ txId: digest('tx'), status: 'SUCCESS' }] : [],
        transfers: height === 100 ? [{ txId: digest('tx'), logIndex: 2, contract: '41' + '1'.repeat(40),
                from: '41' + '2'.repeat(40), to: '41' + '3'.repeat(40), amountUnits: '9007199254740993' }] : [] }));
}
function sources(blocks: TronBlock[], tip = blocks.at(-1)!.height): TronSource[] {
    return NILE_ORIGINS.map((origin, n) => ({ id: 'source_' + n, origin, async genesis() { return NILE_GENESIS; },
        async tip() { return clone(blocks.find(block => block.height === tip)!); },
        async block(height) {
            const block = blocks.find(block => block.height === height);
            if (!block)
                throw new TronReadError('rpc_unavailable');
            return clone(block);
        },
    }));
}
test('real Nile fixture verifies block hash, transaction hashes, all receipts and exact Transfer units', () => {
    const normalized = normalizeTronBlock(fixture.block, fixture.receipts, fixture.height);
    assert.equal(normalized.hash, '0000000004446197c617b4d7a372c32d48ecb7de6ac64b3024226bfdfe7ca207');
    assert.equal(normalized.txIds.length, 7);
    assert.deepEqual(normalized.transfers, [{ txId: '796c47381db8be6b63f0ef10c1e345cf815cee8f77688c3c1f4abf2177c03e5f',
            logIndex: 0, contract: '4137349aeb75a32f8c4c090daff376cf975f5d2eba',
            from: '41db2d1e752e98ccad8fe1c63653d77c2555c2439d', to: '41b20fa83a5c80e602c20affbacb80a92eef128615', amountUnits: '9481224000000000000' }]);
    assert.deepEqual(normalizeTronBlock(fixture.block, clone(fixture.receipts).reverse(), fixture.height), normalized);
});
test('changed headers, transaction bytes and partial or foreign receipts fail closed', () => {
    const block = clone(fixture.block);
    block.block_header.raw_data.timestamp++;
    assert.throws(() => normalizeHeader(block), code('invalid_block_hash'));
    assert.throws(() => normalizeHeader(fixture.block, fixture.height + 1), code('wrong_block_height'));
    const bytes = clone(fixture.block);
    bytes.transactions[0].raw_data_hex += '00';
    assert.throws(() => normalizeTronBlock(bytes, fixture.receipts, fixture.height), code('invalid_transaction_hash'));
    assert.throws(() => normalizeTronBlock(fixture.block, fixture.receipts.slice(1), fixture.height), code('incomplete_receipt_set'));
    const receipts = clone(fixture.receipts);
    receipts[0].blockNumber++;
    assert.throws(() => normalizeTronBlock(fixture.block, receipts, fixture.height), code('receipt_block_mismatch'));
});
test('failed execution cannot produce transfers and malformed ABI or an unknown status is rejected', () => {
    const receipts = clone(fixture.receipts), receipt = receipts.find((r: {
        log?: unknown[];
    }) => r.log?.length)!;
    receipt.receipt.result = 'REVERT';
    receipt.result = 'FAILED';
    assert.equal(normalizeTronBlock(fixture.block, receipts, fixture.height).transfers.length, 0);
    receipt.receipt.result = 'FUTURE_STATUS';
    assert.throws(() => normalizeTronBlock(fixture.block, receipts, fixture.height), code('unknown_receipt_status'));
    const malformed = clone(fixture.receipts);
    malformed.find((r: {
        log?: unknown[];
    }) => r.log?.length)!.log[0].topics[1] = 'f'.repeat(64);
    assert.throws(() => normalizeTronBlock(fixture.block, malformed, fixture.height), code('invalid_transfer_log'));
    const nft = clone(fixture.receipts);
    nft.find((r: {
        log?: unknown[];
    }) => r.log?.length)!.log[0].topics.push('0'.repeat(64));
    assert.equal(normalizeTronBlock(fixture.block, nft, fixture.height).transfers.length, 0);
});
test('RPC permits only Nile origins and solidified read methods; redirects and HTTP 200 errors are rejected', async () => {
    assert.throws(() => new NileRpc('mainnet', 'https://api.trongrid.io'), code('nile_rpc_required'));
    const requests: {
        url: string;
        options?: RequestInit;
    }[] = [];
    const fetcher: typeof fetch = async (input, options) => {
        requests.push({ url: String(input), options });
        return new Response(JSON.stringify(String(input).endsWith('gettransactioninfobyblocknum') ? fixture.receipts : fixture.block));
    };
    const source = new NileRpc('mock', NILE_ORIGINS[0], fetcher);
    assert.equal((await source.block(fixture.height)).transfers.length, 1);
    assert.ok(requests.every(r => r.url.includes('/walletsolidity/') && r.options?.redirect === 'error'));
    await assert.rejects(new NileRpc('error', NILE_ORIGINS[0], async () => new Response('{"Error":"not found"}')).tip(), code('rpc_error_response'));
    await assert.rejects(new NileRpc('limited', NILE_ORIGINS[0], async () => new Response('', { status: 429 })).tip(), code('rpc_rate_limited'));
    await assert.rejects(new NileRpc('large', NILE_ORIGINS[0], async () => new Response('{}', { headers: { 'content-length': String(17 * 1024 * 1024) } })).tip(), code('rpc_response_limit'));
});
test('wrong genesis, stale tips, missing blocks and mismatched sources cannot advance saved progress', async () => {
    const store = new TronReadStore(':memory:', config), blocks = chain();
    await store.ready;
    try {
        const wrong = sources(blocks);
        wrong[1].genesis = async () => '0'.repeat(64);
        await assert.rejects(scanNile(store, wrong), code('wrong_network'));
        const stale = sources(blocks);
        stale[1].tip = async () => ({ ...blocks.at(-1)!, timestamp: Date.now() - 600000 });
        await assert.rejects(scanNile(store, stale), code('source_tip_stale'));
        const conflict = sources(blocks);
        conflict[1].block = async (h) => ({ ...clone(blocks.find(b => b.height === h)!), transfers: [] });
        await assert.rejects(scanNile(store, conflict), code('source_disagreement'));
        assert.equal((await store.state()).cursor_height, 99);
        assert.equal((await store.status()).transfers, 0);
        const unavailable = sources(blocks);
        unavailable[1].block = async () => { throw new TronReadError('rpc_unavailable'); };
        await assert.rejects(scanNile(store, unavailable), code('rpc_unavailable'));
        assert.equal((await store.state()).cursor_height, 99);
        assert.equal((await scanNile(store, sources(blocks))).transfers, 1);
    }
    finally {
        await store.close();
    }
});
test('event and cursor commit together; a failed insert rolls back the whole block', async () => {
    const store = new TronReadStore(':memory:', config), blocks = chain();
    await store.ready;
    try {
        await store.db.exec("CREATE OR REPLACE FUNCTION fail_event_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_event BEFORE INSERT ON transfers FOR EACH ROW EXECUTE FUNCTION fail_event_fn();");
        await assert.rejects(scanNile(store, sources(blocks)));
        assert.equal((await store.state()).cursor_height, 99);
        assert.equal((await store.db.prepare('SELECT count(*) AS n FROM blocks WHERE height=100').get())!.n, 0);
        await store.db.exec('DROP TRIGGER fail_event ON transfers');
        assert.equal((await scanNile(store, sources(blocks))).transfers, 1);
        await assert.rejects(async () => await store.db.exec('UPDATE transfers SET amount_units=\'1\''));
        await assert.rejects(async () => await store.db.exec('DELETE FROM blocks'));
    }
    finally {
        await store.close();
    }
});
test('a crash after commit and reopening state never duplicates events or skips the cursor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-tron-test-')), file = join(directory, 'state.sqlite'), blocks = chain();
    let store = new TronReadStore(file, config);
    await store.ready;
    try {
        await assert.rejects(scanNile(store, sources(blocks), { afterCommit: async (block) => {
                assert.ok(Number((await store.status()).finalizedHeight) >= block.height);
                assert.equal((await store.audit()).cursorHeight, block.height);
                throw new Error('lost reply');
            } }));
        assert.equal((await store.state()).cursor_height, 100);
        await store.close();
        store = new TronReadStore(file, config);
        await store.ready;
        assert.equal((await scanNile(store, sources(blocks))).transfers, 0);
        assert.equal((await store.state()).cursor_height, 102);
        assert.equal((await store.status()).transfers, 1);
        assert.equal((await scanNile(store, sources(blocks))).blocks, 0);
        await rejectedStore(() => new TronReadStore(file, { ...config, startHeight: 101 }), code('saved_config_mismatch'));
    }
    finally {
        await store.close();
        await rm(directory, { recursive: true, force: true });
    }
});
test('overlap changes durably halt even if sources disagree on newer blocks or one is unavailable', async () => {
    const store = new TronReadStore(':memory:', config), blocks = chain();
    await store.ready;
    try {
        await scanNile(store, sources(blocks));
        const changed = sources(blocks);
        changed[0].block = async (h) => ({ ...clone(blocks.find(b => b.height === h)!), hash: digest('changed') });
        changed[1].block = async () => { throw new TronReadError('rpc_unavailable'); };
        await assert.rejects(scanNile(store, changed), code('finalized_block_changed'));
        assert.equal((await store.status()).haltedReason, 'finalized_block_changed');
        await assert.rejects(scanNile(store, sources(blocks)), code('reader_halted'));
        assert.equal((await store.status()).transfers, 1);
        await assert.rejects(async () => await store.db.exec('UPDATE reader_state SET halted_reason=NULL'));
    }
    finally {
        await store.close();
    }
});
test('two readers serialize scans and a consistent PostgreSQL backup preserves blocks, events and config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-tron-test-')), file = join(directory, 'state.sqlite'), blocks = chain();
    const a = new TronReadStore(file, config), b = new TronReadStore(file, config);
    await a.ready;
    await b.ready;
    try {
        const [left, right] = await Promise.all([scanNile(a, sources(blocks)), scanNile(b, sources(blocks))]);
        assert.equal(Number(left.busy) + Number(right.busy), 1);
        assert.equal((await a.status()).transfers, 1);
        assert.equal((await a.audit()).ok, true);
        const backup = join(directory, 'backup.pg.json');
        await a.db.snapshot(backup);
        const restored = await PostgresDatabase.restore(backup);
        try {
            assert.equal(await restored.integrityCheck(), true);
            assert.deepEqual(await restored.prepare('SELECT * FROM reader_state').all(), await a.db.prepare('SELECT * FROM reader_state').all());
            assert.deepEqual(await restored.prepare('SELECT * FROM blocks').all(), await a.db.prepare('SELECT * FROM blocks').all());
            assert.deepEqual(await restored.prepare('SELECT * FROM transfers').all(), await a.db.prepare('SELECT * FROM transfers').all());
        }
        finally {
            await restored.dropSchema();
            await restored.close();
        }
    }
    finally {
        await a.close();
        await b.close();
        await rm(directory, { recursive: true, force: true });
    }
});
test('verified snapshots restore the complete reader state and reject a wrong checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-tron-test-')), store = new TronReadStore(join(directory, 'state.sqlite'), config);
    await store.ready;
    try {
        await scanNile(store, sources(chain()));
        const meta = await snapshotTronStore(store, join(directory, 'backups'));
        assert.equal(meta.checks.blocks, 4);
        assert.equal(meta.checks.transfers, 1);
        assert.deepEqual(await verifyTronSnapshot(join(directory, 'backups', meta.file), config, meta.sha256), meta.checks);
        await assert.rejects(verifyTronSnapshot(join(directory, 'backups', meta.file), config, '0'.repeat(64)), code('snapshot_checksum_mismatch'));
        assert.ok(Number((await store.state()).last_backup_at) > 0);
    }
    finally {
        await store.close();
        await rm(directory, { recursive: true, force: true });
    }
});
