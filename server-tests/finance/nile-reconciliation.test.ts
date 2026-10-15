import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN, type NileTestConfig } from '../../server/finance/nile-test-ledger';
import { nilePublicKeyAddress } from '../../server/finance/nile-address';
import { NileBalanceRpc, reconcileNileSnapshot, type NileBalanceSource } from '../../server/finance/nile-test-reconciliation';
import { NILE_GENESIS, type TronBlock } from '../../server/finance/tron-protocol';
import { NILE_ORIGINS } from '../../server/finance/tron-rpc';
import { customerPool } from './helpers/nile-pool-fixture';
const hash = (height: number, suffix = 'a') => height.toString(16).padStart(16, '0') + suffix.repeat(48);
function account(userId: string, number: number) {
    const key = createECDH('secp256k1');
    key.setPrivateKey(Buffer.from(number.toString(16).padStart(64, '0'), 'hex'));
    const publicKey = key.getPublicKey('hex', 'uncompressed');
    return { userId, address: nilePublicKeyAddress(publicKey), publicKey };
}
const accounts = [account('alice', 1), account('bob', 2)], external = account('sender', 3);
const config: NileTestConfig = { version: 1, network: 'nile', genesis: NILE_GENESIS, token: NILE_TEST_TOKEN, asset: NILE_TEST_ASSET, scale: 6,
    startHeight: 100, readerStartHeight: 100, origins: [...NILE_ORIGINS], addresses: accounts };
