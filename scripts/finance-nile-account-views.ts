import { loadNileDepositPool } from '../server/finance/nile-deposit-pool';
import { mkdtemp, rm, writeFile, rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NileTestLedger, validateNileTestConfig } from '../server/finance/nile-test-ledger';
import { buildNileAccountViews, readNileBindings } from '../server/finance/nile-account-views';
import { NILE_WALLET_SCOPE } from '../src/shared/nileWallet';
let directory: string | undefined, ledger: NileTestLedger | undefined;
const target = '/output/wallets.json';
async function boundedJson(file: string) {
    const handle = await open(file, 'r');
    try {
        if (!(await handle.stat()).isFile() || (await handle.stat()).size > 262144)
            throw new Error();
        return JSON.parse(await handle.readFile('utf8'));
    }
    finally {
        await handle.close();
    }
}
async function publish(value: unknown) {
    const temporary = target + '.' + process.pid + '.partial';
    const encoded = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(encoded) > 262144)
        throw new Error();
    try {
        await writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 });
        const handle = await open(temporary, 'r');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await rename(temporary, target);
        const parent = await open('/output', 'r');
        try {
            await parent.sync();
        }
        finally {
            await parent.close();
        }
    }
    finally {
        await rm(temporary, { force: true });
    }
}
try {
    if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile')
        throw new Error();
    const config = validateNileTestConfig(await boundedJson('/config/nile-test.json'));
    ledger = new NileTestLedger(process.env.NILE_TEST_SCHEMA ?? 'royal_nile_deposits', config, true, loadNileDepositPool());
    const source = ledger;
    const view = await source.db.transaction(async () => buildNileAccountViews(source, await readNileBindings(source), await boundedJson('/operations/nile_reconciliation.json')), { readOnly: true });
    await publish(view);
    console.log(JSON.stringify({ ok: true, ...NILE_WALLET_SCOPE, accounts: view.wallets.length, ledgerHeight: view.ledgerHeight }));
}
catch {
    await publish({ version: 1, ...NILE_WALLET_SCOPE, ready: false, generatedAt: Date.now(), wallets: [] }).catch(() => { });
    console.error(JSON.stringify({ ok: false, code: 'nile_account_view_failed' }));
    process.exitCode = 1;
}
finally {
    await ledger?.close();
    if (directory)
        await rm(directory, { recursive: true, force: true });
}
