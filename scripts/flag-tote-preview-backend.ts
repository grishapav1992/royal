/** Local acceptance stand only. Never load project .env or expose control routes on production. */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const { accounts, cookieToken } = await import('../server/accounts');
let anchor = Math.floor(Date.now() / 300000) * 300000 + 1000, wall = Date.now();
Reflect.set(accounts.wallet.tote, 'now', () => anchor + Date.now() - wall);
// Fixed local replay keeps the same unbacked winner across desktop/mobile scenarios.
Reflect.set(accounts.wallet.tote, 'draw', (max: number) => max - 1);
const control = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const identity = await accounts.session(cookieToken(req.headers.cookie));
    if (!identity?.account) { res.statusCode = 401; res.end('{}'); return; }
    if (req.method !== 'POST') throw Error('POST required');
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path.endsWith('/topup')) { res.end(JSON.stringify(await accounts.wallet.operate(identity.account.id, { id: randomUUID(), kind: 'deposit', amount: 1000 }))); return; }
    if (path.endsWith('/clock')) {
      let body = ''; for await (const bytes of req) { body += bytes; if (body.length > 1024) throw Error('Oversized local control'); }
      const phase = JSON.parse(body).phase;
      const { round } = await accounts.wallet.tote.snapshot(identity.account.id);
      anchor = phase === 'close' ? round.closesAt + 10 : phase === 'finish' ? round.finishesAt + 10 : phase === 'next' ? round.openedAt + 300000 + 1000 : NaN;
      if (!Number.isSafeInteger(anchor)) throw Error('Invalid clock step'); wall = Date.now();
      await accounts.wallet.tote.advance(); res.end(JSON.stringify({ ok: true })); return;
    }
    res.statusCode = 404; res.end('{}');
  } catch { res.statusCode = 500; res.end('{}'); }
});
control.listen(2638, '127.0.0.1');
process.once('SIGTERM', () => control.close());
await import('../server/index');