const header = (height: number, suffix = 'a') => ({ height, hash: hash(height, suffix), parentHash: hash(height - 1), timestamp: Date.now() });
test('an address pool reconciles separate stable boundaries and cannot hide one wallet deficit behind another wallet excess', async () => {
    const ledger = new NileTestLedger(':memory:', config, false, customerPool);
    await ledger.ready;
    await ledger.ingest({ ...header(99), txIds: [], outcomes: [], transfers: [] }, true);
    await ledger.ingest({ ...header(100), txIds: [], outcomes: [], transfers: [] });
    const txId = 'c'.repeat(64);
    await ledger.ingest({ ...header(101), txIds: [txId], outcomes: [{ txId, status: 'SUCCESS' }], transfers: [{ txId, logIndex: 0, contract: NILE_TEST_TOKEN, from: external.address, to: customerPool.addresses[0].address, amountUnits: '7000000' }] });
    const sources: NileBalanceSource[] = NILE_ORIGINS.map((origin, index) => {
        let reads = 0;
        return { id: 'pool-' + index, origin, genesis: async () => NILE_GENESIS, decimals: async () => 6n, anchor: async () => header(101), tip: async () => header(102 + Math.floor(reads++ / 2)), balance: async (address) => address === customerPool.addresses[0].address ? 7000000n : 0n };
    });
    try {
        const before = await ledger.audit(), report = await reconcileNileSnapshot(ledger, sources);
        assert.equal(report.ok, true);
        assert.equal(report.assetsUnits, '7000000');
        assert.equal(report.viewMode, 'matching_rpc_balances_two_passes');
        assert.deepEqual(await ledger.audit(), before);
        for (const source of sources)
            source.balance = async (address) => address === customerPool.addresses[1].address ? 7000000n : 0n;
        const deficit = await reconcileNileSnapshot(ledger, sources);
        assert.equal(deficit.assetsUnits, deficit.liabilitiesUnits);
        assert.equal(deficit.ok, false);
        assert.equal(deficit.deficitUnits, '7000000');
    }
    finally {
        await ledger.close();
    }
});
async function setup(amount = '9007199254740993123456789', empty = false) {
    const ledger = new NileTestLedger(':memory:', config);
    await ledger.ready;
    const anchor: TronBlock = { ...header(99), txIds: [], outcomes: [], transfers: [] };
    await ledger.ingest(anchor, true);
    const txId = 'b'.repeat(64);
    await ledger.ingest({ ...header(100), txIds: empty ? [] : [txId], outcomes: empty ? [] : [{ txId, status: 'SUCCESS' }],
        transfers: empty ? [] : [{ txId, logIndex: 0, contract: NILE_TEST_TOKEN, from: external.address, to: accounts[0].address, amountUnits: amount }] });
    const sources: NileBalanceSource[] = NILE_ORIGINS.map((origin, index) => ({ id: 'nile-' + index, origin,
        genesis: async () => NILE_GENESIS, decimals: async () => 6n, anchor: async () => header(100), tip: async () => header(101),
        balance: async (address) => address === accounts[0].address ? BigInt(empty ? '0' : amount) : 0n }));
    return { ledger, sources };
}
test('an exact covered aggregate uses a consistent confirmed boundary and preserves the ledger', async () => {
    const { ledger, sources } = await setup();
    try {
        const before = await ledger.audit(), result = await reconcileNileSnapshot(ledger, sources);
        assert.equal(result.ok, true);
        assert.equal(result.assetsUnits, '9007199254740993123456789');
        assert.equal(result.assetsUnits, result.liabilitiesUnits);
        assert.equal(result.depositObserved, true);
        assert.equal(result.spendable, false);
        assert.deepEqual(await ledger.audit(), before);
        for (const source of sources)
            source.balance = async (address) => address === accounts[1].address ? BigInt(result.assetsUnits) : 0n;
        assert.equal((await reconcileNileSnapshot(ledger, sources)).ok, true); // Internal custody movement leaves aggregate coverage unchanged.
    }
    finally {
        await ledger.close();
    }
});
test('a deficit is explicit and incoming excess is never credited by reconciliation', async () => {
    const { ledger, sources } = await setup('1000000');
    try {
        for (const source of sources)
            source.balance = async () => 0n;
        const missing = await reconcileNileSnapshot(ledger, sources);
        assert.equal(missing.ok, false);
        assert.equal(missing.deficitUnits, '1000000');
        for (const source of sources)
            source.balance = async (address) => address === accounts[0].address ? 2000000n : 0n;
        const extra = await reconcileNileSnapshot(ledger, sources);
        assert.equal(extra.excessUnits, '1000000');
        assert.equal((await ledger.snapshot('alice')).availableUnits, '1000000');
    }
    finally {
        await ledger.close();
    }
});
test('zero coverage does not claim a verified deposit', async () => {
    const { ledger, sources } = await setup('1', true);
    try {
        const result = await reconcileNileSnapshot(ledger, sources);
        assert.equal(result.ok, true);
        assert.equal(result.depositObserved, false);
    }
    finally {
        await ledger.close();
    }
});
test('wrong network, contract precision, anchor, stale/behind sources and unsafe origins fail closed', async () => {
    for (const change of [
        (s: NileBalanceSource) => { s.genesis = async () => hash(0); },
        (s: NileBalanceSource) => { s.decimals = async () => 18n; },
        (s: NileBalanceSource) => { s.anchor = async () => header(100, 'f'); },
        (s: NileBalanceSource) => { s.tip = async () => ({ ...header(101), timestamp: 1 }); },
        (s: NileBalanceSource) => { s.tip = async () => header(98); },
        (s: NileBalanceSource) => { s.balance = async () => -1n; },
        (s: NileBalanceSource) => { s.origin = 'https://api.trongrid.io'; },
    ]) {
        const { ledger, sources } = await setup();
        try {
            change(sources[0]);
            await assert.rejects(reconcileNileSnapshot(ledger, sources));
        }
        finally {
            await ledger.close();
        }
    }
});
test('a boundary change retries a whole balance pass, without accepting values read across blocks', async () => {
    const { ledger, sources } = await setup('7');
    let calls = 0;
    try {
        sources[0].tip = async () => header(++calls === 1 ? 101 : 102);
        sources[1].tip = async () => header(102);
        const result = await reconcileNileSnapshot(ledger, sources);
        assert.equal(result.observed[0].height, 102);
        assert.ok(calls >= 4);
    }
    finally {
        await ledger.close();
    }
});
test('different stable node heights are explicit, while excessive lag and same-height forks fail closed', async () => {
    const { ledger, sources } = await setup('7');
    try {
        sources[1].tip = async () => header(103);
        const report = await reconcileNileSnapshot(ledger, sources);
        assert.equal(report.ok, true);
        assert.equal(report.sameConfirmedBoundary, false);
        assert.equal(report.sourceHeightSpread, 2);
        assert.equal(report.viewMode, 'matching_rpc_balances');
        for (const changed of [() => { sources[1].tip = async () => header(108); }, () => { sources[1].tip = async () => header(101, 'f'); }]) {
            changed();
            await assert.rejects(reconcileNileSnapshot(ledger, sources), /reconciliation_sources_disagree/);
        }
    }
    finally {
        await ledger.close();
    }
});
test('fresh but contradictory balances never produce a successful report', async () => {
    const { ledger, sources } = await setup();
    try {
        sources[1].balance = async () => 0n;
        await assert.rejects(reconcileNileSnapshot(ledger, sources), /reconciliation_sources_disagree/);
    }
    finally {
        await ledger.close();
    }
});
test('corrupt entries and a durable ledger halt prevent network reconciliation', async () => {
    const { ledger, sources } = await setup();
    try {
        await ledger.halt('test_source_corrupted');
        await assert.rejects(reconcileNileSnapshot(ledger, sources), /reconciliation_ledger_not_ready/);
        await ledger.db.exec("DROP TRIGGER \"immutable_entries_DELETE\" ON entries;DELETE FROM entries WHERE account='external';");
        await assert.rejects(reconcileNileSnapshot(ledger, sources), /test_ledger_corrupted/);
    }
    finally {
        await ledger.close();
    }
});
test('RPC is limited to two read selectors, validates TVM results and caps even an unlabelled body', async () => {
    let body: unknown = { result: { result: true }, transaction: { ret: [{}] }, constant_result: ['0'.repeat(63) + '6'] };
    const calls: {
        url: string;
        body: Record<string, unknown>;
    }[] = [];
    const transport = (async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    assert.throws(() => new NileBalanceRpc('mainnet', 'https://api.trongrid.io', transport));
    const rpc = new NileBalanceRpc('nile', NILE_ORIGINS[0], transport);
    assert.equal(await rpc.decimals(), 6n);
    assert.equal(await rpc.balance(accounts[0].address), 6n);
    assert.ok(calls.every(call => call.url.endsWith('/walletsolidity/triggerconstantcontract') && call.body.contract_address === NILE_TEST_TOKEN));
    assert.equal(calls[1].body.parameter, accounts[0].address.slice(2).padStart(64, '0'));
    body = { result: { result: true }, transaction: { ret: [{ ret: 'FAILED' }] }, constant_result: ['0'.repeat(64)] };
    await assert.rejects(rpc.decimals(), /token_execution_failed/);
    body = { Error: 'unavailable' };
    await assert.rejects(rpc.decimals());
    body = { result: { result: true }, transaction: { ret: [{}] }, constant_result: [['0'.repeat(64)]] };
    await assert.rejects(rpc.decimals(), /invalid_token_response/);
    body = 'x'.repeat(65537);
    await assert.rejects(rpc.decimals(), /rpc_response_limit/);
});
test('transient public RPC failures retry after a pause and respect the caller deadline', async () => {
    let calls = 0;
    const rpc = new NileBalanceRpc('retry', NILE_ORIGINS[0], async () => {
        if (++calls === 1)
            return new Response('temporarily unavailable', { status: 503 });
        return Response.json({ result: { result: true }, transaction: { ret: [{}] }, constant_result: ['0'.repeat(63) + '6'] });
    });
    assert.equal(await rpc.decimals(), 6n);
    assert.equal(calls, 2);
    let abortedCalls = 0;
    const offline = new NileBalanceRpc('offline', NILE_ORIGINS[1], async () => { abortedCalls++; return new Response('', { status: 503 }); });
    await assert.rejects(offline.decimals(AbortSignal.timeout(50)), /reconciliation_deadline/);
    assert.equal(abortedCalls, 1);
});
