/** Local human-versus-algorithm stand. Never imported by the production host. */
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, type Plugin, type ProxyOptions } from 'vite';
import { Client, type Room } from '@colyseus/sdk';
import { temporaryDatabase } from './database-test';
import { templePreviewCookies } from './temple-preview-cookies';
import { VIRTUAL_PVP_SCOPE, type PvpRequest, type PvpSnapshot } from '../src/shared/pvp';
import { TSU_E_FA_CHOICES } from '../src/shared/tsuEFa';

const webPort = Number(process.env.TSU_LOCAL_WEB_PORT || 5194);
const apiPort = Number(process.env.TSU_LOCAL_API_PORT || 2694);
const api = 'http://127.0.0.1:' + apiPort;
const database = await temporaryDatabase();
Object.assign(process.env, database.env, { AUTH_DB_PATH: 'tsu_local_accounts', NILE_PLAY_SOCKET_FILE: '', PUBLIC_ORIGIN: '' });
const { accounts } = await import('../server/accounts');
const botAccount = await accounts.login('tsu-local-bot@example.test', randomUUID());
await accounts.select(botAccount.account.id, 1, 'Алгоритм');
await accounts.wallet.operate(botAccount.account.id, { id: randomUUID(), kind: 'deposit', amount: 10000 });
const backend = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(apiPort) },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let log = '', stopping = false, bot: Room | undefined, snapshot: PvpSnapshot | undefined;
let pending: { request: PvpRequest; at: number } | undefined;
let thinking: { key: string; timer: ReturnType<typeof setTimeout> } | undefined;
const offered = new Set<string>();
backend.stdout!.on('data', bytes => { log = (log + bytes.toString()).slice(-6000); });
backend.stderr!.on('data', bytes => { log = (log + bytes.toString()).slice(-6000); });

function send(request: PvpRequest) {
  if (pending || !bot || stopping) return;
  pending = { request: { ...request, walletScope: VIRTUAL_PVP_SCOPE }, at: Date.now() };
  bot.send('pvp', pending.request);
}

function act() {
  if (!bot || !snapshot || stopping) return;
  if (pending) {
    if (Date.now() - pending.at > 3000) { pending.at = Date.now(); bot.send('pvp', pending.request); }
    return;
  }
  const active = snapshot.active;
  if (active?.gameId === 'tsu-e-fa' && active.status === 'arriving') {
    if (!active.ready.includes(botAccount.account.id)) send({ id: randomUUID(), action: 'ready', challengeId: active.id });
    return;
  }
  if (active?.gameId === 'tsu-e-fa' && active.status === 'playing') {
    const view = snapshot.tsuEFa;
    if (!view || view.phase !== 'playing' || view.locked[view.self]) return;
    const key = active.id + ':' + view.round;
    if (thinking?.key === key) return;
    if (thinking) clearTimeout(thinking.timer);
    // Sample immediately from the bot's public view. Never inspect the human's choice.
    const choice = TSU_E_FA_CHOICES[randomInt(TSU_E_FA_CHOICES.length)];
    thinking = { key, timer: setTimeout(() => {
      thinking = undefined;
      const current = snapshot?.tsuEFa;
      if (snapshot?.active?.id === active.id && snapshot.active.status === 'playing' && current?.round === view.round && !current.locked[current.self]) {
        send({ id: randomUUID(), action: 'move', challengeId: active.id, revision: current.revision,
          move: { kind: 'choose', round: view.round, choice } });
      }
    }, 650) };
    return;
  }
  const incoming = snapshot.challenges.find(c => c.gameId === 'tsu-e-fa' && c.status === 'open' && c.targetId === botAccount.account.id && c.creatorId !== botAccount.account.id);
  if (incoming) { send({ id: randomUUID(), action: 'accept', challengeId: incoming.id }); return; }
  if (snapshot.challenges.some(c => c.status === 'open' && c.creatorId === botAccount.account.id)) return;
  const person = snapshot.people.find(p => p.accountId !== botAccount.account.id && p.available && !offered.has(p.accountId));
  if (person) {
    offered.add(person.accountId);
    send({ id: randomUUID(), action: 'create', gameId: 'tsu-e-fa', targetId: person.accountId,
      mode: 'free', stakeUnits: '0', targetWins: 3 });
  }
}

