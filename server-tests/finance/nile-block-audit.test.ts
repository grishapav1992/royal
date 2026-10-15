import test from 'node:test';
import assert from 'node:assert/strict';
import { NileTestLedger, eligibleNileTransfers } from '../../server/finance/nile-test-ledger';
import { NilePlayLedger } from '../../server/finance/nile-play-ledger';
import { TronReadStore } from '../../server/finance/tron-store';
import { performance } from 'node:perf_hooks';
import { digest, type TronBlock } from '../../server/finance/tron-protocol';
import { block, playTestConfig } from './helpers/nile-play-fixture';
import { AUDIT_PAYLOAD_LIMIT, readBlockAuditPage } from '../../server/finance/block-audit-pages';

test('block pages enforce a byte budget and reject an oversized block without returning its payload', async () => {
    const ledger = new NileTestLedger(':memory:', playTestConfig.source);
    const reader = new TronReadStore(':memory:', { network: 'nile', startHeight: 100, origins: playTestConfig.source.origins });
    await Promise.all([ledger.ready, reader.ready]);
    try {
        await ledger.ingest(block(99), true);
        await reader.acquire('budget-test');
        await reader.commit('budget-test', block(99), true);
        for (let height = 100; height <= 102; height++) {
            const value = { ...block(height, '1'), extra: 'x'.repeat(3 * 1024 * 1024) };
            await ledger.ingest(value);
            await reader.commit('budget-test', value);
        }
        const first = await readBlockAuditPage(ledger.db);
        assert.deepEqual(first.map(row => row.height), [99, 100, 101]);
        assert.ok(first.reduce((sum, row) => sum + row.payload_bytes, 0) <= AUDIT_PAYLOAD_LIMIT);
        const second = await readBlockAuditPage(ledger.db, first.at(-1)!.height);
        assert.deepEqual(second.map(row => row.height), [102]);
        assert.equal((await ledger.audit()).credits, 3);
        assert.equal((await reader.audit()).transfers, 3);
        const value = { ...block(103, '1'), extra: 'x'.repeat(AUDIT_PAYLOAD_LIMIT) };
        await ledger.ingest(value);
        await reader.commit('budget-test', value);
        const oversized = await readBlockAuditPage(ledger.db, 102);
        assert.equal(oversized.length, 1);
        assert.equal(oversized[0].height, 103);
        assert.equal(oversized[0].payload, null);
        assert.ok(oversized[0].payload_bytes > AUDIT_PAYLOAD_LIMIT);
        await assert.rejects(ledger.audit(), /test_ledger_corrupted/);
        assert.equal((await readBlockAuditPage(reader.db, 102))[0].payload, null);
        await assert.rejects(reader.audit(), /saved_data_corrupted/);
    } finally { await ledger.close(); await reader.close(); }
});

