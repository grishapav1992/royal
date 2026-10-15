import express, {type Application} from 'express';
import { request } from 'node:http';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { NILE_PLAY_SCOPE, validNileRoundRequest, validNilePlayWallet, validNileRound } from '../src/shared/nilePlay';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { HttpRateLimits } from './requestRateLimit';

const messages: Record<string,string> = {
  play_deposit_pool_exhausted:'Свободные адреса временно закончились. Попробуй позже.',play_deposit_unavailable:'Пополнение тестового USDT временно недоступно.',
  invalid_play_invite:'Код подключения недействителен, уже использован или истёк.',play_binding_conflict:'Этот кошелёк уже подключён к другому аккаунту.',
  play_wallet_unassigned:'Нажми «Пополнить USDT», чтобы получить свой адрес.',play_insufficient_balance:'Для этой ставки не хватает тестовых USDT.',
  play_reserve_insufficient:'Резерва для этой ставки недостаточно. Выбери меньшую ставку или попробуй позже.',
  play_idempotency_conflict:'Номер операции уже использован с другой ставкой.',play_rate_limit:'Слишком много запросов. Подожди минуту.',
  invalid_play_request:'Некорректный запрос ставки.',play_source_not_ready:'Подтверждение тестового баланса временно недоступно. Повтори проверку позже.',
};
export function playCommand(socketPath:string,accountId:string,action:string,value:unknown):Promise<{status:number;value:any}> {
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({accountId,action,value});
    const req=request({socketPath,path:'/command',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>131072)req.destroy(new Error('oversized_play_response'));else chunks.push(chunk);});
      res.on('end',()=>{try {resolve({status:res.statusCode??503,value:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(e){reject(e);}});
      res.on('error',reject);
    });
    req.setTimeout(10000,()=>req.destroy(new Error('play_timeout')));req.on('error',reject);req.end(body);
  });
}
export function installNilePlay(app:Application,socket=process.env.NILE_PLAY_SOCKET_FILE,limits=new HttpRateLimits()) {
  app.use('/api/nile-play',async (req,res,next)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Cookie');
    if (!allowedOrigin(req.get('origin'))||req.get('sec-fetch-site')==='cross-site') {res.status(403).json({error:'Этот источник запросов не разрешён.'});return;}
    const account=(await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if(!account){res.status(401).json({error:'Войди в аккаунт, чтобы использовать тестовый USDT.'});return;}
    // Check the visible account before forwarding any command to the financial service.
    if(req.get(WALLET_ACCOUNT_HEADER)!==account.id){res.status(401).json({error:'Аккаунт изменился. Войди в прежний аккаунт, чтобы проверить операцию.'});return;}
    if(Object.keys(req.query).length){res.status(400).json({error:'Параметры запроса не поддерживаются.'});return;}
    res.locals.accountId=account.id;next();
  },limits.account(),express.json({limit:'2kb',inflate:false}));
  app.use('/api/nile-play',((error,_req,res,next)=>{
    if(error?.status>=400&&error.status<500)res.status(error.status).json({error:'Некорректный запрос тестового USDT.'});
    else next(error);
  }) as express.ErrorRequestHandler);
  async function forward(accountId:string,action:string,value:unknown,res:express.Response) {
    if(!socket){if(action==='wallet')res.json({...NILE_PLAY_SCOPE,state:'disabled'});else res.status(503).json({error:'Игра на тестовом USDT пока не подключена.'});return;}
    try {
      const result=await playCommand(socket,accountId,action,value);
      if(result.status!==200){res.status([400,409,429].includes(result.status)?result.status:503).json({error:messages[result.value?.code]??'Не удалось подтвердить тестовую операцию. Повтори запрос.'});return;}
      if(action==='spin' ? !validNilePlayWallet(result.value?.wallet)||!validNileRound(result.value?.round)||typeof result.value.replayed!=='boolean' : !validNilePlayWallet(result.value)) throw new Error('invalid_play_response');
      res.json(result.value);
    } catch {res.status(503).json({error:'Ответ не подтверждён. Повтори проверку той же операции: повторного списания не будет.'});}
  }
  app.get('/api/nile-play/wallet',(req,res)=>{void forward(res.locals.accountId,'wallet',null,res);});
  app.post('/api/nile-play/deposit',(req,res)=>{
    if(!req.body||Object.keys(req.body).length){res.status(400).json({error:'Адрес пополнения выбирает сервис.'});return;}
    void forward(res.locals.accountId,'deposit',null,res);
  });
  app.post('/api/nile-play/rounds',(req,res)=>{
    if(!validNileRoundRequest(req.body)){res.status(400).json({error:messages.invalid_play_request});return;}
    void forward(res.locals.accountId,'spin',req.body,res);
  });
  app.post('/api/nile-play/claim',(req,res)=>{
    if(!req.body||Object.keys(req.body).join(',')!=='code'||typeof req.body.code!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(req.body.code)) {res.status(400).json({error:messages.invalid_play_invite});return;}
    void forward(res.locals.accountId,'claim',req.body.code,res);
  });
  app.use('/api/nile-play',(_req,res)=>res.status(405).json({error:'Операция не поддерживается.'}));
}
