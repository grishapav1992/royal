import { createServer } from 'node:http';
import { NilePlayLedger, NilePlayError } from './nile-play-ledger';
import { gameAccountId } from '../../src/shared/nileWallet';
import { requireFinanceAdmin } from '../admin/validation';
import { CryptoError } from '../crypto/config';
export function createNilePlayServer(ledger: NilePlayLedger) {
    const attempts = new Map<string, {
        at: number;
        n: number;
    }>();
    const server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const respond = (status: number, value: unknown) => { res.writeHead(status); res.end(JSON.stringify(value)); };
        try {
            if (req.method !== 'POST' || req.url !== '/command')
                throw new NilePlayError('invalid_play_endpoint', 405);
            let size = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 4096)
                    throw new NilePlayError('invalid_play_request', 413);
                chunks.push(chunk);
            }
            let body: any;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            catch {
                throw new NilePlayError('invalid_play_request', 400);
            }
            if (!body || Object.keys(body).sort().join(',') !== 'accountId,action,value' || !gameAccountId(body.accountId))
                throw new NilePlayError('invalid_play_request', 400);
            if(body.action==='finance-report'||body.action==='finance-adjust'){
                requireFinanceAdmin(body.accountId);
                if(body.action==='finance-report')respond(200,await ledger.adminReport(body.value));
                else{
                    if(body.value?.actorId!==body.accountId)throw new CryptoError(403,'Неверный автор действия.');
                    respond(200,await ledger.adminAdjust(body.value));
                }
            }
            else if (body.action === 'wallet') {
                if (body.value !== null)
                    throw new NilePlayError('invalid_play_request', 400);
                respond(200, await ledger.wallet(body.accountId));
            }
            else if (body.action === 'deposit') {
                if (body.value !== null)
                    throw new NilePlayError('invalid_play_request', 400);
                respond(200, await ledger.provision(body.accountId));
            }
            else if (body.action === 'spin')
                respond(200, await ledger.spin(body.accountId, body.value));
            else if (body.action === 'claim') {
                const now = Date.now();
                for (const [id, row] of attempts)
                    if (now - row.at > 60000)
                        attempts.delete(id);
                const previous = attempts.get(body.accountId), record = previous && now - previous.at < 60000 ? previous : { at: now, n: 0 };
                if (++record.n > 5 || (!attempts.has(body.accountId) && attempts.size >= 10000))
                    throw new NilePlayError('play_rate_limit', 429);
                attempts.set(body.accountId, record);
                respond(200, await ledger.claim(body.accountId, body.value));
            }
            else
                throw new NilePlayError('invalid_play_request', 400);
        }
        catch (e) {
            respond(e instanceof NilePlayError || e instanceof CryptoError ? e.status : 503,
              e instanceof CryptoError ? {error:e.message} : { code: e instanceof NilePlayError ? e.code : 'play_unavailable' });
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    return server;
}