test('complete block audit rejects rehashed malformed headers, receipts and ignored transfers', async () => {
    const ledger = new NileTestLedger(':memory:', playTestConfig.source);
    await ledger.ready;
    const original = block(100, '9007199254740993');
    const ignored = digest('ignored-transfer');
    original.txIds.push(ignored);
    original.outcomes.push({ txId: ignored, status: 'SUCCESS' });
    original.transfers.push({ ...original.transfers[0], txId: ignored, contract: '41' + 'b'.repeat(40), logIndex: 1, amountUnits: '42' });
    const mutations: ((value: any) => void)[] = [
        value => { value.timestamp = '1'; }, value => { value.timestamp = 0; }, value => { value.timestamp = 1.5; },
        value => { value.timestamp = 9007199254740992; }, value => { value.height = 101; },
        value => { value.hash = block(101).hash; }, value => { value.parentHash = block(98).hash; },
        value => { value.txIds = {}; }, value => { value.outcomes = {}; }, value => { value.transfers = {}; },
        value => { value.txIds[1] = [value.txIds[1]]; }, value => { value.txIds[1] = null; },
        value => { value.txIds[1] = { value: value.txIds[1] }; }, value => { value.txIds[1] = true; },
        value => { value.txIds[1] = 'G'.repeat(64); },
        value => { value.txIds.push(value.txIds[0]); }, value => { value.outcomes.pop(); },
        value => { value.outcomes[1].txId = value.outcomes[0].txId; },
        value => { value.outcomes[0].status = 'REVERT'; },
        value => { value.transfers[1].logIndex = '1'; }, value => { value.transfers[1].logIndex = -1; },
        value => { value.transfers[1].logIndex = 0.5; }, value => { value.transfers[1].logIndex = 9007199254740992; },
        value => { value.transfers[1].amountUnits = '01'; }, value => { value.transfers[1].amountUnits = 42; },
        value => { value.transfers[1].amountUnits = (2n ** 256n).toString(); },
        value => { value.transfers[1].from = '41' + 'X'.repeat(40); }, value => { value.transfers[1].to = null; },
        value => { value.transfers[1].contract = 1; }, value => { value.transfers[1].txId = digest('missing-receipt'); },
        value => { value.transfers.push(value.transfers[1]); },
    ];
    try {
        await ledger.ingest(block(99), true);
        await ledger.ingest(original);
        const before = await ledger.audit();
        await ledger.db.exec('DROP TRIGGER "immutable_blocks_UPDATE" ON blocks');
        for (const [index, mutate] of mutations.entries()) {
            const changed = structuredClone(original);
            mutate(changed);
            assert.throws(() => eligibleNileTransfers(playTestConfig.source, changed), () => true, 'domain case ' + index);
            const payload = JSON.stringify(changed);
            await ledger.db.prepare('UPDATE blocks SET payload=?,payload_sha256=? WHERE height=100').run(payload, digest(payload));
            await assert.rejects(ledger.audit(), () => true, 'audit case ' + index);
        }
        for (const change of [
            (value: TronBlock) => { value.transfers[1].amountUnits = (2n ** 256n - 1n).toString(); },
            (value: TronBlock) => { value.transfers[1].amountUnits = '0'; },
            (value: TronBlock) => { value.transfers.pop(); value.outcomes[1].status = 'FUTURE_STATUS'; },
        ]) {
            const changed = structuredClone(original);
            change(changed);
            assert.equal(eligibleNileTransfers(playTestConfig.source, changed).length, 1);
            const payload = JSON.stringify(changed);
            await ledger.db.prepare('UPDATE blocks SET payload=?,payload_sha256=? WHERE height=100').run(payload, digest(payload));
            assert.deepEqual(await ledger.audit(), before);
        }
    }
    finally {
        await ledger.close();
    }
});

test('receipts without transfers still require string statuses and preserve historical failure strings', async () => {
    const ledger = new NileTestLedger(':memory:', playTestConfig.source);
    await ledger.ready;
    const original = block(100, '1');
    original.transfers = [];
    original.outcomes[0].status = 'HISTORICAL_FAILURE';
    try {
        await ledger.ingest(block(99), true);
        await ledger.ingest(original);
        assert.equal((await ledger.audit()).credits, 0);
        await ledger.db.exec('DROP TRIGGER "immutable_blocks_UPDATE" ON blocks');
        for (const status of [null, {}, [], false, 1, undefined]) {
            const changed: any = structuredClone(original);
            changed.outcomes[0].status = status;
            assert.throws(() => eligibleNileTransfers(playTestConfig.source, changed), /invalid_test_block/);
            const payload = JSON.stringify(changed);
            await ledger.db.prepare('UPDATE blocks SET payload=?,payload_sha256=? WHERE height=100').run(payload, digest(payload));
            await assert.rejects(ledger.audit(), /invalid_test_block/);
        }
    } finally { await ledger.close(); }
});

