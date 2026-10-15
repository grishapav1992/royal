import { digest, rejectTron, type TronBlock } from './tron-protocol';
import { TronReadStore } from './tron-store';
import { NileTestLedger } from './nile-test-ledger';
// The reader schema is accessed read-only. This worker has no RPC or signing access.
export async function creditNileObservedBlocks(ledger: NileTestLedger, reader: TronReadStore, maxBlocks = 100) {
    if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 100)
        rejectTron('invalid_test_batch');
    if (reader.config.startHeight !== ledger.config.readerStartHeight
        || JSON.stringify([...reader.config.origins].sort()) !== JSON.stringify([...ledger.config.origins].sort()))
        rejectTron('test_reader_mismatch');
    await Promise.all([reader.ready, ledger.ready]);
    return reader.db.transaction(async () => {
        const source = await reader.state(), state = await ledger.state();
        const savedBlock = async (height: number) => {
            const row = await reader.db.prepare('SELECT * FROM blocks WHERE height=?').get(height);
            if (!row || row.payload_sha256 !== digest(String(row.payload)))
                return rejectTron('test_source_corrupted');
            const block = JSON.parse(String(row.payload)) as TronBlock;
            if (block.height !== height || row.hash !== block.hash || row.parent_hash !== block.parentHash)
                rejectTron('test_source_corrupted');
            return block;
        };
        // Check already credited history even when the source reports a transient failure.
        if (state.cursor_hash)
            for (let height = Math.max(ledger.config.startHeight - 1, Number(state.cursor_height) - 2); height <= Number(state.cursor_height); height++) {
                try {
                    await ledger.verifySaved(await savedBlock(height));
                }
                catch (error) {
                    await ledger.halt('test_chain_changed');
                    throw error;
                }
            }
        if (source.halted_reason) {
            await ledger.halt('test_reader_halted');
            rejectTron('test_reader_halted');
        }
        if (source.last_error || Number(source.last_success_at ?? 0) < Date.now() - 180000
            || Number(source.finalized_height) - Number(source.cursor_height) > 100
            || Number(source.finalized_height) < Number(source.cursor_height))
            rejectTron('test_reader_not_ready');
        if (state.halted_reason)
            rejectTron('test_ledger_halted');
        const tip = Number(source.cursor_height);
        if (tip < Number(state.cursor_height))
            rejectTron('test_source_behind');
        if (!state.cursor_hash)
            await ledger.ingest(await savedBlock(ledger.config.startHeight - 1), true);
        let blocks = 0, credits = 0;
        for (let height = Number((await ledger.state()).cursor_height) + 1; height <= tip && blocks < maxBlocks; height++) {
            credits += await ledger.ingest(await savedBlock(height));
            blocks++;
        }
        await ledger.success();
        return { ok: true, blocks, credits, cursorHeight: (await ledger.state()).cursor_height, readerHeight: tip };
    }, { readOnly: true });
}
