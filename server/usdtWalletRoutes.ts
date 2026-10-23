import express, { type Application } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { playCommand } from './nilePlayRoutes';
import { USDT_SCOPE, validUsdtRequest, validUsdtRound, validUsdtWallet } from '../src/shared/usdtWallet';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { validCasinoAction, validCasinoSession } from '../src/shared/casinoSessions';

const messages: Record<string, string> = {
  invalid_usdt_request: 'Некорректный запрос игры.', usdt_not_ready: 'Подтверждение USDT временно недоступно. Обнови баланс позже.',
  usdt_insufficient_balance: 'На балансе недостаточно USDT.', usdt_reserve_insufficient: 'Недостаточно резерва для выплаты. Выбери меньшую ставку.',
  usdt_idempotency_conflict: 'Этот номер операции уже использован с другой ставкой.', usdt_rate_limit: 'Слишком много ставок. Подожди минуту.',
  usdt_session_active:'Сначала заверши текущую партию этой игры.',usdt_session_missing:'Партия не найдена.',invalid_usdt_action:'Этот ход недоступен или партия уже завершена.',
};
export function installUsdtWallet(app: Application, socket = process.env.USDT_MAINNET_SOCKET_FILE) {
  app.use('/api/usdt-wallet', express.json({ limit: '2kb' }), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account || req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(401).json({ error: 'Войди в свой аккаунт, чтобы использовать USDT.' }); return; }
    if (Object.keys(req.query).length) { res.status(400).json({ error: 'Параметры запроса не поддерживаются.' }); return; }
    res.locals.accountId = account.id; next();
  });
  async function forward(action: string, value: unknown, res: express.Response) {
    if (!socket) { if (action === 'wallet') res.json({ ...USDT_SCOPE, state: 'disabled' }); else if(action==='casino-wallet')res.json({wallet:{...USDT_SCOPE,state:'disabled'},sessions:[]});else res.status(503).json({ error: 'Настоящие USDT пока не подключены.' }); return; }
    try {
      const result = await playCommand(socket, res.locals.accountId, action, value);
      if (result.status !== 200) { res.status([400, 409, 429].includes(result.status) ? result.status : 503).json({ error: messages[result.value?.code] ?? 'Операция не подтверждена. Проверь ее позже.' }); return; }
      if(action==='casino-wallet'||action==='casino-play'){
        if(!validUsdtWallet(result.value?.wallet)||!Array.isArray(result.value?.sessions)||!result.value.sessions.every(validCasinoSession)
          ||(action==='casino-play'&&(!validCasinoSession(result.value.session)||typeof result.value.replayed!=='boolean')))throw new Error();
      }else if (action === 'play' ? !validUsdtWallet(result.value?.wallet) || !validUsdtRound(result.value?.round) || typeof result.value.replayed !== 'boolean' : !validUsdtWallet(result.value)) throw new Error();
      res.json(result.value);
    } catch { res.status(503).json({ error: 'Ответ не получен. Повтори проверку той же операции: повторного списания не будет.' }); }
  }
  app.get('/api/usdt-wallet', (_req, res) => { void forward('wallet', null, res); });
  app.get('/api/usdt-wallet/casino-sessions',(_req,res)=>{void forward('casino-wallet',null,res);});
  app.post('/api/usdt-wallet/casino-sessions',async(req,res)=>{
    if(!validCasinoAction(req.body)){res.status(400).json({error:messages.invalid_usdt_request});return;}
    if(req.body.action==='start')try{await accounts.financeAdmin.assertAllowed(res.locals.accountId);}catch{res.status(403).json({error:'Денежные операции аккаунта приостановлены администратором.'});return;}
    void forward('casino-play',req.body,res);
  });
  app.post('/api/usdt-wallet/deposit', (req, res) => {
    if (!req.body || Object.keys(req.body).length) { res.status(400).json({ error: 'Адрес и сумму пополнения подтверждает сервис.' }); return; }
    void forward('deposit', null, res);
  });
  app.post('/api/usdt-wallet/rounds', (req, res) => {
    if (!validUsdtRequest(req.body)) { res.status(400).json({ error: messages.invalid_usdt_request }); return; }
    void forward('play', req.body, res);
  });
  app.use('/api/usdt-wallet', (_req, res) => res.status(405).json({ error: 'Операция не поддерживается.' }));
}
