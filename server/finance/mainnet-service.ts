import { createServer } from 'node:http';
import { UsdtError, usdtFail } from './mainnet-config';
import type { MainnetLedger } from './mainnet-ledger';
import { gameAccountId } from '../../src/shared/nileWallet';
export function createMainnetServer(ledger: MainnetLedger) {
    const server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try {
            if (req.method !== 'POST' || req.url !== '/command')
                usdtFail('invalid_usdt_endpoint', 405);
            let size = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 2048)
                    usdtFail('invalid_usdt_request', 413);
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!body || Object.keys(body).sort().join(',') !== 'accountId,action,value' || !gameAccountId(body.accountId))
                usdtFail('invalid_usdt_request', 400);
            let value: unknown;
            if ((body.action === 'wallet' || body.action === 'deposit') && body.value === null)
                value = await ledger.wallet(body.accountId);
            else if (body.action === 'play')
                value = await ledger.play(body.accountId, body.value);
            else if(body.action==='casino-wallet'&&body.value===null)value=await ledger.casinoWallet(body.accountId);
            else if(body.action==='casino-play')value=await ledger.casinoPlay(body.accountId,body.value);
            else
                usdtFail('invalid_usdt_request', 400);
            res.writeHead(200);
            res.end(JSON.stringify(value));
        }
        catch (e) {
            res.writeHead(e instanceof UsdtError ? e.status : 503);
            res.end(JSON.stringify({ code: e instanceof UsdtError ? e.code : 'usdt_unavailable' }));
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    return server;
}
