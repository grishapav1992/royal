import { loadNileDepositPool } from '../server/finance/nile-deposit-pool';
import { createNilePlayServer } from '../server/finance/nile-play-service';
import { mkdtemp, readFile, lstat, mkdir, rename, open, unlink, readdir } from 'node:fs/promises';
import { mkdtempSync, readFileSync, rmSync, chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { NilePlayLedger, NilePlayError, playDigest, validateNilePlayConfig } from '../server/finance/nile-play-ledger';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
import { withRestoredDatabase } from './database-archive';
process.umask(0o077);
if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile')
    throw new Error('test_scope_required');
const pool = loadNileDepositPool();
const config = validateNilePlayConfig(JSON.parse(readFileSync(process.env.NILE_PLAY_CONFIG_FILE ?? '/config/play.json', 'utf8')));
const dbFile = process.env.NILE_PLAY_SCHEMA ?? 'royal_nile_play';
const command = process.argv[2] ?? 'serve';
const backupDirectory = process.env.NILE_PLAY_BACKUP_DIR ?? '/data/backups';
async function atomic(file: string, value: unknown) {
    const temporary = file + '.partial', handle = await open(temporary, 'w', 0o600);
    try {
        await handle.writeFile(JSON.stringify(value) + '\n');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await rename(temporary, file);
    const directory = await open(dirname(file), 'r');
    try {
        await directory.sync();
    }
    finally {
        await directory.close();
    }
}
export async function createPlayBackup(ledger: NilePlayLedger, directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const createdAt = new Date().toISOString(), filename = 'nile-play-' + createdAt.replace(/[-:.]/g, '') + '.pg.json';
    const file = join(directory, filename);
    await ledger.db.snapshot(file);
    chmodSync(file, 0o600);
    const digest = playDigest(await readFile(file));
    const audit = await withRestoredDatabase(file, async database => {
        const restored = new NilePlayLedger(database.schema, config, true, undefined, pool, database);
        return restored.audit();
    });
    const metadata = { version: 1, file: filename, sha256: digest, bytes: (await lstat(file)).size, createdAt, configSha256: playDigest(JSON.stringify(config)), poolSha256: audit.poolSha256 ?? null, audit };
    await atomic(file + '.json', metadata);
    await atomic(join(directory, 'latest.json'), metadata);
    const previous = (await readdir(directory)).filter(name => /^nile-play-[0-9TZ]+\.pg\.json$/.test(name)).sort().reverse();
    for (const old of previous.slice(14 * 24 * 12)) {
        await unlink(join(directory, old));
        try {
            await unlink(join(directory, old + '.json'));
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
    }
    return metadata;
}
if (command === 'verify-backup') {
    const file = process.argv[3], expected = process.argv[4];
    if (!file || !/^[a-f0-9]{64}$/.test(expected ?? '') || playDigest(readFileSync(file)) !== expected)
        throw new Error('play_backup_hash_mismatch');
    console.log(JSON.stringify(await withRestoredDatabase(file, async database => {
        const restored = new NilePlayLedger(database.schema, config, true, undefined, pool, database);
        return restored.audit();
    })));
}
else {
    const ledger = new NilePlayLedger(dbFile, config, ['audit', 'status', 'health'].includes(command), undefined, pool);
    if (command === 'audit' || command === 'status' || command === 'health') {
        try {
            const audit = await ledger.audit();
            console.log(JSON.stringify({ ...audit, ready: await ledger.isReady() }));
            if (command === 'health' && !await ledger.isReady())
                process.exitCode = 1;
        }
        finally {
            await ledger.close();
        }
    }
    else if (command === 'invite') {
        try {
            console.log(await ledger.invite(process.argv[3]));
        }
        finally {
            await ledger.close();
        }
    }
    else if (command === 'reserve') {
        try {
            console.log(JSON.stringify(await ledger.allocateReserve(process.argv[3], process.argv[4])));
        }
        finally {
            await ledger.close();
        }
    }
    else if (command === 'backup') {
        try {
            console.log(JSON.stringify(await createPlayBackup(ledger, backupDirectory)));
        }
        finally {
            await ledger.close();
        }
    }
    else if (command === 'serve') {
        const socket = process.env.NILE_PLAY_SOCKET_FILE ?? '/run/nile/play.sock';
        const sourceFile = process.env.NILE_TEST_SCHEMA ?? 'royal_nile_deposits';
        let stopping = false, syncing = false, lastBackup = 0, lastSync = 0;
        async function sync() {
            if (stopping || syncing)
                return;
            syncing = true;
            try {
                const source = new NileTestLedger(sourceFile, config.source, true, pool);
                try {
                    await source.db.transaction(async () => {
                        await ledger.sync(source, JSON.parse(await readFile(process.env.NILE_PLAY_RECONCILIATION_FILE ?? '/operations/nile_reconciliation.json', 'utf8')));
                    }, { readOnly: true });
                }
                finally {
                    await source.close();
                }
                lastSync = Date.now();
            }
            catch (e) {
                const code = e instanceof NilePlayError ? e.code : 'play_sync_failed';
                await ledger.failure(code);
                try {
                    await ledger.audit();
                }
                catch {
                    await ledger.halt('play_journal_corrupted');
                }
            }
            if (process.env.DATABASE_LOCAL_SNAPSHOTS === 'true' && Date.now() - lastBackup > 300000) {
                try {
                    await createPlayBackup(ledger, backupDirectory);
                    lastBackup = Date.now();
                }
                catch {
                    await ledger.failure('play_backup_failed');
                }
            }
            syncing = false;
        }
        await sync();
        if (existsSync(socket)) {
            const info = await lstat(socket);
            if (!info.isSocket())
                throw new Error('unsafe_play_socket');
            await unlink(socket);
        }
        const server = createNilePlayServer(ledger);
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => { chmodSync(socket, 0o600); resolve(); }); });
        const timer = setInterval(async () => { void await sync(); }, 30000);
        for (const signal of ['SIGTERM', 'SIGINT'])
            process.once(signal, () => { stopping = true; clearInterval(timer); server.close(async () => { await ledger.close(); process.exit(0); }); });
        console.log(JSON.stringify({ service: 'nile-play', network: 'nile', testOnly: true, hasSigningKeys: false, lastSync }));
    }
    else {
        await ledger.close();
        throw new Error('invalid_play_command');
    }
}
