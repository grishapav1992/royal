import { NEOPOLIS_HEADER } from '../src/shared/neopolis';
import {DRACONA_CLIENT_HEADER} from '../src/shared/dracona';
import {PENALTY_CLIENT_HEADER} from '../src/shared/crLeo';
import {AFTER_PROGRESS_HEADER,AFTER_PROGRESS_VERSION} from '../src/shared/afterglowWardrobe';
import {MEME_CLIENT_HEADER} from '../src/shared/memeOverload';
import {AFTER_CLIENT_HEADER} from '../src/shared/afterglow';
import {VELVET_CLIENT_HEADER} from '../src/shared/velvetReign';
import {NITRO_CLIENT_HEADER} from '../src/shared/nitroRun';
import {CONVOY_CLIENT_HEADER} from '../src/shared/lastConvoy';
import {CARAMEL_CLIENT_HEADER} from '../src/shared/caramelCarnival';
import express, { type Application, type ErrorRequestHandler, type RequestHandler } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { WalletError } from './demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { createDemoWalletRequestLimit, type DemoWalletRequestLimitOptions } from './demoWalletRequestLimit';

export function installDemoWallet(app: Application, requestLimitOptions?: DemoWalletRequestLimitOptions) {
  const bodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Запрос к кошельку слишком большой.' });
    } else if (error?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Некорректный JSON запроса к кошельку.' });
    } else if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      res.status(error.status).json({ error: 'Неподдерживаемый формат запроса к кошельку.' });
    } else next(error);
  };
  const authorize: RequestHandler = async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account) { res.status(401).json({ error: 'Войди в аккаунт, чтобы использовать демобаланс.' }); return; }
    // The header binds the request to the visible account; the cookie remains the authority.
    if (req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(401).json({ error: 'Аккаунт изменился. Войди в прежний аккаунт, чтобы проверить операцию.' }); return; }
    res.locals.accountId = account.id; next();
  };
  app.use('/api/demo-wallet', authorize, createDemoWalletRequestLimit(requestLimitOptions), express.json({ limit: '2kb', inflate: false }), bodyError);
  app.get('/api/demo-wallet', async (_req, res) => res.json(await accounts.wallet.snapshot(res.locals.accountId)));
  app.get('/api/demo-wallet/expansion',async (req,res,next)=>{try{res.json(await accounts.wallet.expansion.active(res.locals.accountId,req.get(CARAMEL_CLIENT_HEADER)==='1',req.get(VELVET_CLIENT_HEADER)==='1',req.get(CONVOY_CLIENT_HEADER)==='1',req.get(NITRO_CLIENT_HEADER)==='1',req.get(AFTER_CLIENT_HEADER)==='1',req.get(MEME_CLIENT_HEADER)==='1',req.get(PENALTY_CLIENT_HEADER)==='1',req.get(DRACONA_CLIENT_HEADER)==='1',req.get(NEOPOLIS_HEADER)==='1'));}catch(error){next(error);}});
  app.get('/api/demo-wallet/expansion/presentation',async (req,res)=>{
    try{
      const {sessionId,phase,step}=req.query;
      if(Object.keys(req.query).sort().join()!=='phase,sessionId,step'||typeof phase!=='string'||!/^[1-3]$/.test(phase)||typeof step!=='string'||!/^[0-2]$/.test(step))throw new WalletError(400,'Некорректный запрос показа игры.');
      res.json(await accounts.wallet.expansion.presentation(res.locals.accountId,sessionId,Number(phase),Number(step)));
    }catch(error){if(error instanceof WalletError)res.status(error.status).json({error:error.message});else{console.error('Demo studio presentation read failed');res.status(500).json({error:'Не удалось загрузить показ. Используй сохранённый результат.'});}}
  });
  app.post('/api/demo-wallet/expansion',async (req,res)=>{
    try{res.json(await accounts.wallet.expansion.operate(res.locals.accountId,req.body,req.get('X-Royal-Card-Rules')==='2'?2:1,req.get(CARAMEL_CLIENT_HEADER)==='1',req.get(VELVET_CLIENT_HEADER)==='1',req.get(CONVOY_CLIENT_HEADER)==='1',req.get(NITRO_CLIENT_HEADER)==='1',req.get(AFTER_CLIENT_HEADER)==='1',req.get(AFTER_PROGRESS_HEADER)===AFTER_PROGRESS_VERSION,req.get(MEME_CLIENT_HEADER)==='1',req.get(PENALTY_CLIENT_HEADER)==='1',req.get(DRACONA_CLIENT_HEADER)==='1',req.get(NEOPOLIS_HEADER)==='1'));}
    catch(error){if(error instanceof WalletError)res.status(error.status).json({error:error.message});else{console.error('Demo expansion operation failed');res.status(500).json({error:'Ответ не подтверждён. Повтори тот же ход.'});}}
  });
  app.get('/api/demo-wallet/convoy-progress',async (req,res)=>{
    if(Object.keys(req.query).length){res.status(400).json({error:'Параметры прогресса не поддерживаются.'});return;}
    try{res.json(await accounts.wallet.expansion.convoyProgress(res.locals.accountId));}
    catch{res.status(500).json({error:'Не удалось проверить прогресс конвоя.'});}
  });
  app.get('/api/demo-wallet/afterglow-wardrobe',async (req,res)=>{
    if(req.get(AFTER_PROGRESS_HEADER)!==AFTER_PROGRESS_VERSION){res.status(409).json({error:'Обнови страницу для нового прогресса GIRLHUB.'});return;}
    try{res.json(await accounts.wallet.expansion.wardrobe.snapshot(res.locals.accountId));}
    catch{res.status(500).json({error:'Не удалось загрузить альбом. Обнови данные игры.'});}
  });
  app.post('/api/demo-wallet/afterglow-wardrobe',async (req,res)=>{
    if(req.get(AFTER_PROGRESS_HEADER)!==AFTER_PROGRESS_VERSION){res.status(409).json({error:'Обнови страницу для нового прогресса GIRLHUB.'});return;}
    try{res.json(await accounts.wallet.expansion.wardrobe.choose(res.locals.accountId,req.body));}
    catch(error){if(error instanceof WalletError)res.status(error.status).json({error:error.message});else res.status(500).json({error:'Не удалось сохранить образ. Обнови альбом.'});}
  });
  app.get('/api/demo-wallet/mines', async (_req, res) => res.json(await accounts.wallet.mines.active(res.locals.accountId)));
  app.get('/api/demo-wallet/casino-sessions', async (_req,res,next)=>{try{res.json(await accounts.wallet.casino.active(res.locals.accountId));}catch(error){next(error);}});
  app.post('/api/demo-wallet/casino-sessions', async (req,res)=>{
    try{res.json(await accounts.wallet.casino.operate(res.locals.accountId,req.body));}
    catch(error){if(error instanceof WalletError)res.status(error.status).json({error:error.message});else res.status(500).json({error:'Ответ не подтверждён. Повтори то же действие.'});}
  });
  app.get('/api/demo-wallet/flight', async (_req, res) => {
    try { res.json(await accounts.wallet.flight.snapshot(res.locals.accountId)); }
    catch { console.error('Demo flight snapshot failed'); res.status(500).json({ error: 'Не удалось проверить полёт. Повтори запрос.' }); }
  });
  app.post('/api/demo-wallet/flight', async (req, res) => {
    try { res.json(await accounts.wallet.flight.operate(res.locals.accountId, req.body)); }
    catch (error) {
      if (error instanceof WalletError) res.status(error.status).json({ error: error.message });
      else { console.error('Demo flight operation failed'); res.status(500).json({ error: 'Не удалось подтвердить полёт. Повтори тот же запрос.' }); }
    }
  });
  app.post('/api/demo-wallet/mines', async (req, res) => {
    try { res.json(await accounts.wallet.mines.operate(res.locals.accountId, req.body)); }
    catch (error) {
      if (error instanceof WalletError) res.status(error.status).json({ error: error.message });
      else { console.error('Demo Mines operation failed'); res.status(500).json({ error: 'Не удалось подтвердить действие Mines. Повтори тот же запрос.' }); }
    }
  });
  app.post('/api/demo-wallet/operations', async (req, res) => {
    try { res.json(await accounts.wallet.operate(res.locals.accountId, req.body)); }
    catch (error) {
      if (error instanceof WalletError) res.status(error.status).json({ error: error.message });
      else { console.error('Demo wallet operation failed'); res.status(500).json({ error: 'Не удалось подтвердить операцию. Повтори запрос.' }); }
    }
  });
}
