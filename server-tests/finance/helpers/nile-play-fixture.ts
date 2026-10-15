import { createECDH } from 'node:crypto';
import { NilePlayLedger, type NilePlayConfig } from '../../../server/finance/nile-play-ledger';
import { NileTestLedger, NILE_TEST_ASSET, NILE_TEST_TOKEN } from '../../../server/finance/nile-test-ledger';
import { nilePublicKeyAddress } from '../../../server/finance/nile-address';
import { NILE_GENESIS, type TronBlock } from '../../../server/finance/tron-protocol';
import { NILE_ORIGINS } from '../../../server/finance/tron-rpc';
function address(userId: string, n: number) { const ecdh = createECDH('secp256k1'); ecdh.setPrivateKey(Buffer.from(n.toString(16).padStart(64, '0'), 'hex')); const publicKey = ecdh.getPublicKey('hex', 'uncompressed'); return { userId, address: nilePublicKeyAddress(publicKey), publicKey }; }
const player = address('player', 11), house = address('reserve', 12), sender = address('sender', 13);
export const playTestConfig: NilePlayConfig = { version: 1, source: { version: 1, network: 'nile', genesis: NILE_GENESIS, token: NILE_TEST_TOKEN, scale: 6, asset: NILE_TEST_ASSET, startHeight: 100, readerStartHeight: 100, origins: [...NILE_ORIGINS], addresses: [player, house] }, houseUserId: 'reserve', reserveUserId: 'player', initialReserveUnits: '800000000' };
const hash = (height: number) => height.toString(16).padStart(16, '0') + 'a'.repeat(48);
export function block(height: number, amount = '0', to = player.address): TronBlock { const txId = height.toString(16).padStart(64, '0'); return { height, hash: hash(height), parentHash: hash(height - 1), timestamp: Date.now(), txIds: amount === '0' ? [] : [txId], outcomes: amount === '0' ? [] : [{ txId, status: 'SUCCESS' }], transfers: amount === '0' ? [] : [{ txId, logIndex: 0, contract: NILE_TEST_TOKEN, from: sender.address, to, amountUnits: amount }] }; }
export async function playTestSetup(file = ':memory:', draw: () => number = () => 0, config = playTestConfig, amount = '1000000000', houseAmount = '0') {
    const source = new NileTestLedger(':memory:', config.source);
    await source.ready;
    await source.ingest(block(99), true);
    await source.ingest(block(100, amount));
    if (houseAmount !== '0')
        await source.ingest(block(101, houseAmount, house.address));
    const reconciliation = async () => ({ ok: true, checked_at: new Date().toISOString(), network: 'nile', asset: NILE_TEST_ASSET, testOnly: true, spendable: false, credits: (await source.audit()).credits, liabilitiesUnits: (await source.audit()).balances.reduce((sum, w) => sum + BigInt(w.availableUnits), 0n).toString(), deficitUnits: '0' });
    const ledger = new NilePlayLedger(file, config, false, draw);
    await ledger.ready;
    await ledger.sync(source, await reconciliation());
    return { source, ledger, reconciliation, close: async () => { await source.close(); await ledger.close(); } };
}
