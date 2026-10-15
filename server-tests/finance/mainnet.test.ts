import { PostgresDatabase } from '../../server/database';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MainnetLedger } from '../../server/finance/mainnet-ledger';
import { MAINNET_GENESIS, MAINNET_ORIGINS, MAINNET_USDT_TOKEN, validateMainnetConfig, type MainnetConfig } from '../../server/finance/mainnet-config';
import { MainnetRpc, type MainnetSource } from '../../server/finance/mainnet-rpc';
import { scanMainnet } from '../../server/finance/mainnet-scanner';
import { nileBase58, nileHex, nilePublicKeyAddress } from '../../server/finance/nile-address';
import { validUsdtRound, validUsdtWallet } from '../../src/shared/usdtWallet';
import type { TronBlock } from '../../server/finance/tron-protocol';
const address = (n: number) => { const ecdh = createECDH('secp256k1'); ecdh.setPrivateKey(Buffer.from(n.toString(16).padStart(64, '0'), 'hex')); return nileBase58(nilePublicKeyAddress(ecdh.getPublicKey('hex', 'uncompressed'))); };
const hash = (n: number) => n.toString(16).padStart(16, '0') + 'a'.repeat(48);
const timestamp = Date.now();
const config: MainnetConfig = { version: 1, network: 'tron-mainnet', token: MAINNET_USDT_TOKEN, genesis: MAINNET_GENESIS,
    accountId: '12345678-1234-4123-8123-123456789abc', playerAddress: address(31), serviceAddress: address(32), anchorHeight: 100,
    anchorHash: hash(100), openingReserveUnits: '500000000' };
