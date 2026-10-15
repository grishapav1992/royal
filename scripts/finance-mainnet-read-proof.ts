import { MAINNET_ORIGINS, MAINNET_GENESIS } from '../server/finance/mainnet-config';
import { MainnetRpc } from '../server/finance/mainnet-rpc';
import { nileHex } from '../server/finance/nile-address';
try {
    const sources = MAINNET_ORIGINS.map(origin => new MainnetRpc(origin, origin === MAINNET_ORIGINS[0] ? process.env.TRONGRID_API_KEY : undefined));
    const genesis = await Promise.all(sources.map(async (s) => await s.genesis()));
    if (genesis.some(g => g !== MAINNET_GENESIS))
        throw new Error();
    const tips = await Promise.all(sources.map(async (s) => await s.tip())), height = Math.min(...tips.map(t => t.height)) - 1;
    const blocks = await Promise.all(sources.map(async (s) => await s.block(height)));
    if (JSON.stringify(blocks[0]) !== JSON.stringify(blocks[1]))
        throw new Error();
    const address = process.argv[2], balances = address ? await Promise.all(sources.map(async (s) => await s.balance(nileHex(address)))) : [];
    if (balances.length && balances[0] !== balances[1])
        throw new Error();
    console.log(JSON.stringify({ ok: true, network: 'tron-mainnet', readOnly: true, height, hash: blocks[0].hash, transactions: blocks[0].txIds.length, transfers: blocks[0].transfers.length, ...(balances.length ? { confirmedUsdtUnits: balances[0] } : {}) }));
}
catch {
    console.error(JSON.stringify({ ok: false, code: 'mainnet_read_proof_failed' }));
    process.exitCode = 1;
}
