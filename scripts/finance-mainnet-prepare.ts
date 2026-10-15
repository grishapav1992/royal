import { writeFileSync } from 'node:fs';
import { MainnetRpc } from '../server/finance/mainnet-rpc';
import { MAINNET_GENESIS, MAINNET_ORIGINS, MAINNET_USDT_TOKEN, validateMainnetConfig } from '../server/finance/mainnet-config';
import { nileHex } from '../server/finance/nile-address';
// Pin the opening reserve before accepting player deposits. No signing or transfers.
try {
    if (process.env.USDT_MAINNET_MODE !== 'pilot-mainnet')
        throw new Error();
    const [accountId, playerAddress, serviceAddress, openingReserveUnits, destination] = process.argv.slice(2);
    if (!destination)
        throw new Error();
    const sources = MAINNET_ORIGINS.map(origin => new MainnetRpc(origin, origin === MAINNET_ORIGINS[0] ? process.env.TRONGRID_API_KEY : undefined));
    const genesis = await Promise.all(sources.map(async (s) => await s.genesis()));
    if (genesis.some(g => g !== MAINNET_GENESIS))
        throw new Error();
    const before = await Promise.all(sources.map(async (s) => await s.tip())), balances = await Promise.all(sources.map(async (s) => await s.balance(nileHex(serviceAddress))));
    const after = await Promise.all(sources.map(async (s) => await s.tip()));
    if (Math.abs(before[0].height - before[1].height) > 10 || after.some((h, i) => h.hash !== before[i].hash)
        || balances.some(n => n !== openingReserveUnits) || before.some(h => Date.now() - h.timestamp > 120000 || h.timestamp > Date.now() + 30000))
        throw new Error();
    const anchorHeight = Math.min(...before.map(h => h.height)), anchors = await Promise.all(sources.map(async (s) => await s.header(anchorHeight)));
    if (anchors[0].hash !== anchors[1].hash)
        throw new Error();
    const config = validateMainnetConfig({ version: 1, network: 'tron-mainnet', genesis: MAINNET_GENESIS, token: MAINNET_USDT_TOKEN,
        accountId, playerAddress, serviceAddress, openingReserveUnits, anchorHeight, anchorHash: anchors[0].hash });
    writeFileSync(destination, JSON.stringify(config) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ok: true, network: 'tron-mainnet', anchorHeight: config.anchorHeight, openingReserveUnits, signingKeysRequired: false }));
}
catch {
    console.error(JSON.stringify({ ok: false, code: 'mainnet_preparation_failed_or_chain_changed' }));
    process.exitCode = 1;
}