test('sparse range skips reject out-of-range orphan rows and missing expected events', async () => {
    const source = new NileTestLedger(':memory:', playTestConfig.source);
    const reader = new TronReadStore(':memory:', { network: 'nile', startHeight: 100, origins: playTestConfig.source.origins });
    await Promise.all([source.ready, reader.ready]);
    const event = block(100, '1').transfers[0], txId = digest('out-of-range-orphan');
    try {
        await source.ingest(block(99), true);
        await reader.acquire('range-test');
        await reader.commit('range-test', block(99), true);
        await source.db.transaction(async () => {
            await source.db.exec("SET LOCAL session_replication_role='replica'");
            await source.db.prepare('INSERT INTO credits VALUES(?,?,?,?,?,?,?,?)').run(txId, 0, 10000,
                playTestConfig.source.addresses[0].userId, event.contract, event.from, event.to, '1');
        });
        await reader.db.transaction(async () => {
            await reader.db.exec("SET LOCAL session_replication_role='replica'");
            await reader.db.prepare('INSERT INTO transfers VALUES(?,?,?,?,?,?,?)').run(txId, 0, 10000, event.contract, event.from, event.to, '1');
        });
        await assert.rejects(source.audit(), /test_ledger_corrupted/);
        await assert.rejects(reader.audit(), /saved_event_mismatch/);
        for (const ledger of [source, reader]) await ledger.db.transaction(async () => {
            await ledger.db.exec("SET LOCAL session_replication_role='replica'");
            await ledger.db.exec(ledger === source ? 'DELETE FROM credits' : 'DELETE FROM transfers');
        });
        await source.ingest(block(100, '1'));
        await reader.commit('range-test', block(100, '1'));
        assert.equal((await source.audit()).credits, 1);
        assert.equal((await reader.audit()).transfers, 1);
        await source.db.transaction(async () => {
            await source.db.exec("SET LOCAL session_replication_role='replica'");
            await source.db.exec('DELETE FROM entries; DELETE FROM credits');
        });
        await reader.db.transaction(async () => {
            await reader.db.exec("SET LOCAL session_replication_role='replica'");
            await reader.db.exec('DELETE FROM transfers');
        });
        await assert.rejects(source.audit(), /test_ledger_corrupted/);
        await assert.rejects(reader.audit(), /saved_event_mismatch/);
    } finally { await source.close(); await reader.close(); }
});

test('multi-page funding import rolls back after a late write failure, retries exactly and audits late postings', async () => {
    const source = new NileTestLedger(':memory:', playTestConfig.source), ledger = new NilePlayLedger(':memory:', playTestConfig);
    await Promise.all([source.ready, ledger.ready]);
    const amount = '9007199254740993';
    const reconciliation = async () => {
        const audit = await source.audit();
        return { ok: true, checked_at: new Date().toISOString(), network: 'nile', asset: 'USDT_NILE_TEST', testOnly: true,
            spendable: false, credits: audit.credits, liabilitiesUnits: audit.balances.reduce((sum, row) => sum + BigInt(row.availableUnits), 0n).toString(), deficitUnits: '0' };
    };
    try {
        await source.db.transaction(async () => {
            await source.ingest(block(99), true);
            for (let height = 100; height < 360; height++) await source.ingest(block(height, amount));
        });
        const proof = await reconciliation(), prepare = ledger.db.prepare.bind(ledger.db);
        let writes = 0;
        ledger.db.prepare = sql => {
            const statement = prepare(sql);
            return { ...statement, run: async (...values) => {
                if (sql.startsWith('INSERT INTO events(') && ++writes === 150) throw new Error('injected late funding failure');
                return statement.run(...values);
            } };
        };
        await assert.rejects(ledger.sync(source, proof), /injected late funding failure/);
        ledger.db.prepare = prepare;
        assert.equal(writes, 150);
        assert.equal((await ledger.audit()).credits, 0);
        assert.equal((await ledger.state()).source_height, null);
        assert.equal(await ledger.sync(source, proof), 260);
        assert.equal(await ledger.sync(source, proof), 0);
        await source.ingest(block(360, '123456789'));
        assert.equal(await ledger.sync(source, await reconciliation()), 1);
        const audit = await ledger.audit();
        assert.equal(audit.credits, 261);
        assert.equal(audit.totalUnits, (BigInt(amount) * 260n + 123456789n).toString());
        await ledger.db.transaction(async () => {
            await ledger.db.exec("SET LOCAL session_replication_role='replica'");
            await ledger.db.prepare("UPDATE entries SET units='1' WHERE seq=260 AND line=0").run();
        });
        await assert.rejects(ledger.audit(), /play_journal_corrupted/);
    }
    finally {
        await source.close();
        await ledger.close();
    }
});

