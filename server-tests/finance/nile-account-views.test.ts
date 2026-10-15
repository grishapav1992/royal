import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { addNileBinding, buildNileAccountViews, nileConfigSha256, readNileBindings, validateNileBindings, type NileBindings } from '../../server/finance/nile-account-views';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN, type NileTestConfig } from '../../server/finance/nile-test-ledger';
import { nilePublicKeyAddress } from '../../server/finance/nile-address';
import { NILE_GENESIS } from '../../server/finance/tron-protocol';
import { NILE_ORIGINS } from '../../server/finance/tron-rpc';
import { playTestConfig } from './helpers/nile-play-fixture';
import { customerPool } from './helpers/nile-pool-fixture';
const key = createECDH('secp256k1');
key.setPrivateKey(Buffer.from('1'.padStart(64, '0'), 'hex'));
const publicKey = key.getPublicKey('hex', 'uncompressed');
const config: NileTestConfig = { version: 1, network: 'nile', genesis: NILE_GENESIS, token: NILE_TEST_TOKEN, asset: NILE_TEST_ASSET,
    scale: 6, startHeight: 100, readerStartHeight: 100, origins: [...NILE_ORIGINS], addresses: [{ userId: 'alice', address: nilePublicKeyAddress(publicKey), publicKey }] };
