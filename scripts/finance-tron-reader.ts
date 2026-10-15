import { readFileSync, lstatSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { TronReadError, rejectTron } from '../server/finance/tron-protocol';
import { NILE_ORIGINS, NileRpc } from '../server/finance/tron-rpc';
import { scanNile } from '../server/finance/tron-reader';
import { TronReadStore } from '../server/finance/tron-store';
import { snapshotTronStore } from '../server/finance/tron-snapshot';
process.umask(0o077);
async function main() {
    if (process.env.TRON_READER_MODE !== 'watch-only' || process.env.TRON_READER_NETWORK !== 'nile')
        rejectTron('explicit_nile_watch_only_required');
    const command = process.argv[2] ?? 'run';
    if (command === 'probe') {
        const sources = NILE_ORIGINS.map((origin, n) => new NileRpc('nile_' + n, origin));
        const signal = AbortSignal.timeout(60000);
        await Promise.all(sources.map(async (source) => await source.genesis(signal)));
        const tips = await Promise.all(sources.map(async (source) => await source.tip(signal))), height = Math.min(...tips.map(tip => tip.height));
        const blocks = await Promise.all(sources.map(async (source) => await source.block(height, signal)));
        if (JSON.stringify(blocks[0]) !== JSON.stringify(blocks[1]))
            rejectTron('source_disagreement');
        console.log(JSON.stringify({ ok: true, mode: 'watch-only', network: 'nile', height, hash: blocks[0].hash,
            suggestedStartHeight: height - 10, transactions: blocks[0].txIds.length, transfers: blocks[0].transfers.length }));
        return;
    }
    const configFile = process.env.TRON_READER_CONFIG_FILE;
    if (!configFile || lstatSync(configFile).isSymbolicLink() || lstatSync(configFile).size > 4096)
        rejectTron('reader_config_required');
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    if (Object.keys(config).sort().join(',') !== 'network,origins,startHeight' || config.network !== 'nile'
        || !Array.isArray(config.origins) || JSON.stringify([...config.origins].sort()) !== JSON.stringify([...NILE_ORIGINS].sort()))
        rejectTron('invalid_reader_config');
    const store = new TronReadStore(process.env.TRON_READER_SCHEMA ?? 'royal_tron_reader', config, ['status', 'health', 'audit'].includes(command));
    const controller = new AbortController();
    process.once('SIGTERM', () => controller.abort());
    process.once('SIGINT', () => controller.abort());
    try {
        if (command === 'status' || command === 'health') {
            const state = await store.status();
            if (command === 'status')
                console.log(JSON.stringify(state));
            process.exitCode = state.ok ? 0 : 1;
        }
        else if (command === 'audit') {
            console.log(JSON.stringify(await store.audit()));
        }
        else if (command === 'backup') {
            console.log(JSON.stringify(await snapshotTronStore(store, process.env.DATABASE_BACKUP_DIR ?? '/data/backups')));
        }
        else if (command === 'once' || command === 'run') {
            const sources = NILE_ORIGINS.map((origin, index) => new NileRpc('nile_' + index, origin));
            const interval = Number(process.env.TRON_READER_POLL_MS ?? '15000');
            if (!Number.isInteger(interval) || interval < 5000 || interval > 60000)
                rejectTron('invalid_poll_interval');
            do {
                let nextDelay = interval;
                try {
                    const result = await scanNile(store, sources, { signal: controller.signal });
          if (process.env.DATABASE_LOCAL_SNAPSHOTS === 'true' && !result.busy && Date.now() - Number((await store.state()).last_backup_at ?? 0) >= 3600000) {
                        const snapshot = await snapshotTronStore(store, process.env.DATABASE_BACKUP_DIR ?? '/data/backups');
                        console.log(JSON.stringify({ check: 'reader_snapshot', file: snapshot.file, ...snapshot.checks }));
                    }
                    console.log(JSON.stringify({ ok: true, network: 'nile', mode: 'watch-only', ...result }));
                    if (!result.busy && Number(result.cursorHeight) < Number(result.finalizedHeight))
                        nextDelay = 1000;
                }
                catch (error) {
                    const code = error instanceof TronReadError ? error.code : 'reader_operation_failed';
                    await store.failure(code);
                    console.log(JSON.stringify({ ok: false, network: 'nile', mode: 'watch-only', code }));
                    if (command === 'once')
                        process.exitCode = 1;
                }
                if (command === 'once' || controller.signal.aborted)
                    break;
                try {
                    await delay(nextDelay, undefined, { signal: controller.signal });
                }
                catch {
                    break;
                }
            } while (!controller.signal.aborted);
        }
        else
            rejectTron('unknown_reader_command');
    }
    finally {
        await store.close();
    }
}
await main().catch(error => {
    console.log(JSON.stringify({ ok: false, code: error instanceof TronReadError ? error.code : 'reader_operation_failed' }));
    process.exitCode = 1;
});
