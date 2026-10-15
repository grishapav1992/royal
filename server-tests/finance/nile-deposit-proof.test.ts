import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { verifyNileDeposit } from '../../server/finance/nile-deposit-proof';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN, type NileTestConfig } from '../../server/finance/nile-test-ledger';
import { nilePublicKeyAddress } from '../../server/finance/nile-address';
import { NILE_GENESIS, type TronBlock } from '../../server/finance/tron-protocol';
import { NILE_ORIGINS, type TronSource } from '../../server/finance/tron-rpc';
function address(userId: string, number: number) {
    const key = createECDH('secp256k1');
    key.setPrivateKey(Buffer.from(number.toString(16).padStart(64, '0'), 'hex'));
    const publicKey = key.getPublicKey('hex', 'uncompressed');
    return { userId, address: nilePublicKeyAddress(publicKey), publicKey };
}
const alice = address('alice', 1), sender = address('sender', 3), txId = 'b'.repeat(64);
const config: NileTestConfig = { version: 1, network: 'nile', genesis: NILE_GENESIS, token: NILE_TEST_TOKEN, asset: NILE_TEST_ASSET, scale: 6,
    startHeight: 100, readerStartHeight: 100, origins: [...NILE_ORIGINS], addresses: [alice] };
const hash = (n: number) => n.toString(16).padStart(16, '0') + 'a'.repeat(48);
async function setup(empty = false) {
    const ledger = new NileTestLedger(':memory:', config);
    await ledger.ready;
    const block: TronBlock = { height: 100, hash: hash(100), parentHash: hash(99), timestamp: Date.now(), txIds: empty ? [] : [txId],
        outcomes: empty ? [] : [{ txId, status: 'SUCCESS' }], transfers: empty ? [] : [{ txId, logIndex: 0, contract: NILE_TEST_TOKEN, from: sender.address, to: alice.address, amountUnits: '9007199254740993123456' }] };
    await ledger.ingest({ ...block, height: 99, hash: hash(99), parentHash: hash(98), txIds: [], outcomes: [], transfers: [] }, true);
    await ledger.ingest(block);
    const sources: TronSource[] = NILE_ORIGINS.map((origin, index) => ({ id: 'nile-' + index, origin, genesis: async () => NILE_GENESIS,
        tip: async () => ({ ...block, height: 101, hash: hash(101) }), block: async () => structuredClone(block) }));
    return { ledger, block, sources };
}
test('a real receipt path proves one credited event and preserves exact balances without enabling spending', async () => {
    const { ledger, sources } = await setup();
    try {
        const before = await ledger.audit(), result = await verifyNileDeposit(ledger, 'alice', sources, txId);
        assert.equal(result.ok, true);
        assert.equal(result.depositObserved, true);
        assert.equal(result.spendable, false);
        if (!result.ok)
            assert.fail('a positive fixture must have an event proof');
        assert.equal(result.event?.amountUnits, '9007199254740993123456');
        assert.equal(result.userBalanceUnits, result.event?.amountUnits);
        assert.equal(result.receiptConfirmedByTwoRpcs, true);
        assert.deepEqual(await ledger.audit(), before);
    }
    finally {
        await ledger.close();
    }
});
test('zero deposits and a missing transaction remain pending before any network request', async () => {
    for (const empty of [true, false]) {
        const { ledger, sources } = await setup(empty);
        for (const s of sources)
            s.genesis = async () => { throw new Error('must_not_contact_rpc'); };
        try {
            const result = await verifyNileDeposit(ledger, 'alice', sources, empty ? undefined : 'c'.repeat(64));
            assert.equal(result.ok, false);
            assert.equal(result.code, 'nile_deposit_pending');
            assert.equal(result.depositObserved, false);
        }
        finally {
            await ledger.close();
        }
    }
});
test('an unassigned user, malformed transaction, duplicate or unsafe source cannot produce a proof', async () => {
    const { ledger, sources } = await setup();
    try {
        await assert.rejects(verifyNileDeposit(ledger, 'unknown', sources), /invalid_deposit_proof_request/);
        await assert.rejects(verifyNileDeposit(ledger, 'alice', sources, 'invalid'), /invalid_deposit_proof_request/);
        await assert.rejects(verifyNileDeposit(ledger, 'alice', [sources[0], sources[0]]), /invalid_deposit_proof_sources/);
        sources[1].origin = 'https://api.trongrid.io';
        await assert.rejects(verifyNileDeposit(ledger, 'alice', sources), /invalid_deposit_proof_sources/);
    }
    finally {
        await ledger.close();
    }
});
test('wrong genesis, stale finality, changed block, receipt status and token amounts fail closed', async () => {
    for (const change of [
        (s: TronSource, _b: TronBlock) => { s.genesis = async () => hash(0); },
        (s: TronSource, b: TronBlock) => { s.tip = async () => ({ ...b, height: 99 }); },
        (s: TronSource, b: TronBlock) => { s.tip = async () => ({ ...b, timestamp: 1 }); },
        (s: TronSource, b: TronBlock) => { s.tip = async () => ({ ...b, height: NaN }); },
        (s: TronSource, b: TronBlock) => { s.block = async () => ({ ...b, hash: hash(101) }); },
        (s: TronSource, b: TronBlock) => { s.block = async () => ({ ...b, outcomes: [{ txId, status: 'FAILED' }] }); },
        (s: TronSource, b: TronBlock) => { s.block = async () => ({ ...b, transfers: b.transfers.map(event => ({ ...event, amountUnits: '1' })) }); },
    ]) {
        const { ledger, sources, block } = await setup();
        try {
            change(sources[1], block);
            await assert.rejects(verifyNileDeposit(ledger, 'alice', sources));
        }
        finally {
            await ledger.close();
        }
    }
});
test('corrupt entries and a durable halt cannot be marked as a positive receipt proof', async () => {
    const { ledger, sources } = await setup();
    try {
        await ledger.halt('test_source_corrupted');
        await assert.rejects(verifyNileDeposit(ledger, 'alice', sources), /deposit_proof_ledger_not_ready/);
        await ledger.db.exec("DROP TRIGGER \"immutable_entries_DELETE\" ON entries; DELETE FROM entries WHERE account='external';");
        await assert.rejects(verifyNileDeposit(ledger, 'alice', sources), /test_ledger_corrupted/);
    }
    finally {
        await ledger.close();
    }
});
