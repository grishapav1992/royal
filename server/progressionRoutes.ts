import express, { type Application, type ErrorRequestHandler } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { WalletError } from './demoWallet';
import { NilePlayError } from './finance/nile-play-error';
import { CryptoError } from './crypto/config';
import { createDemoWalletRequestLimit } from './demoWalletRequestLimit';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { validProgressionSnapshot, validRewardSpinRequest, validRewardSpinResult } from '../src/shared/progression';

const errors: Record<string, string> = {
  invalid_reward_spin_request: 'Некорректный запрос бесплатного спина.',
  progression_grant_not_found: 'Пакет бесплатных спинов не найден.',
  progression_grant_exhausted: 'В пакете не осталось бесплатных спинов.',
  reward_grant_not_found: 'Пакет бесплатных спинов не найден.',
  reward_grant_exhausted: 'В пакете не осталось бесплатных спинов.',
  reward_unavailable: 'Пакет бесплатных спинов не найден.',
  reward_spins_exhausted: 'В пакете не осталось бесплатных спинов.',
  reward_spins_paused: 'Бесплатные спины временно приостановлены. Пакет сохранён.',
  reward_rules_unavailable: 'Правила этого пакета временно недоступны. Пакет сохранён.',
  reward_game_unavailable: 'Эта игра не поддерживается пакетом. Выбери Royal Coins или Royal Fruits.',
  reward_spin_rate_limit: 'Слишком много бесплатных спинов. Подожди минуту и проверь ту же операцию.',
  reward_wallet_capacity: 'Для выплаты нужно освободить место в кошельке. Пакет сохранён.',
  play_rate_limit: 'Слишком много запросов. Подожди минуту.',
};

/** Account and location are determined by the authenticated host. */
export function installProgression(app: Application) {
  app.use('/api/progression', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return;
    }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account || req.get(WALLET_ACCOUNT_HEADER) !== account.id) {
      res.status(401).json({ error: 'Войди в аккаунт, чтобы открыть уровни.' }); return;
    }
    if (Object.keys(req.query).length) {
      res.status(400).json({ error: 'Параметры запроса не поддерживаются.' }); return;
    }
    res.locals.accountId = account.id;
    next();
  }, createDemoWalletRequestLimit(), express.json({ limit: '2kb', inflate: false }));
  const bodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      res.status(error.status).json({ error: 'Некорректный запрос бесплатного спина.' });
    } else next(error);
  };
  app.use('/api/progression', bodyError);

  async function forward(account: string, action: 'progression-snapshot' | 'reward-spin', value: unknown, res: express.Response) {
    try {
      const reply = action === 'progression-snapshot'
        ? await accounts.progression.snapshot(account)
        : await accounts.rewardSpins.spin(account, value);
      if (action === 'progression-snapshot' ? !validProgressionSnapshot(reply) : !validRewardSpinResult(reply)) {
        throw new Error('invalid_progression_response');
      }
      res.json(reply);
    } catch (error) {
      if (error instanceof WalletError || error instanceof NilePlayError || error instanceof CryptoError) {
        const code = error instanceof NilePlayError ? error.code : error.message;
        res.status(error.status).json({ error: errors[code] ?? (/[а-я]/i.test(code) ? code
          : 'Бесплатный спин не подтверждён. Проверь ту же операцию: повторного расходования не будет.'),
          rejected: [400, 403, 404, 409].includes(error.status) }); return;
      }
      res.status(503).json({ error: action === 'progression-snapshot'
        ? 'Не удалось подтвердить уровни. Обнови данные.'
        : 'Бесплатный спин не подтверждён. Проверь ту же операцию: повторного расходования не будет.' });
    }
  }
  app.get('/api/progression', (_req, res) => { void forward(res.locals.accountId, 'progression-snapshot', null, res); });
  app.post('/api/progression/spins', async (req, res) => {
    if (!validRewardSpinRequest(req.body)) {
      res.status(400).json({ error: 'Некорректный запрос бесплатного спина.', rejected: true }); return;
    }
    void forward(res.locals.accountId, 'reward-spin', req.body, res);
  });
  app.use('/api/progression', (_req, res) => { res.status(405).json({ error: 'Операция не поддерживается.' }); });
}
