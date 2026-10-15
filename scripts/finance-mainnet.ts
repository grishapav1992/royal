import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MainnetLedger } from '../server/finance/mainnet-ledger';
import { MAINNET_ORIGINS, validateMainnetConfig } from '../server/finance/mainnet-config';
import { MainnetRpc } from '../server/finance/mainnet-rpc';
import { scanMainnet } from '../server/finance/mainnet-scanner';
import { createMainnetServer } from '../server/finance/mainnet-service';
import { request } from 'node:http';
import { validUsdtWallet } from '../src/shared/usdtWallet';
if (process.env.USDT_MAINNET_MODE !== 'pilot-mainnet')
    throw new Error('mainnet_scope_required');
const config = validateMainnetConfig(JSON.parse(readFileSync(process.env.USDT_MAINNET_CONFIG_FILE ?? '/config/mainnet.json', 'utf8')));
const database = process.env.USDT_MAINNET_SCHEMA ?? 'royal_mainnet', socket = process.env.USDT_MAINNET_SOCKET_FILE ?? '/run/usdt/mainnet.sock';
if (process.argv[2] === 'health') {
    const ok = await new Promise<boolean>(resolve => {
        const body = JSON.stringify({ accountId: config.accountId, action: 'wallet', value: null });
        const req = request({ socketPath: socket, path: '/command', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > 131072)
                    req.destroy();
                else
                    chunks.push(chunk);
            });
            res.on('end', () => {
                try {
                    const wallet = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    resolve(res.statusCode === 200 && validUsdtWallet(wallet) && wallet.state === 'assigned' && wallet.ready);
                }
                catch {
                    resolve(false);
                }
            });
            res.on('error', () => resolve(false));
        });
        req.setTimeout(4000, () => req.destroy());
        req.on('error', () => resolve(false));
        req.end(body);
    });
    process.exit(ok ? 0 : 1);
}
const ledger = new MainnetLedger(database, config);

if (process.argv[2] === 'audit') {
    const balances = await ledger.audit();
    console.log(JSON.stringify({ ok: true, network: 'tron-mainnet', cursor: await ledger.cursor(), balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])), ready: await ledger.isReady() }));
    await ledger.close();
}
else if (process.argv[2] === 'serve') {
    await ledger.fail('mainnet_starting');
    const backupDirectory = process.env.USDT_MAINNET_BACKUP_DIR ?? '/data/backups';
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    async function backup() {
        if (process.env.DATABASE_LOCAL_SNAPSHOTS !== 'true') return;
        await ledger.audit();
        const file = join(backupDirectory, 'mainnet-' + new Date().toISOString().replace(/[:.]/g, '-') + '.pg.json');
        await ledger.db.snapshot(file);
        chmodSync(file, 0o600);
    }
    await backup();
    const apiKey = process.env.TRONGRID_API_KEY_FILE ? readFileSync(process.env.TRONGRID_API_KEY_FILE, 'utf8').trim() : process.env.TRONGRID_API_KEY;
    const sources = MAINNET_ORIGINS.map(origin => new MainnetRpc(origin, origin === MAINNET_ORIGINS[0] ? apiKey : undefined));
    const server = createMainnetServer(ledger);
    mkdirSync(dirname(socket), { recursive: true, mode: 0o750 });
    if (existsSync(socket))
        unlinkSync(socket);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => { chmodSync(socket, 0o660); resolve(); }); });
    let stopped = false, scanning = false;
    const controller = new AbortController();
    async function scan() {
        if (stopped || scanning)
            return;
        scanning = true;
        try {
            await scanMainnet(ledger, sources, AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]));
        }
        catch {
            if (!stopped)
                console.error(JSON.stringify({ ok: false, code: 'mainnet_scan_unavailable' }));
        }
        finally {
            scanning = false;
        }
    }
    const timer = setInterval(async () => { void await scan(); }, 3000), backups = setInterval(async () => {
        try {
            await backup();
        }
        catch {
            await ledger.fail('mainnet_backup_failed');
        }
    }, 3600000);
    void await scan();
    async function stop() {
        if (stopped)
            return;
        stopped = true;
        clearInterval(timer);
        clearInterval(backups);
        controller.abort();
        await new Promise<void>(resolve => server.close(() => resolve()));
        while (scanning)
            await new Promise(resolve => setTimeout(resolve, 20));
        await backup();
        await ledger.close();
        if (existsSync(socket))
            unlinkSync(socket);
    }
    process.once('SIGTERM', async () => { void await stop(); });
    process.once('SIGINT', async () => { void await stop(); });
}
else {
    await ledger.close();
    throw new Error('mainnet_command_required');
}
