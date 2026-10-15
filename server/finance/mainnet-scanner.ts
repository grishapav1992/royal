import { MAINNET_GENESIS, MAINNET_ORIGINS, usdtFail } from './mainnet-config';
import { nileHex } from './nile-address';
import type { MainnetLedger } from './mainnet-ledger';
import type { MainnetSource } from './mainnet-rpc';
export async function scanMainnet(ledger: MainnetLedger, sources: MainnetSource[], signal = AbortSignal.timeout(45000)) {
    if (sources.length !== 2 || JSON.stringify(sources.map(s => s.origin).sort()) !== JSON.stringify([...MAINNET_ORIGINS].sort()))
        usdtFail('independent_mainnet_sources_required', 503);
    await ledger.fail('mainnet_scan_in_progress');
    try {
        const genesis = await Promise.all(sources.map(s => s.genesis(signal)));
        if (genesis.some(g => g !== MAINNET_GENESIS))
            usdtFail('mainnet_wrong_network', 503);
        const cursor = await ledger.cursor(), anchor = await Promise.all(sources.map(s => s.header(cursor.height, signal)));
        if (anchor.some(h => h.hash !== cursor.hash)) {
            await ledger.halt('mainnet_finalized_block_changed');
            usdtFail('mainnet_finalized_block_changed', 503);
        }
        const tips = await Promise.all(sources.map(s => s.tip(signal))), end = Math.min(...tips.map(h => h.height));
        if (end < cursor.height || tips.some(t => t.timestamp < Date.now() - 120000 || t.timestamp > Date.now() + 30000))
            usdtFail('mainnet_stale_source', 503);
        for (let height = cursor.height + 1; height <= Math.min(end, cursor.height + 100); height++) {
            const blocks = await Promise.all(sources.map(s => s.block(height, signal)));
            if (JSON.stringify(blocks[0]) !== JSON.stringify(blocks[1]))
                usdtFail('mainnet_sources_disagree', 503);
            await ledger.ingest(blocks[0]);
        }
        // Solidified nodes can lag each other. Both must report the exact custody
        // total of the agreed journal at a stable, recent boundary; never mint a
        // journal credit from a balance excess or advance past their common height.
        const before = await Promise.all(sources.map(s => s.tip(signal)));
        const current = await ledger.cursor();
        if (before.some(h => h.height < current.height || h.height > current.height + 10
            || h.timestamp < Date.now() - 120000 || h.timestamp > Date.now() + 30000))
            return false;
        if (before[0].height === before[1].height && before[0].hash !== before[1].hash)
            usdtFail('mainnet_sources_disagree', 503);
        const balances = await Promise.all(sources.map(s => s.balance(nileHex(ledger.config.serviceAddress), signal)));
        const after = await Promise.all(sources.map(s => s.tip(signal)));
        if (after.some((h, i) => h.hash !== before[i].hash) || balances[0] !== balances[1])
            return false;
        await ledger.reconcile((await ledger.cursor()).height, balances[0]);
        return await ledger.isReady();
    }
    catch (e) {
        await ledger.fail('mainnet_scan_unavailable');
        throw e;
    }
}
