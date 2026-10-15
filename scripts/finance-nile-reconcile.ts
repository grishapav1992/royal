import { loadNileDepositPool } from '../server/finance/nile-deposit-pool';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NileTestLedger, validateNileTestConfig } from '../server/finance/nile-test-ledger';
import { NileBalanceRpc, reconcileNileSnapshot } from '../server/finance/nile-test-reconciliation';
import { NILE_ORIGINS } from '../server/finance/tron-rpc';
import { TronReadError } from '../server/finance/tron-protocol';
let live: NileTestLedger | undefined, snapshot: NileTestLedger | undefined, directory: string | undefined;
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());
try {
    if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile')
        throw new Error();
    const raw = readFileSync(process.env.NILE_TEST_CONFIG_FILE ?? '/config/nile-test.json', 'utf8');
    if (Buffer.byteLength(raw) > 65536)
        throw new Error();
    const config = validateNileTestConfig(JSON.parse(raw));
    live = new NileTestLedger(process.env.NILE_TEST_SCHEMA ?? 'royal_nile_deposits', config, true, loadNileDepositPool());
    const ledger = live;
    const result = await ledger.db.transaction(async () => reconcileNileSnapshot(ledger, NILE_ORIGINS.map((origin, index) => new NileBalanceRpc('nile-' + index, origin)), abort.signal), { readOnly: true });
    console.log(JSON.stringify(result));
    if (!result.ok)
        process.exitCode = 1;
}
catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof TronReadError ? error.code : 'nile_reconciliation_failed' }));
    process.exitCode = 1;
}
finally {
    await live?.close();
    await snapshot?.close();
    if (directory)
        rmSync(directory, { recursive: true, force: true });
}
