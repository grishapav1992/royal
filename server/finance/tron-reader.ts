import { randomUUID } from 'node:crypto';
import { NILE_GENESIS, integer, rejectTron, type TronBlock } from './tron-protocol';
import { NILE_ORIGINS, type TronSource } from './tron-rpc';
import { TronReadStore } from './tron-store';
async function agreed(sources: readonly TronSource[], height: number, signal: AbortSignal): Promise<TronBlock> {
    const blocks = await Promise.all(sources.map(source => source.block(height, signal)));
    if (blocks.some(block => block.height !== height))
        return rejectTron('wrong_block_height');
    if (JSON.stringify(blocks[0]) !== JSON.stringify(blocks[1]))
        return rejectTron('source_disagreement');
    return blocks[0];
}
export async function scanNile(store: TronReadStore, sources: readonly TronSource[], options: {
    maxBlocks?: number;
    overlap?: number;
    signal?: AbortSignal;
    afterCommit?: (block: TronBlock) => Promise<void>;
} = {}) {
    if (sources.length !== 2 || sources[0].id === sources[1].id || sources[0].origin === sources[1].origin
        || sources.some(source => !NILE_ORIGINS.includes(source.origin as typeof NILE_ORIGINS[number]))
        || JSON.stringify(sources.map(source => source.origin).sort()) !== JSON.stringify([...store.config.origins].sort()))
        rejectTron('two_nile_sources_required');
    const maxBlocks = integer(options.maxBlocks ?? 20, 1), overlap = integer(options.overlap ?? 3, 1);
    if (maxBlocks > 20 || overlap > 20)
        rejectTron('scan_limit');
    const owner = randomUUID(), signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
    if (!await store.acquire(owner))
        return { busy: true, blocks: 0, transfers: 0 };
    try {
        const genesis = await Promise.all(sources.map(source => source.genesis(signal)));
        if (genesis.some(hash => hash !== NILE_GENESIS))
            rejectTron('wrong_network');
        const tips = await Promise.all(sources.map(source => source.tip(signal)));
        if (tips.some(tip => tip.timestamp < Date.now() - 300000 || tip.timestamp > Date.now() + 30000))
            rejectTron('source_tip_stale');
        const finalHeight = Math.min(...tips.map(tip => tip.height));
        let cursor = (await store.state()).cursor_height;
        if (cursor !== null && finalHeight < Number(cursor))
            rejectTron('source_behind_cursor');
        // Recheck the saved boundary before agreement on newer blocks can hide a change.
        if (cursor !== null) {
            for (let n = Math.max(store.config.startHeight - 1, Number(cursor) - overlap + 1); n <= Number(cursor); n++) {
                const results = await Promise.allSettled(sources.map(source => source.block(n, signal)));
                for (const result of results)
                    if (result.status === 'fulfilled') {
                        if (result.value.height !== n)
                            rejectTron('wrong_block_height');
                        await store.verifySaved(owner, result.value);
                    }
                for (const result of results)
                    if (result.status === 'rejected')
                        throw result.reason;
            }
        }
        const boundary = await agreed(sources, finalHeight, signal);
        if (tips.some(tip => tip.height === finalHeight && tip.hash !== boundary.hash))
            rejectTron('tip_block_mismatch');
        await store.finalized(owner, finalHeight);
        if (cursor === null) {
            if (finalHeight < store.config.startHeight)
                rejectTron('start_not_finalized');
            const anchor = await agreed(sources, store.config.startHeight - 1, signal);
            await store.commit(owner, anchor, true);
            cursor = anchor.height;
        }
        let blocks = 0, transfers = 0;
        const batchStarted = Date.now();
        for (let n = Number(cursor) + 1; n <= Math.min(finalHeight, Number(cursor) + maxBlocks); n++) {
            if (blocks > 0 && Date.now() - batchStarted > 30000)
                break;
            if (signal.aborted)
                rejectTron('scan_deadline');
            const block = n === finalHeight ? boundary : await agreed(sources, n, signal);
            await store.commit(owner, block);
            blocks++;
            transfers += block.transfers.length;
            await options.afterCommit?.(block);
        }
        await store.success(owner, finalHeight);
        return { busy: false, blocks, transfers, cursorHeight: (await store.state()).cursor_height, finalizedHeight: finalHeight };
    }
    finally {
        await store.release(owner);
    }
}