const makeBlock = (height = 101, amount = '10000000', from = nileHex(config.playerAddress), to = nileHex(config.serviceAddress)): TronBlock => {
    const txId = height.toString(16).padStart(64, '0');
    return { height, hash: hash(height), parentHash: hash(height - 1), timestamp,
        txIds: [txId], outcomes: [{ txId, status: 'SUCCESS' }], transfers: [{ txId, logIndex: 0, contract: MAINNET_USDT_TOKEN, from, to, amountUnits: amount }] };
};
async function fixture(file = ':memory:', draw: (max: number) => number = () => 0, openingReserveUnits = config.openingReserveUnits) {
    const ledger = new MainnetLedger(file, { ...config, openingReserveUnits }, draw);
    await ledger.ready;
    await ledger.ingest(makeBlock());
    await ledger.reconcile(101, (BigInt(openingReserveUnits) + 10000000n).toString());
    return ledger;
}
const request = () => ({ id: randomUUID(), stakeUnits: '1000000', gameId: 'royal-coins' as const, input: {} });
test('mainnet is pinned to the official USDT token, separate keys and an explicit account', () => {
    assert.equal(validateMainnetConfig(config), config);
    for (const change of [{ network: 'nile' }, { genesis: hash(0) }, { token: '41' + 'a'.repeat(40) }, { playerAddress: config.serviceAddress }, { accountId: 'alice' }, { privateKey: 'forbidden' }, { anchorHash: hash(99) }, { openingReserveUnits: '1.5' }])
        assert.throws(() => validateMainnetConfig({ ...config, ...change }));
    assert.throws(() => new MainnetRpc('https://nile.trongrid.io'));
});
test('confirmed deposit credits its exact micro-units once and belongs only to the configured account', async () => {
    const ledger = await fixture();
    try {
        assert.equal(await ledger.ingest(makeBlock()), 0);
        assert.equal((await ledger.balances()).player, 10000000n);
        const wallet = await ledger.wallet(config.accountId);
        assert.ok(validUsdtWallet(wallet));
        assert.equal(wallet.state, 'assigned');
        assert.equal((await ledger.wallet(randomUUID())).state, 'unassigned');
        await assert.rejects(async () => await ledger.play(randomUUID(), request()));
        assert.equal((await ledger.audit()).house, 500000000n);
    }
    finally {
        await ledger.close();
    }
});
test('mainnet audits multiple journal pages, bounds wallet history and catches corrupted late postings', async () => {
    const ledger = new MainnetLedger(':memory:', config);
    await ledger.ready;
    const amount = '9007199254740993';
    try {
        await ledger.db.transaction(async () => {
            for (let height = 101; height < 361; height++) await ledger.ingest(makeBlock(height, amount));
        });
        const balances = await ledger.audit();
        assert.equal(balances.player, BigInt(amount) * 260n);
        assert.equal(balances.house, BigInt(config.openingReserveUnits));
        const wallet = await ledger.wallet(config.accountId);
        assert.equal(wallet.state, 'assigned');
        if (wallet.state !== 'assigned') assert.fail('assigned wallet expected');
        assert.equal(wallet.deposits.length, 50);
        assert.equal(wallet.deposits[0].height, 360);
        assert.equal(wallet.deposits.at(-1)!.height, 311);
        await ledger.db.transaction(async () => {
            await ledger.db.exec("SET LOCAL session_replication_role='replica'");
            await ledger.db.prepare("UPDATE entries SET units='1' WHERE seq=260 AND line=0").run();
        });
        await assert.rejects(ledger.audit(), /mainnet_ledger_corrupted/);
    }
    finally {
        await ledger.close();
    }
});
test('wrong tokens and zero transfers never become USDT, unknown senders remain unallocated', async () => {
    const ledger = await fixture();
    try {
        const fake = makeBlock(102);
        fake.transfers[0].contract = '41' + 'a'.repeat(40);
        await ledger.ingest(fake);
        await ledger.ingest(makeBlock(103, '0'));
        await ledger.ingest(makeBlock(104, '1234567', nileHex(address(33))));
        assert.equal((await ledger.audit()).player, 10000000n);
        assert.equal((await ledger.balances()).unallocated, 1234567n);
        assert.equal((await ledger.balances()).house, 500000000n);
    }
    finally {
        await ledger.close();
    }
});
test('failed execution, duplicate logs, missing transactions and a skipped block reject credit atomically', async () => {
    const ledger = await fixture();
    try {
        for (const change of [(b: TronBlock) => { b.outcomes[0].status = 'REVERT'; }, (b: TronBlock) => { b.transfers.push(b.transfers[0]); }, (b: TronBlock) => { b.txIds = []; }, (b: TronBlock) => { b.parentHash = hash(1); }]) {
            const block = makeBlock(102);
            change(block);
            await assert.rejects(async () => await ledger.ingest(block));
            assert.equal((await ledger.cursor()).height, 101);
            assert.equal((await ledger.balances()).player, 10000000n);
        }
        await assert.rejects(async () => await ledger.ingest(makeBlock(103)));
    }
    finally {
        await ledger.close();
    }
});
test('replaying a changed finalized block permanently halts bets', async () => {
    const ledger = await fixture();
    try {
        await assert.rejects(async () => await ledger.ingest(makeBlock(101, '9999999')));
        assert.equal(await ledger.isReady(), false);
        await assert.rejects(async () => await ledger.play(config.accountId, request()));
        assert.ok((await ledger.state()).halted);
    }
    finally {
        await ledger.close();
    }
});
test('reserve covers a winning round; retries recover the same result without drawing or paying twice', async () => {
    let draws = 0;
    const ledger = await fixture(':memory:', () => { draws++; return 0; });
    try {
        const operation = request(), result = await ledger.play(config.accountId, operation);
        assert.equal(result.round.payoutUnits, '12000000');
        assert.equal((await ledger.balances()).player, 21000000n);
        assert.equal((await ledger.balances()).house, 489000000n);
        await ledger.fail('network_lost');
        const replay = await ledger.play(config.accountId, operation);
        assert.equal(replay.replayed, true);
        assert.deepEqual(replay.round, result.round);
        assert.equal(draws, 3);
        await assert.rejects(async () => await ledger.play(config.accountId, { ...operation, stakeUnits: '2000000' }));
        assert.equal((await ledger.audit()).player, 21000000n);
    }
    finally {
        await ledger.close();
    }
});
test('roulette uses server results and pays exact USDT, caller-selected payouts are rejected', async () => {
    const ledger = await fixture();
    try {
        const operation = { ...request(), gameId: 'royal-roulette' as const, input: { bet: 'number' as const, number: 0 } };
        await assert.rejects(async () => await ledger.play(config.accountId, { ...operation, payoutUnits: '999999999' }));
        const result = await ledger.play(config.accountId, operation);
        assert.equal(result.round.payoutUnits, '36000000');
        assert.equal((await ledger.audit()).player, 45000000n);
        assert.ok(validUsdtRound(result.round));
        assert.equal(validUsdtRound({ ...result.round, multiplier: 1.5 }), false);
    }
    finally {
        await ledger.close();
    }
});
test('insufficient reserve, insufficient funds and stale confirmation reject fresh bets before drawing', async () => {
    let draws = 0;
    const ledger = await fixture(':memory:', () => { draws++; return 0; }, '0');
    try {
        await assert.rejects(async () => await ledger.play(config.accountId, request()));
        assert.equal(draws, 0);
    }
    finally {
        await ledger.close();
    }
    const funded = await fixture();
    try {
        await assert.rejects(async () => await funded.play(config.accountId, { ...request(), stakeUnits: '10000000', gameId: 'royal-roulette', input: { bet: 'number', number: 0 } }, Date.now() + 61000));
        await funded.reconcile(101, '510000000');
        await funded.play(config.accountId, { ...request(), stakeUnits: '10000000', input: {} });
        await assert.rejects(async () => await funded.play(config.accountId, { ...request(), stakeUnits: '100000000' }));
    }
    finally {
        await funded.close();
    }
});
test('outgoing custody money reduces only the house reserve and a deficit halts without erasing deposits', async () => {
    const ledger = await fixture();
    try {
        await ledger.ingest(makeBlock(102, '501000000', nileHex(config.serviceAddress), nileHex(address(33))));
        assert.equal((await ledger.balances()).player, 10000000n);
        assert.equal((await ledger.balances()).house, -1000000n);
        assert.equal(await ledger.isReady(), false);
        assert.equal((await ledger.audit()).player, 10000000n);
        await assert.rejects(async () => await ledger.play(config.accountId, request()));
    }
    finally {
        await ledger.close();
    }
});
test('balances, idempotency and the audit survive restart and a consistent database backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'royal-mainnet-test-')), file = join(directory, 'ledger.sqlite'), copy = join(directory, 'copy.pg.json');
    try {
        const ledger = await fixture(file), operation = request(), result = await ledger.play(config.accountId, operation);
        await ledger.db.snapshot(copy);
        await ledger.close();
        const database = await PostgresDatabase.restore(copy);
        for (const adapter of [undefined, database]) {
            const reopened = new MainnetLedger(adapter?.schema ?? file, config, undefined, adapter);
            await reopened.ready;
            try {
                assert.deepEqual((await reopened.play(config.accountId, operation)).round, result.round);
                assert.equal((await reopened.audit()).player, 21000000n);
            }
            finally {
                if (adapter)
                    await adapter.dropSchema();
                await reopened.close();
            }
        }
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('journal mutations and altered accounting are rejected by triggers and audit', async () => {
    const ledger = await fixture();
    try {
        await assert.rejects(async () => await ledger.db.exec("UPDATE entries SET units='1'"));
        await assert.rejects(async () => await ledger.db.exec('DELETE FROM blocks'));
        await ledger.db.exec("DROP TRIGGER \"immutable_entries_UPDATE\" ON entries");
        await ledger.db.exec("UPDATE entries SET units='1' WHERE account='player'");
        await assert.rejects(async () => await ledger.audit());
    }
    finally {
        await ledger.close();
    }
});
test('an interrupted deposit or game rolls back every posting and its checkpoint', async () => {
    const ledger = await fixture();
    try {
        await ledger.db.exec("CREATE OR REPLACE FUNCTION fail_deposit_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account='player' THEN RAISE EXCEPTION 'injected interruption'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_deposit BEFORE INSERT ON entries FOR EACH ROW EXECUTE FUNCTION fail_deposit_fn();");
        await assert.rejects(async () => await ledger.ingest(makeBlock(102, '5000000')));
        assert.equal((await ledger.cursor()).height, 101);
        assert.equal((await ledger.balances()).player, 10000000n);
        await ledger.db.exec('DROP TRIGGER fail_deposit ON entries');
        await ledger.ingest(makeBlock(102, '5000000'));
        await ledger.reconcile(102, '515000000');
        await ledger.db.exec("CREATE OR REPLACE FUNCTION fail_round_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account='house' THEN RAISE EXCEPTION 'injected interruption'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_round BEFORE INSERT ON entries FOR EACH ROW EXECUTE FUNCTION fail_round_fn();");
        const operation = request();
        await assert.rejects(async () => await ledger.play(config.accountId, operation));
        assert.equal((await ledger.balances()).player, 15000000n);
        assert.equal((await ledger.balances()).house, 500000000n);
        await ledger.db.exec('DROP TRIGGER fail_round ON entries');
        assert.equal((await ledger.play(config.accountId, operation)).replayed, false);
        assert.equal((await ledger.play(config.accountId, operation)).replayed, true);
        assert.equal((await ledger.audit()).player, 26000000n);
    }
    finally {
        await ledger.close();
    }
});
test('a deposit larger than the JavaScript integer range preserves every micro-unit', async () => {
    const ledger = new MainnetLedger(':memory:', config, () => 0);
    await ledger.ready;
    try {
        const amount = '9007199254740993';
        await ledger.ingest(makeBlock(101, amount));
        await ledger.reconcile(101, (BigInt(amount) + 500000000n).toString());
        const result = await ledger.play(config.accountId, request());
        assert.equal(result.wallet.state, 'assigned');
        if (result.wallet.state === 'assigned')
            assert.equal(result.wallet.balanceUnits, (BigInt(amount) + 11000000n).toString());
        assert.equal((await ledger.audit()).player, BigInt(amount) + 11000000n);
    }
    finally {
        await ledger.close();
    }
});
test('two database connections cannot debit the last losing stake twice', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'royal-mainnet-concurrent-')), file = join(directory, 'ledger.sqlite');
    let firstDraw = 0, secondDraw = 0;
    const first = await fixture(file, () => (firstDraw++ % 3));
    const second = new MainnetLedger(file, config, () => (secondDraw++ % 3));
    await second.ready;
    try {
        const results = await Promise.allSettled([
            first.play(config.accountId, { ...request(), stakeUnits: '10000000' }),
            second.play(config.accountId, { ...request(), stakeUnits: '10000000' }),
        ]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.filter(result => result.status === 'rejected').length, 1);
        assert.equal((await first.balances()).player, 0n);
        assert.equal((await second.audit()).player, 0n);
    } finally {
        await first.close(); await second.close(); rmSync(directory, { recursive: true, force: true });
    }
});
function source(origin: string, block = makeBlock()): MainnetSource {
    return { origin, genesis: async () => MAINNET_GENESIS, tip: async () => ({ ...block }), header: async (height) => ({ height, hash: hash(height), parentHash: hash(height - 1), timestamp: Date.now() }),
        block: async () => block, balance: async () => '510000000' };
}
test('scanner checks both networks, finality, block agreement and exact custody before enabling games', async () => {
    const ledger = new MainnetLedger(':memory:', config);
    await ledger.ready;
    try {
        const sources = MAINNET_ORIGINS.map(origin => source(origin));
        assert.equal(await scanMainnet(ledger, sources), true);
        assert.equal((await ledger.balances()).player, 10000000n);
        const wrong = { ...sources[1], genesis: async () => 'nile' };
        await assert.rejects(scanMainnet(ledger, [sources[0], wrong]));
        assert.equal(await ledger.isReady(), false);
        assert.equal(await scanMainnet(ledger, sources), true);
        const deficit = { ...sources[1], balance: async () => '500000000' };
        assert.equal(await scanMainnet(ledger, [sources[0], deficit]), false);
        assert.equal(await ledger.isReady(), false);
    }
    finally {
        await ledger.close();
    }
});
test('disagreeing sources never credit, and scanning a moving latest balance keeps bets disabled', async () => {
    const ledger = new MainnetLedger(':memory:', config);
    await ledger.ready;
    try {
        await assert.rejects(scanMainnet(ledger, [source(MAINNET_ORIGINS[0]), source(MAINNET_ORIGINS[1], makeBlock(101, '9999999'))]));
        assert.equal((await ledger.balances()).player, 0n);
        assert.equal((await ledger.cursor()).height, 100);
        let calls = 0;
        const moving = source(MAINNET_ORIGINS[1]);
        moving.tip = async () => ({ ...makeBlock(++calls > 2 ? 102 : 101) });
        assert.equal(await scanMainnet(ledger, [source(MAINNET_ORIGINS[0]), moving]), false);
        assert.equal(await ledger.isReady(), false);
    }
    finally {
        await ledger.close();
    }
});
test('small finalized node lag is safe only with stable boundaries and exact matching custody', async () => {
    const ledger = await fixture();
    try {
        const behind = source(MAINNET_ORIGINS[0]), ahead = source(MAINNET_ORIGINS[1]);
        ahead.tip = async () => ({ ...makeBlock(103) });
        assert.equal(await scanMainnet(ledger, [behind, ahead]), true);
        assert.equal((await ledger.cursor()).height, 101);
        assert.equal((await ledger.balances()).player, 10000000n);
        ahead.balance = async () => '520000000';
        assert.equal(await scanMainnet(ledger, [behind, ahead]), false);
        assert.equal(await ledger.isReady(), false);
        assert.equal((await ledger.balances()).player, 10000000n);
        ahead.balance = async () => '510000000';
        ahead.tip = async () => ({ ...makeBlock(112) });
        assert.equal(await scanMainnet(ledger, [behind, ahead]), false);
        assert.equal(await ledger.isReady(), false);
    }
    finally {
        await ledger.close();
    }
});

