import { mkdtempSync, writeFileSync, rmSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { playTestSetup, playTestConfig } from '../server-tests/finance/helpers/nile-play-fixture';
import { customerPool } from '../server-tests/finance/helpers/nile-pool-fixture';
import { block } from '../server-tests/finance/helpers/nile-play-fixture';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
const dir = mkdtempSync(join(tmpdir(), 'royal-nile-play-ui-')), sourceFile = join(dir, 'source.sqlite'), dbFile = join(dir, 'play.sqlite'), configFile = join(dir, 'config.json'), reconFile = join(dir, 'reconciliation.json'), socket = join(dir, 'play.sock');
const fixture = await playTestSetup(dbFile);
const sourceSchema = fixture.source.db.schema;
const code = await fixture.ledger.invite('player');
await fixture.close();
const source = new NileTestLedger(sourceSchema, playTestConfig.source, false, customerPool);
const poolFile = join(dir, 'pool.json');
writeFileSync(poolFile, JSON.stringify(customerPool));
writeFileSync(configFile, JSON.stringify(playTestConfig));
const metaFile = '/tmp/royal-nile-play-ui-fixture.json';
writeFileSync(metaFile, JSON.stringify({ pid: process.pid, code, sourceFile }), { mode: 0o600 });
async function refresh() { await source.success(); const audit = await source.audit(); writeFileSync(reconFile, JSON.stringify({ ok: true, checked_at: new Date().toISOString(), network: 'nile', asset: 'USDT_NILE_TEST', testOnly: true, spendable: false, poolSha256: audit.poolSha256 ?? null, credits: audit.credits, liabilitiesUnits: audit.balances.reduce((sum, w) => sum + BigInt(w.availableUnits), 0n).toString(), deficitUnits: '0' })); }
await refresh();
const timer = setInterval(refresh, 1000);
const env = { ...process.env, NILE_DEPOSIT_POOL_FILE: poolFile, NILE_TEST_MODE: 'testnet-only', NILE_TEST_NETWORK: 'nile', NILE_PLAY_CONFIG_FILE: configFile, NILE_PLAY_SCHEMA: dbFile, NILE_PLAY_BACKUP_DIR: join(dir, 'backups'), NILE_PLAY_SOCKET_FILE: socket, NILE_TEST_SCHEMA: sourceSchema, NILE_PLAY_RECONCILIATION_FILE: reconFile };
const finance = spawn(process.execPath, ['--import', 'tsx', 'scripts/finance-nile-play.ts', 'serve'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
const game = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.env.NILE_PLAY_RELEASE_DIR, env: { ...env, PORT: '2589', AUTH_DB_PATH: join(dir, 'accounts.sqlite') }, stdio: ['ignore', 'inherit', 'inherit'] });
let stopping = false;
async function stop() {
    if (stopping)
        return;
    stopping = true;
    clearInterval(timer);
    finance.kill('SIGTERM');
    game.kill('SIGTERM');
    await Promise.all([finance, game].map(child => new Promise<void>(resolve => {
        if (child.exitCode !== null)
            resolve();
        else
            child.once('exit', () => resolve());
    }))).then(async () => {
        await source.close();
        try {
            if (JSON.parse(readFileSync(metaFile, 'utf8')).pid === process.pid)
                unlinkSync(metaFile);
        }
        catch { }
        rmSync(dir, { recursive: true, force: true });
        process.exit(0);
    });
}
for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, stop);
finance.once('exit', async () => {
    if (!stopping)
        await stop();
});
game.once('exit', async () => {
    if (!stopping)
        await stop();
});
