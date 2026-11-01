import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { MainnetLedger } from '../../server/finance/mainnet-ledger';
import { MAINNET_GENESIS, MAINNET_USDT_TOKEN, type MainnetConfig } from '../../server/finance/mainnet-config';
import { nileBase58, nileHex, nilePublicKeyAddress } from '../../server/finance/nile-address';
import { legacyCasinoPayout, legacyCasinoReservation, type LegacyTowerState } from '../../server/games/legacyCasinoSessions';
import type { CasinoEvent } from '../../server/finance/mainnet-casino';

const address = (n: number) => {
  const key = createECDH('secp256k1'); key.setPrivateKey(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
  return nileBase58(nilePublicKeyAddress(key.getPublicKey('hex', 'uncompressed')));
};
const hash = (n: number) => n.toString(16).padStart(16, '0') + 'a'.repeat(48);
async function fixture() {
  const config: MainnetConfig = { version: 1, network: 'tron-mainnet', token: MAINNET_USDT_TOKEN, genesis: MAINNET_GENESIS,
    accountId: randomUUID(), playerAddress: address(31), serviceAddress: address(32), anchorHeight: 100,
    anchorHash: hash(100), openingReserveUnits: '500000000' };
  const name = 'removed_tower_' + randomUUID().replaceAll('-', '');
  const ledger = new MainnetLedger(name, config, () => { throw Error('Removed game must not draw'); });
  await ledger.ready;
  const txId = '1'.repeat(64);
  await ledger.ingest({ height: 101, hash: hash(101), parentHash: hash(100), timestamp: Date.now(), txIds: [txId],
    outcomes: [{ txId, status: 'SUCCESS' }], transfers: [{ txId, logIndex: 0, contract: MAINNET_USDT_TOKEN,
      from: nileHex(config.playerAddress), to: nileHex(config.serviceAddress), amountUnits: '10000000' }] });
  await ledger.reconcile(101, '510000000');
  return { ledger, config, name };
}

async function seedAcceptedHistory(ledger: MainnetLedger, account: string, steps: 0 | 1) {
  const initial: LegacyTowerState = { id:randomUUID(),gameId:'github-tower',rulesVersion:1,state:'active',stakeUnits:'1000000',
    settings:{difficulty:'easy'},choices:[],cards:[],dragons:Array(9).fill(0) };
  const append = async (event: CasinoEvent) => (ledger as any).append('casino:' + account + ':' + event.id, 'casino', event,
    [{ account: 'player', units: event.deltaUnits }, { account: 'house', units: (-BigInt(event.deltaUnits)).toString() }]);
  let state: LegacyTowerState = initial;
  await ledger.db.transaction(async () => {
    await append({ accountId: account, id: initial.id, createdAt: Date.now(),
      request: { id: initial.id, gameId: initial.gameId, action: 'start', stakeUnits: initial.stakeUnits, settings: initial.settings },
      session: initial, deltaUnits: '-' + initial.stakeUnits, reserveUnits: legacyCasinoReservation(initial).toString() });
    if (steps) {
      state = { ...structuredClone(initial), choices: [1] };
      const id = randomUUID();
      await append({ accountId: account, id, createdAt: Date.now(),
        request: { id, gameId: initial.gameId, action: 'pick', sessionId: initial.id, choice: 1 }, session: state,
        deltaUnits: '0', reserveUnits: legacyCasinoReservation(state).toString() });
    }
  });
  await ledger.audit();
  return state;
}

for (const steps of [0, 1] as const) test(`removed mainnet Tower keeps old history and settles ${steps ? 'cashout' : 'refund'} once after reopening`, async () => {
  const { ledger, config, name } = await fixture();
  const state = await seedAcceptedHistory(ledger, config.accountId, steps);
  const original = (await ledger.db.prepare("SELECT payload FROM events WHERE id=?").get('casino:' + config.accountId + ':' + state.id))!.payload;
  await ledger.close();
  const reopened = new MainnetLedger(name, config, () => { throw Error('must not redraw'); });
  try {
    await reopened.ready;
    const expected = 9000000n + legacyCasinoPayout(state);
    const replies = await Promise.all([reopened.casinoWallet(config.accountId), reopened.wallet(config.accountId)]);
    assert.deepEqual(replies[0].sessions, []); assert.equal(replies[0].wallet.state, 'assigned');
    if (replies[0].wallet.state !== 'assigned') assert.fail('wallet must be assigned');
    assert.equal(replies[0].wallet.balanceUnits, String(expected));
    assert.equal((await reopened.audit()).player, expected);
    assert.equal((await reopened.db.prepare("SELECT COUNT(*) AS n FROM events WHERE payload::jsonb->'request'->>'action'='retire'").get())!.n, 1);
    assert.equal((await reopened.db.prepare('SELECT payload FROM events WHERE id=?').get('casino:' + config.accountId + ':' + state.id))!.payload, original);
    await reopened.wallet(config.accountId); await reopened.casinoWallet(config.accountId);
    assert.equal((await reopened.audit()).player, expected);
    for (const action of ['start', 'pick', 'cashout', 'retire']) {
      await assert.rejects(reopened.casinoPlay(config.accountId, { id: randomUUID(), gameId: state.gameId, action,
        sessionId: state.id, choice: 1, stakeUnits: state.stakeUnits, settings: state.settings }));
    }
  } finally { await reopened.close(); }
});

test('failed mainnet retirement append preserves the old active state and its reservation', async () => {
  const { ledger, config } = await fixture();
  try {
    await seedAcceptedHistory(ledger, config.accountId, 1);
    await ledger.db.exec("CREATE FUNCTION fail_removed_mainnet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload::jsonb->'request'->>'action'='retire' THEN RAISE EXCEPTION 'retirement interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_removed_mainnet BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION fail_removed_mainnet()");
    await assert.rejects(ledger.wallet(config.accountId), /retirement interrupted/);
    assert.equal((await ledger.balances()).player, 9000000n);
    await ledger.db.exec('DROP TRIGGER fail_removed_mainnet ON events');
    assert.equal((await ledger.audit()).player, 9000000n);
    await ledger.wallet(config.accountId);
    assert.equal((await ledger.audit()).player, 10320000n);
  } finally { await ledger.close(); }
});