test('Casino USDT reserves bankroll, persists hidden Tower, restores and settles exact micro-units once', async () => {
  let draws=0;
  const ledger=await fixture(':memory:',()=>{draws++;return 0;});
  const op={id:randomUUID(),gameId:'github-tower' as const,action:'start' as const,stakeUnits:'1000000',settings:{difficulty:'easy' as const}};
  const pick={id:randomUUID(),gameId:op.gameId,action:'pick' as const,sessionId:op.id,choice:1};
  const cashout={id:randomUUID(),gameId:op.gameId,action:'cashout' as const,sessionId:op.id};
  try {
    const first=await ledger.casinoPlay(config.accountId,op);
    assert.equal((await ledger.balances()).player,9000000n);assert.equal(first.session.payoutUnits,'1000000');assert(!('dragons' in first.session));assert.equal(draws,9);
    const replays=await Promise.all([ledger.casinoPlay(config.accountId,op),ledger.casinoPlay(config.accountId,op)]);
    assert(replays.every(r=>r.replayed));assert.equal(draws,9);assert.equal((await ledger.casinoWallet(config.accountId)).sessions[0].id,op.id);
    await assert.rejects(ledger.casinoPlay(config.accountId,{...op,id:randomUUID()}));await assert.rejects(ledger.casinoPlay(randomUUID(),pick));await assert.rejects(ledger.casinoPlay(config.accountId,{...op,stakeUnits:'2000000'}));
    const next=await ledger.casinoPlay(config.accountId,pick);assert.equal(next.session.payoutUnits,'1320000');assert(!('dragons' in next.session));
    const paid=await ledger.casinoPlay(config.accountId,cashout);assert.equal(paid.session.state,'cashed_out');assert.equal(paid.session.dragons!.length,9);assert.equal((await ledger.audit()).player,10320000n);assert.equal((await ledger.audit()).house,499680000n);
    assert.equal((await ledger.casinoWallet(config.accountId)).sessions.length,0);await ledger.fail('network_lost');assert.equal((await ledger.casinoPlay(config.accountId,cashout)).replayed,true);assert.equal((await ledger.casinoPlay(config.accountId,op)).session.state,'cashed_out');assert.equal(draws,9);
    await assert.rejects(ledger.casinoPlay(config.accountId,{...cashout,id:randomUUID()}));assert.equal((await ledger.audit()).player,10320000n);
  }finally{await ledger.close();}
});
test('Casino USDT rejects insufficient coverage before drawing and isolates request IDs across instant games',async()=>{
  let draws=0;const ledger=await fixture(':memory:',()=>{draws++;return 0;},'170000000');
  try{
    const op={id:randomUUID(),gameId:'github-hilo' as const,action:'start' as const,stakeUnits:'1000000',settings:{}};
    const r=await ledger.casinoPlay(config.accountId,op);assert.equal(r.session.cards!.length,1);assert.equal(draws,6);
    await assert.rejects(ledger.play(config.accountId,{...request(),id:op.id}));await assert.rejects(ledger.play(config.accountId,request()));assert.equal(draws,6);
    await assert.rejects(ledger.casinoPlay(config.accountId,{...op,id:randomUUID(),gameId:'github-tower',settings:{difficulty:'hard'}}));assert.equal(draws,6);
    await assert.rejects(ledger.casinoPlay(config.accountId,{id:randomUUID(),gameId:op.gameId,action:'pick',sessionId:op.id,choice:'lower'}));
    const lost=await ledger.casinoPlay(config.accountId,{id:randomUUID(),gameId:op.gameId,action:'pick',sessionId:op.id,choice:'higher'});assert.equal(lost.session.state,'lost');assert.equal(lost.session.payoutUnits,'0');assert.equal((await ledger.audit()).player,9000000n);
    const instant=request();await ledger.play(config.accountId,instant);await assert.rejects(ledger.casinoPlay(config.accountId,{...op,id:instant.id}));assert.equal((await ledger.audit()).player,20000000n);
  }finally{await ledger.close();}
});
test('Hi-Lo USDT pays exact two-win product, immutable journal catches a forged terminal payout',async()=>{
  const ranks=[0,0,6,0,12,0];const ledger=await fixture(':memory:',()=>ranks.shift()!);
  try{
    const op={id:randomUUID(),gameId:'github-hilo' as const,action:'start' as const,stakeUnits:'1000000',settings:{}};
    await ledger.casinoPlay(config.accountId,op);
    const move=()=>({id:randomUUID(),gameId:op.gameId,action:'pick' as const,sessionId:op.id,choice:'higher' as const});
    await ledger.casinoPlay(config.accountId,move());const paid=await ledger.casinoPlay(config.accountId,move());assert.equal(paid.session.state,'cashed_out');assert.equal(paid.session.payoutUnits,'2323750');assert.equal((await ledger.audit()).player,11323750n);
    await assert.rejects(ledger.db.exec("UPDATE events SET payload='{}' WHERE kind='casino'"));
    await ledger.db.transaction(async()=>{await ledger.db.exec("SET LOCAL session_replication_role='replica'");await ledger.db.exec("UPDATE entries SET units='999999999' WHERE seq=(SELECT max(seq) FROM events) AND account='player'");});await assert.rejects(ledger.audit(),/mainnet_ledger_corrupted/);
  }finally{await ledger.close();}
});
test('Casino USDT active party and retries survive reopening of the ledger without revealing future cards',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'royal-casino-restart-')),file=join(dir,'casino.pg');
  const op={id:randomUUID(),gameId:'github-tower' as const,action:'start' as const,stakeUnits:'1000000',settings:{difficulty:'medium' as const}};
  try{
    const first=await fixture(file);await first.casinoPlay(config.accountId,op);await first.close();
    const reopened=new MainnetLedger(file,config,()=>{throw Error('must not redraw');});await reopened.ready;
    try{assert.equal((await reopened.casinoWallet(config.accountId)).sessions[0].id,op.id);assert.equal((await reopened.casinoPlay(config.accountId,op)).replayed,true);await reopened.reconcile(101,'510000000');await reopened.casinoPlay(config.accountId,{id:randomUUID(),gameId:op.gameId,action:'pick',sessionId:op.id,choice:1});const paid=await reopened.casinoPlay(config.accountId,{id:randomUUID(),gameId:op.gameId,action:'cashout',sessionId:op.id});assert.equal(paid.session.payoutUnits,'1485000');assert.equal((await reopened.audit()).player,10485000n);}finally{await reopened.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});