test('reader audits all pages with exact typed event equality and rejects rehashed late payloads', async context => {
    const store = new TronReadStore(':memory:', { network: 'nile', startHeight: 100, origins: playTestConfig.source.origins });
    await store.ready;
    try {
        await store.db.transaction(async () => {
            await store.acquire('test-owner');
            await store.commit('test-owner', block(99), true);
            for (let height = 100; height < 360; height++) await store.commit('test-owner', block(height, '9007199254740993'));
        });
        const payloadBytes = Buffer.byteLength(JSON.stringify(await store.db.prepare('SELECT * FROM blocks ORDER BY height').all()));
        const prepare = store.db.prepare.bind(store.db);
        let resultBytes = 0;
        const pages: number[] = [];
        store.db.prepare = sql => {
            const statement = prepare(sql);
            return { ...statement,
                get: async (...values) => { const value = await statement.get(...values); resultBytes += Buffer.byteLength(JSON.stringify(value) ?? ''); return value; },
                all: async (...values) => { const value = await statement.all(...values); resultBytes += Buffer.byteLength(JSON.stringify(value));
                    if (sql.includes('octet_length(payload)')) pages.push(value.length); return value; },
            };
        };
        assert.deepEqual(await store.audit(), { ok: true, blocks: 261, transfers: 260, cursorHeight: 359, schemaVersion: 1, network: 'nile' });
        store.db.prepare = prepare;
        assert.deepEqual(pages, [128, 128, 5, 0]);
        context.diagnostic(JSON.stringify({ blocks: 261, blockPayloadBytes: payloadBytes, auditResultBytes: resultBytes, maxPageRows: 128 }));
        const original = JSON.parse(String((await store.db.prepare('SELECT payload FROM blocks WHERE height=359').get())!.payload));
        await store.db.exec('DROP TRIGGER protected_blocks_update ON blocks');
        for (const mutation of [
            (value: any) => { value.height = '359'; }, (value: any) => { value.parentHash = block(357).hash; },
            (value: any) => { value.transfers[0].amountUnits = 9007199254740992; },
            (value: any) => { value.transfers[0].logIndex = '0'; }, (value: any) => { value.transfers.push(value.transfers[0]); },
        ]) {
            const changed = structuredClone(original);
            mutation(changed);
            const payload = JSON.stringify(changed);
            await store.db.prepare('UPDATE blocks SET payload=?,payload_sha256=? WHERE height=359').run(payload, digest(payload));
            await assert.rejects(store.audit());
        }
    }
    finally {
        await store.close();
    }
});

test('dense block audits validate ten thousand receipts and ignored transfers without per-event database calls', async context => {
    const source = new NileTestLedger(':memory:', playTestConfig.source);
    const reader = new TronReadStore(':memory:', { network: 'nile', startHeight: 100, origins: playTestConfig.source.origins });
    await Promise.all([source.ready, reader.ready]);
    const dense = block(100, '1'), template = dense.transfers[0];
    dense.txIds = [];
    dense.outcomes = [];
    dense.transfers = [];
    for (let index = 0; index < 10000; index++) {
        const txId = digest('dense:' + index);
        dense.txIds.push(txId);
        dense.outcomes.push({ txId, status: 'SUCCESS' });
        dense.transfers.push({ ...template, txId, logIndex: index, contract: '41' + 'b'.repeat(40), amountUnits: (2n ** 256n - 1n).toString() });
    }
    try {
        assert.equal(eligibleNileTransfers(playTestConfig.source, dense).length, 0);
        await source.ingest(block(99), true);
        assert.equal(await source.ingest(dense), 0);
        await reader.acquire('dense-test');
        await reader.commit('dense-test', block(99), true);
        const payload = JSON.stringify(dense);
        await reader.db.transaction(async () => {
            await reader.db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?)').run(dense.height, dense.hash, dense.parentHash, payload, digest(payload), Date.now());
            await reader.db.prepare(`INSERT INTO transfers SELECT e->>'txId',(e->>'logIndex')::bigint,100,e->>'contract',e->>'from',e->>'to',e->>'amountUnits'
                FROM blocks CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(payload::jsonb->'transfers') e WHERE height=100`).run();
            await reader.db.prepare('UPDATE reader_state SET cursor_height=100,cursor_hash=? WHERE id=1').run(dense.hash);
        });
        const started = performance.now();
        assert.equal((await source.audit()).credits, 0);
        const nileMilliseconds = performance.now() - started, readerStarted = performance.now();
        assert.equal((await reader.audit()).transfers, 10000);
        context.diagnostic(JSON.stringify({ receipts: 10000, transfers: 10000, nileAuditMilliseconds: Math.round(nileMilliseconds),
            readerAuditMilliseconds: Math.round(performance.now() - readerStarted) }));
    }
    finally {
        await source.close();
        await reader.close();
    }
});