const blank = (): NileBindings => ({ version: 1, network: 'nile', asset: NILE_TEST_ASSET, configSha256: nileConfigSha256(config), bindings: [] });
const hash = (height: number) => height.toString(16).padStart(16, '0') + 'a'.repeat(48);
async function setup() {
    const ledger = new NileTestLedger(':memory:', config);
    await ledger.ready;
    await ledger.ingest({ height: 99, hash: hash(99), parentHash: hash(98), timestamp: Date.now(), txIds: [], transfers: [], outcomes: [] }, true);
    const txId = 'b'.repeat(64), units = '9007199254740993123456';
    await ledger.ingest({ height: 100, hash: hash(100), parentHash: hash(99), timestamp: Date.now(), txIds: [txId], outcomes: [{ txId, status: 'SUCCESS' }],
        transfers: [{ txId, logIndex: 0, contract: NILE_TEST_TOKEN, from: '41' + '2'.repeat(40), to: config.addresses[0].address, amountUnits: units }] });
    const reconciliation = { ok: true, network: 'nile', asset: NILE_TEST_ASSET, testOnly: true, spendable: false, checked_at: new Date().toISOString(), credits: 1, liabilitiesUnits: units, deficitUnits: '0' };
    return { ledger, reconciliation, units };
}
test('binding is unique, idempotent and preserves existing ownership', () => {
    const id = randomUUID(), binding = addNileBinding(blank(), config, id, 'alice');
    assert.equal(binding.bindings.length, 1);
    assert.equal(blank().bindings.length, 0);
    assert.strictEqual(addNileBinding(binding, config, id, 'alice'), binding);
    assert.throws(() => addNileBinding(binding, config, randomUUID(), 'alice'), /nile_binding_conflict/);
    assert.throws(() => addNileBinding(binding, config, id, 'unknown'), /invalid_nile_binding_target/);
    assert.throws(() => addNileBinding(blank(), config, '../account', 'alice'));
});
test('wrong scope, unknown addresses, duplicate owners, bad timestamps and changed sealed config are rejected', () => {
    const valid = addNileBinding(blank(), config, randomUUID(), 'alice');
    for (const value of [{ ...valid, network: 'mainnet' }, { ...valid, asset: 'USDT' }, { ...valid, extra: true },
        { ...valid, configSha256: '0'.repeat(64) }, { ...valid, bindings: [...valid.bindings, valid.bindings[0]] },
        { ...valid, bindings: [{ ...valid.bindings[0], address: '41' + '3'.repeat(40) }] },
        { ...valid, bindings: [{ ...valid.bindings[0], boundAt: Date.now() + 60000 }] }])
        assert.throws(() => validateNileBindings(value, config));
});
test('PostgreSQL bindings survive reopening and reconstruct the exact manifest in timestamp and account order', async () => {
    const expanded = { ...config, addresses: [...config.addresses, ...playTestConfig.source.addresses] };
    let ledger = new NileTestLedger(':memory:', expanded);
    await ledger.ready;
    const schema = ledger.db.schema, boundAt = Date.now() - 1000;
    const rows = [
        { accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: expanded.addresses[0].userId, address: expanded.addresses[0].address, boundAt },
        { accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', userId: expanded.addresses[1].userId, address: expanded.addresses[1].address, boundAt: boundAt - 1000 },
        { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: expanded.addresses[2].userId, address: expanded.addresses[2].address, boundAt },
    ];
    try {
        assert.deepEqual(await readNileBindings(ledger), { ...blank(), configSha256: nileConfigSha256(expanded) });
        await ledger.db.transaction(async () => {
            for (const row of rows)
                await ledger.db.prepare('INSERT INTO account_bindings(account_id,user_id,address,bound_at) VALUES(?,?,?,?)')
                    .run(row.accountId, row.userId, row.address, row.boundAt);
        });
        const expected = { version: 1, network: 'nile', asset: NILE_TEST_ASSET, configSha256: nileConfigSha256(expanded),
            bindings: [rows[1], rows[2], rows[0]] };
        assert.equal(JSON.stringify(await readNileBindings(ledger)), JSON.stringify(expected));
        await ledger.close();
        ledger = new NileTestLedger(schema, expanded, true);
        await ledger.ready;
        assert.equal(JSON.stringify(await readNileBindings(ledger)), JSON.stringify(expected));
    }
    finally {
        await ledger.close();
    }
});
test('database ownership is unique and immutable, and manual bindings reject pool users and invalid targets', async () => {
    const expanded = { ...config, addresses: [...config.addresses, playTestConfig.source.addresses[0]] };
    const ledger = new NileTestLedger(':memory:', expanded, false, customerPool);
    await ledger.ready;
    const id = randomUUID(), boundAt = Date.now(), owner = expanded.addresses[0], other = expanded.addresses[1];
    const insert = (accountId: string, userId: string | null, address: string, time: number | string) =>
        ledger.db.prepare('INSERT INTO account_bindings(account_id,user_id,address,bound_at) VALUES(?,?,?,?)').run(accountId, userId, address, time);
    try {
        await insert(id, owner.userId, owner.address, boundAt);
        await assert.rejects(insert(id, owner.userId, owner.address, boundAt), /duplicate key/);
        await assert.rejects(insert(randomUUID(), owner.userId, owner.address, boundAt), /duplicate key/);
        await assert.rejects(insert(id, other.userId, other.address, boundAt), /duplicate key/);
        await assert.rejects(ledger.db.prepare('UPDATE account_bindings SET user_id=?,address=? WHERE account_id=?').run(other.userId, other.address, id), /immutable test journal/);
        await assert.rejects(ledger.db.prepare('DELETE FROM account_bindings WHERE account_id=?').run(id), /immutable test journal/);
        for (const [accountId, userId, address, time] of [
            ['../account', other.userId, other.address, boundAt],
            ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', other.userId, other.address, boundAt],
            ['aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa', other.userId, other.address, boundAt],
            [randomUUID(), other.userId, owner.address, boundAt],
            [randomUUID(), 'unknown', other.address, boundAt],
            [randomUUID(), null, other.address, boundAt],
            [randomUUID(), customerPool.addresses[0].userId, customerPool.addresses[0].address, boundAt],
            [randomUUID(), other.userId, other.address, 0],
            [randomUUID(), other.userId, other.address, -1],
            [randomUUID(), other.userId, other.address, boundAt + 60000],
            [randomUUID(), other.userId, other.address, '9007199254740992'],
        ] as [string, string | null, string, number | string][]) {
            await assert.rejects(insert(accountId, userId, address, time));
        }
        assert.deepEqual((await readNileBindings(ledger)).bindings, [{ accountId: id, userId: owner.userId, address: owner.address, boundAt }]);
        await ledger.db.exec('DROP TRIGGER "immutable_account_bindings_UPDATE" ON account_bindings');
        await ledger.db.prepare('UPDATE account_bindings SET address=? WHERE account_id=?').run(other.address, id);
        await assert.rejects(readNileBindings(ledger), /invalid_nile_bindings/);
    }
    finally {
        await ledger.close();
    }
});
test('view exports only explicitly assigned accounts, keeps BigInt amounts and never changes the journal', async () => {
    const { ledger, reconciliation, units } = await setup();
    try {
        const before = await ledger.audit();
        const empty = await buildNileAccountViews(ledger, await readNileBindings(ledger), reconciliation);
        assert.equal(empty.wallets.length, 0);
        const id = randomUUID();
        await ledger.db.prepare('INSERT INTO account_bindings(account_id,user_id,address,bound_at) VALUES(?,?,?,?)')
            .run(id, 'alice', config.addresses[0].address, Date.now());
        const view = await buildNileAccountViews(ledger, await readNileBindings(ledger), reconciliation);
        assert.equal(view.wallets[0].accountId, id);
        assert.equal(view.wallets[0].balanceUnits, units);
        assert.equal(view.wallets[0].deposits.length, 1);
        assert.equal(view.spendable, false);
        assert.equal(view.testOnly, true);
        assert.deepEqual(await ledger.audit(), before);
        assert.ok(!JSON.stringify(view).includes('privateKey'));
        assert.ok(!JSON.stringify(view).includes('email'));
    }
    finally {
        await ledger.close();
    }
});
test('stale, failed, mismatching reconciliation or a halted ledger cannot publish a usable view', async () => {
    const { ledger, reconciliation } = await setup();
    try {
        for (const change of [{ ok: false }, { network: 'mainnet' }, { testOnly: false }, { spendable: true }, { deficitUnits: '1' }, { credits: 0 }, { liabilitiesUnits: '0' },
            { checked_at: new Date(Date.now() - 600001).toISOString() }, { checked_at: new Date(Date.now() + 60000).toISOString() }]) {
            await assert.rejects(async () => await buildNileAccountViews(ledger, blank(), { ...reconciliation, ...change }), /nile_account_view_not_ready/);
        }
        await ledger.halt('test_halt');
        await assert.rejects(async () => await buildNileAccountViews(ledger, blank(), reconciliation), /nile_account_view_not_ready/);
    }
    finally {
        await ledger.close();
    }
});