const cookies = templePreviewCookies('tsu_local');
const proxy = (ws = false): ProxyOptions => ({ target: api, ws,
  ...(ws ? { rewrite: (path: string) => path.replace(/^\/multiplayer/, '') } : {}),
  configure(proxy) {
    const rewrite = (request: { setHeader(name: string, value: string): void }, req: { headers: { cookie?: string } }) => {
      request.setHeader('cookie', cookies.request(req.headers.cookie) ?? '');
    };
    proxy.on('proxyReq', rewrite); proxy.on('proxyReqWs', rewrite);
    proxy.on('proxyRes', response => { response.headers['set-cookie'] = cookies.response(response.headers['set-cookie']); });
  },
});
const fixture: Plugin = { name: 'tsu-e-fa-local-bot', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    if (new URL(req.url ?? '/', api).pathname !== '/__local/tsu-e-fa/start') { next(); return; }
    if (req.method !== 'GET' || !bot) { res.statusCode = 503; res.end('Local stand is starting'); return; }
    try {
      const login = await accounts.login('tsu-player-' + randomUUID() + '@example.test', randomUUID());
      await accounts.select(login.account.id, 0, 'Игрок');
      await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'deposit', amount: 200 });
      res.setHeader('Set-Cookie', `${cookies.scoped}=${login.token}; Path=/; HttpOnly; SameSite=Lax`);
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 302; res.setHeader('Location', '/?room=' + bot.roomId); res.end();
    } catch { res.statusCode = 500; res.end('Could not start local player'); }
  });
} };
const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [fixture],
  server: { host: '127.0.0.1', port: webPort, strictPort: true,
    watch: { ignored: ['**/module-dist/**', '**/module-build/**', '**/artifacts/**'] },
    proxy: { '/api': proxy(), '/game-modules': proxy(), '/multiplayer': proxy(true) },
  },
});
const timer = setInterval(act, 500);
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(timer); if (thinking) clearTimeout(thinking.timer);
  await bot?.leave().catch(() => {});
  await vite.close();
  if (backend.exitCode === null) {
    const exited = new Promise<void>(resolve => backend.once('exit', () => resolve()));
    backend.kill(); await exited;
  }
  await accounts.close(); await database.cleanup();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().then(() => process.exit(0)); });
process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { if (String(value).trim() === 'stop') void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (backend.exitCode !== null) throw Error('Local backend stopped: ' + log);
    ready = await fetch(api + '/healthz').then(r => r.ok).catch(() => false);
    if (ready) break; await delay(200);
  }
  if (!ready) throw Error('Local backend did not become ready: ' + log);
  bot = await new Client(api, { headers: { Cookie: 'royal_session=' + botAccount.token } }).create('lobby', { activityProtocol: 1 });
  bot.onMessage('*', () => {});
  bot.onMessage<PvpSnapshot>('pvp', value => {
    snapshot = value;
    if (value.requestId === pending?.request.id) pending = undefined;
    act();
  });
  bot.onMessage('pvp-result', (value: { requestId: string; error: string; rejected: boolean }) => {
    if (value.requestId === pending?.request.id && value.rejected) { console.error('Local bot:', value.error); pending = undefined; }
  });
  await vite.listen();
  console.log(`Tsu-e-fa local: http://127.0.0.1:${webPort}/__local/tsu-e-fa/start`);
  console.log('Random algorithm, free opening invitation, 200 synthetic USDT. Type stop to remove the temporary database.');
} catch (error) { await stop(); throw error; }
