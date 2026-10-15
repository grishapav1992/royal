// Isolated UI fixture: synthetic blocks, test accounts and no external network reader.
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MainnetLedger } from '../server/finance/mainnet-ledger';
import { createMainnetServer } from '../server/finance/mainnet-service';
import { MAINNET_GENESIS, MAINNET_USDT_TOKEN, type MainnetConfig } from '../server/finance/mainnet-config';
import { nileBase58, nileHex, nilePublicKeyAddress } from '../server/finance/nile-address';
const directory = mkdtempSync(join(tmpdir(), 'royal-mainnet-ui-')), dbFile = join(directory, 'ledger.sqlite'), socket = join(directory, 'mainnet.sock');
process.env.AUTH_DB_PATH = join(directory, 'accounts.sqlite');
const { accounts } = await import('../server/accounts');
const email = 'mainnet-ui@example.test', password = 'Mainnet-ui-test-password!';
const { account } = await accounts.login(email, password);
await accounts.close();
const address = (n: number) => { const key = createECDH('secp256k1'); key.setPrivateKey(Buffer.from(n.toString(16).padStart(64, '0'), 'hex')); return nileBase58(nilePublicKeyAddress(key.getPublicKey('hex', 'uncompressed'))); };
const config: MainnetConfig = { version: 1, network: 'tron-mainnet', token: MAINNET_USDT_TOKEN, genesis: MAINNET_GENESIS,
    accountId: account.id, playerAddress: address(51), serviceAddress: address(52), anchorHeight: 100,
    anchorHash: 100..toString(16).padStart(16, '0') + 'a'.repeat(48), openingReserveUnits: process.env.ROYAL_CASINO_UI_FIXTURE === '1' ? '2000000000' : '500000000' };
let cardIndex = 0;
const casinoFixture = process.env.ROYAL_CASINO_UI_FIXTURE === '1';
const ledger = new MainnetLedger(dbFile, config, max => casinoFixture && max === 13 ? [0,6,12][cardIndex++ % 3] : 0);
if (casinoFixture) {
    const txId = 'c'.repeat(64);
    await ledger.ingest({height:101,hash:101..toString(16).padStart(16,'0')+'a'.repeat(48),parentHash:config.anchorHash,timestamp:Date.now(),
      txIds:[txId],outcomes:[{txId,status:'SUCCESS'}],transfers:[{txId,logIndex:0,contract:config.token,from:nileHex(config.playerAddress),to:nileHex(config.serviceAddress),amountUnits:'20000000'}]});
}
async function refresh() { const balances = await ledger.audit(); await ledger.reconcile((await ledger.cursor()).height, (balances.player + balances.house + balances.unallocated).toString()); }
await refresh();
const timer = setInterval(refresh, 250), financial = createMainnetServer(ledger);
await new Promise<void>(resolve => financial.listen(socket, resolve));
chmodSync(socket, 0o600);
const metaFile = '/tmp/royal-mainnet-ui-fixture.json';
writeFileSync(metaFile, JSON.stringify({ pid: process.pid, dbFile, config, email, password }), { mode: 0o600 });
const game = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: '2592', USDT_MAINNET_SOCKET_FILE: socket }, stdio: ['ignore', 'inherit', 'inherit'] });
let stopped = false;
async function stop() {
    if (stopped)
        return;
    stopped = true;
    clearInterval(timer);
    const exit = game.exitCode !== null ? await Promise.resolve() : new Promise<void>(resolve => game.once('exit', () => resolve()));
    game.kill('SIGTERM');
    await new Promise<void>(resolve => financial.close(() => resolve()));
    await exit;
    await ledger.close();
    try {
        if (JSON.parse(readFileSync(metaFile, 'utf8')).pid === process.pid)
            unlinkSync(metaFile);
    }
    catch { }
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, stop);
game.once('exit', async () => {
    if (!stopped)
        await stop();
});