test('SQL invite validation retains safe integer timestamp checks for unclaimed invitations', async () => {
    for (const createdAt of [9007199254740992n, 9007199254740991n - 1n]) {
        const ledger = new NilePlayLedger(':memory:', playTestConfig);
        await ledger.ready;
        try {
            await ledger.db.prepare('INSERT INTO invites VALUES(?,?,?,?)').run(digest('unclaimed'), 'player', createdAt.toString(), (createdAt + 86400000n).toString());
            await assert.rejects(ledger.audit(), /play_journal_corrupted/);
        }
        finally {
            await ledger.close();
        }
    }
});

test('complete history audit bounds each page and preserves exact balances', async context => {
    const ledger = new NileTestLedger(':memory:', playTestConfig.source);
    await ledger.ready;
    const amount = '999999999999999999999999999999';
    try {
        await ledger.db.transaction(async () => {
            await ledger.ingest(block(99), true);
            for (let height = 100; height < 360; height++) {
                const value = block(height, height === 100 ? amount : '0');
                for (let index = 0; index < 64; index++) {
                    const txId = digest(height + ':unused:' + index);
                    value.txIds.push(txId);
                    value.outcomes.push({ txId, status: 'SUCCESS' });
                }
                await ledger.ingest(value);
            }
        });
        const legacyRows = await ledger.db.prepare('SELECT * FROM blocks ORDER BY height').all();
        const legacyBytes = Buffer.byteLength(JSON.stringify(legacyRows));
        let returnedBytes = 0;
        const pages: { rows: number; bytes: number }[] = [];
        const prepare = ledger.db.prepare.bind(ledger.db);
        ledger.db.prepare = sql => {
            const statement = prepare(sql);
            return { ...statement,
                get: async (...values) => { const value = await statement.get(...values); returnedBytes += Buffer.byteLength(JSON.stringify(value) ?? ''); return value; },
                all: async (...values) => { const value = await statement.all(...values); returnedBytes += Buffer.byteLength(JSON.stringify(value));
                    if (sql.includes('octet_length(payload)')) pages.push({ rows: value.length, bytes: value.reduce((sum, row) => sum + row.payload_bytes, 0) });
                    return value; },
            };
        };
        const audit = await ledger.audit();
        assert.equal(audit.blocks, legacyRows.length);
        assert.equal(audit.credits, 1);
        assert.equal(audit.balances.find(row => row.userId === 'player')!.availableUnits, amount);
        assert.deepEqual(pages.map(page => page.rows), [128, 128, 5, 0]);
        assert.ok(pages.every(page => page.bytes <= AUDIT_PAYLOAD_LIMIT));
        context.diagnostic(JSON.stringify({ blocks: audit.blocks, blockPayloadBytes: legacyBytes, auditResultBytes: returnedBytes,
            maxPageRows: 128, maxPagePayloadBytes: Math.max(...pages.map(page => page.bytes)) }));
        ledger.db.prepare = prepare;
    }
    finally {
        await ledger.close();
    }
});
