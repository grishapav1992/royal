import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const credentials = process.env.ROYAL_SANDBOX_CREDENTIAL_FILE;
const report = process.env.ROYAL_SANDBOX_CALLBACK_REPORT;
if (!credentials || !report) throw Error('Specify the private Sandbox credential file and callback report path.');
const content = await readFile(resolve(credentials), 'utf8');
const secret = content.match(/^NOWPAYMENTS_SANDBOX_IPN_SECRET=(.+)$/m)?.[1]?.trim();
if (!secret || secret.length < 16) throw Error('Sandbox IPN Secret is missing.');
const path = '/api/nowpayments-sandbox/ipn', events = [];
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== path) { res.writeHead(404); res.end(); return; }
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) { res.writeHead(413); res.end(); return; }
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid payload');
    const signature = req.headers['x-nowpayments-sig'];
    const expected = createHmac('sha512', secret).update(JSON.stringify(sorted(value))).digest();
    const valid = typeof signature === 'string' && /^[a-f0-9]{128}$/i.test(signature)
      && timingSafeEqual(expected, Buffer.from(signature, 'hex'));
    const orderId = typeof value.order_id === 'string' ? value.order_id.slice(0, 160) : '';
    const event = { at: new Date().toISOString(), signatureValid: valid,
      signatureHeaderValid: typeof signature === 'string' && /^[a-f0-9]{128}$/i.test(signature),
      hasNestedValues: Object.values(value).some(item => item !== null && typeof item === 'object'),
      source: valid && orderId.startsWith('royal-local-selfcheck-') ? 'local-self-check' : 'provider-callback',
      ...(valid ? { paymentId: String(value.payment_id ?? '').slice(0, 40),
        paymentStatus: typeof value.payment_status === 'string' ? value.payment_status.slice(0, 40) : '', orderId } : {}) };
    if (events.length >= 200) events.shift();
    events.push(event);
    await writeFile(resolve(report), JSON.stringify({ mode: 'dedicated-local-sandbox-callback', events }, null, 2) + '\n');
    console.log(JSON.stringify(event));
    if (valid && process.env.ROYAL_SANDBOX_FORWARD_LOCAL === 'true') {
      const forwarded = await fetch('http://127.0.0.1:2583/api/nowpayments-sandbox/ipn', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': signature },
        body: JSON.stringify(value), redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!forwarded.ok) { res.writeHead(503); res.end(); return; }
    }
    res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: valid }));
  } catch { res.writeHead(400); res.end(); }
});
server.listen(2582, '127.0.0.1', () => console.log(JSON.stringify({ listening: true, port: 2582, callbackPath: path })));
server.requestTimeout = 10000; server.headersTimeout = 5000;
let stopping = false;
function stop() { if (!stopping) { stopping = true; server.close(() => process.exit(0)); } }
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => { if (String(value).trim() === 'stop') stop(); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setTimeout(stop, 20 * 60 * 1000).unref();
