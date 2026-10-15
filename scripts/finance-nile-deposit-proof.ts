import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NileTestLedger, validateNileTestConfig } from '../server/finance/nile-test-ledger';
import { verifyNileDeposit } from '../server/finance/nile-deposit-proof';
import { NileRpc, NILE_ORIGINS } from '../server/finance/tron-rpc';
import { TronReadError } from '../server/finance/tron-protocol';
let live: NileTestLedger | undefined, snapshot: NileTestLedger | undefined, directory: string | undefined;
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());
try {
    if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile'
        || process.argv.length < 3 || process.argv.length > 4)
        throw new Error();
    const raw = readFileSync(process.env.NILE_TEST_CONFIG_FILE ?? '/config/nile-test.json', 'utf8');
    if (Buffer.byteLength(raw) > 65536)
        throw new Error();
    const config = validateNileTestConfig(JSON.parse(raw));
    live = new NileTestLedger(process.env.NILE_TEST_SCHEMA ?? 'royal_nile_deposits', config, true);
    const ledger = live;
    const result = await ledger.db.transaction(async () => verifyNileDeposit(ledger, process.argv[2], NILE_ORIGINS.map((origin, index) => new NileRpc('nile-' + index, origin)), process.argv[3]?.toLowerCase(), abort.signal), { readOnly: true });
    console.log(JSON.stringify(result));
    if (!result.ok)
        process.exitCode = 2;
}
catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof TronReadError ? error.code : 'nile_deposit_proof_failed' }));
    process.exitCode = 1;
}
finally {
    await live?.close();
    await snapshot?.close();
    if (directory)
        rmSync(directory, { recursive: true, force: true });
}
