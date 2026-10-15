import { loadNileDepositPool } from '../server/finance/nile-deposit-pool';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NileTestLedger, validateNileTestConfig } from '../server/finance/nile-test-ledger';
import { creditNileObservedBlocks } from '../server/finance/nile-test-creditor';
import { snapshotNileTestLedger, verifyNileTestSnapshot } from '../server/finance/nile-test-snapshot';
import { TronReadStore } from '../server/finance/tron-store';
import { TronReadError } from '../server/finance/tron-protocol';
const command = process.argv[2] ?? 'status';
const signal = new AbortController();
process.on('SIGTERM', () => signal.abort());
process.on('SIGINT', () => signal.abort());
let ledger: NileTestLedger | undefined, reader: TronReadStore | undefined;
try {
    if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile')
        throw new Error();
    if (!['run', 'once', 'status', 'health', 'audit', 'backup', 'verify-backup'].includes(command))
        throw new Error();
    const text = readFileSync(process.env.NILE_TEST_CONFIG_FILE ?? '/config/nile-test.json', 'utf8');
    if (Buffer.byteLength(text) > 65536)
        throw new Error();
    const config = validateNileTestConfig(JSON.parse(text));
    const pool = loadNileDepositPool();
    const file = process.env.NILE_TEST_SCHEMA ?? 'royal_nile_deposits';
    if (command === 'verify-backup') {
        console.log(JSON.stringify(await verifyNileTestSnapshot(process.argv[3], config, process.argv[4], pool)));
    }
    else {
        ledger = new NileTestLedger(file, config, ['status', 'health', 'audit'].includes(command), pool);
        if (command === 'status' || command === 'health') {
            const status = await ledger.status();
            console.log(JSON.stringify(status));
            if (command === 'health' && !status.ok)
                process.exitCode = 1;
        }
        else if (command === 'audit')
            console.log(JSON.stringify(await ledger.audit()));
        else if (command === 'backup')
            console.log(JSON.stringify(await snapshotNileTestLedger(ledger, process.env.DATABASE_BACKUP_DIR ?? '/data/backups')));
        else {
            await ledger.audit();
            reader = new TronReadStore(process.env.TRON_READER_SCHEMA ?? 'royal_tron_reader', {
                network: 'nile', startHeight: config.readerStartHeight, origins: config.origins,
            }, true);
            try {
                await reader.audit();
            }
            catch (error) {
                await ledger.halt('test_source_corrupted');
                throw error;
            }
            do {
                try {
                    const result = await creditNileObservedBlocks(ledger, reader);
                    if (process.env.DATABASE_LOCAL_SNAPSHOTS === 'true' && Date.now() - Number((await ledger.state()).last_backup_at ?? 0) >= 3600000)
                        await snapshotNileTestLedger(ledger, process.env.DATABASE_BACKUP_DIR ?? '/data/backups');
                    console.log(JSON.stringify(result));
                }
                catch (error) {
                    const code = error instanceof TronReadError ? error.code : 'test_credit_failed';
                    await ledger.failure(code);
                    console.error(JSON.stringify({ ok: false, code }));
                    if (command === 'once') {
                        process.exitCode = 1;
                        break;
                    }
                }
                if (command === 'run')
                    await delay(5000, undefined, { signal: signal.signal }).catch(() => { });
            } while (command === 'run' && !signal.signal.aborted);
        }
    }
}
catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof TronReadError ? error.code : 'test_creditor_start_failed' }));
    process.exitCode = 1;
}
finally {
    reader?.close();
    ledger?.close();
}
