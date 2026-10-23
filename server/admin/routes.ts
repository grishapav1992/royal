import express,{type Application,type RequestHandler} from 'express';
import { resolve } from 'node:path';
import { accounts,allowedOrigin,cookieToken,AuthError,type AccountStore } from '../accounts';
import { CryptoError } from '../crypto/config';
import { playCommand } from '../nilePlayRoutes';
import { adminIds,financeFilters,requireFinanceAdmin,adjustmentRequest } from './validation';
import type { FinanceReport,FinanceSource } from '../../src/shared/financeAdmin';
import { gameAccountId } from '../../src/shared/nileWallet';

const source=(value:unknown):FinanceSource=>{
  if(!['payments','nile','mainnet'].includes(value as string))throw new CryptoError(400,'Выбери денежный контур.');return value as FinanceSource;
};
export function installFinanceAdmin(app:Application,store:AccountStore=accounts,env:NodeJS.ProcessEnv=process.env){
  const ids=adminIds(env),attempts=new Map<string,{at:number;count:number}>();let verifying=0;
  const error=(err:unknown,res:express.Response)=>res.status(err instanceof CryptoError||err instanceof AuthError?err.status:503)
    .json({error:err instanceof CryptoError||err instanceof AuthError?err.message:'Финансовый сервис временно недоступен. Повтори то же действие позже.'});
  const handle=(fn:(req:express.Request,res:express.Response)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
    try{res.json(await fn(req,res));}catch(err){error(err,res);}
  };
  app.get(['/admin','/admin/'],(_req,res)=>{res.setHeader('Cache-Control','no-store');res.sendFile(resolve('dist/admin.html'));});
  app.use('/api/admin',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Cookie');res.setHeader('X-Content-Type-Options','nosniff');
    if(!allowedOrigin(req.get('origin'))||req.get('sec-fetch-site')==='cross-site'){res.status(403).json({error:'Источник запроса не разрешён.'});return;}
    try{
      const session=await store.session(cookieToken(req.headers.cookie));
      if(!session){res.status(401).json({error:'Войди в аккаунт владельца.'});return;}
      requireFinanceAdmin(session.account.id,ids);
      if(req.method!=='GET'&&(!req.get('origin')||req.get('x-royal-admin-account')!==session.account.id))throw new CryptoError(403,'Обнови финансовый кабинет и повтори действие.');
      res.locals.account=session.account;next();
    }catch(err){error(err,res);}
  },express.json({limit:'8kb',inflate:false}));
  const call=async(which:FinanceSource,action:'report'|'adjust'|'refresh',actorId:string,value:unknown)=>{
    if(which==='payments')return store.cryptoWallet.admin(action,actorId,value);
    const socket=which==='nile'?env.NILE_PLAY_SOCKET_FILE:env.USDT_MAINNET_SOCKET_FILE;
    if(!socket)throw new CryptoError(503,'Этот денежный контур не подключён.');
    if(action==='refresh')throw new CryptoError(400,'Проверка платежа доступна для NOWPayments.');
    const result=await playCommand(socket,actorId,'finance-'+action,value,1048576);
    if(result.status!==200)throw new CryptoError([400,403,404,409,429].includes(result.status)?result.status:503,
      typeof result.value?.error==='string'?result.value.error:'Контур не подтвердил действие. Проверь сверку и доступный баланс.');
    return result.value;
  };
  app.get('/api/admin/session',handle(async(_req,res)=>({account:res.locals.account,sources:{payments:!!store.cryptoWallet.config.url,nile:!!env.NILE_PLAY_SOCKET_FILE,mainnet:!!env.USDT_MAINNET_SOCKET_FILE},
    coverage:{house:'Денежные журналы NOWPayments, USDT Nile и прямого USDT.',pvp:'Шахматы, бильярд и хоккей сейчас не проводят денежные ставки. Платных PvP-партий в этих играх нет.'}})));
  app.post('/api/admin/report',handle(async(req,res)=>{
    if(!req.body||Object.keys(req.body).some(k=>!['source','filters','playerQuery'].includes(k)))throw new CryptoError(400,'Некорректный отчёт.');
    const filters=financeFilters(req.body.filters??{});
    if(req.body.playerQuery){
      if(typeof req.body.playerQuery!=='string')throw new CryptoError(400,'Некорректный поиск.');
      const rows=await store.financeAdmin.search(req.body.playerQuery);
      if(rows.length>100)throw new CryptoError(400,'Найдено больше 100 игроков. Уточни имя, почту или ID.');
      const found=rows.map(r=>String(r.id));filters.playerIds=filters.playerIds?filters.playerIds.filter(id=>found.includes(id)):found;
    }
    return store.financeAdmin.enrich(await call(source(req.body.source),'report',res.locals.account.id,filters) as FinanceReport);
  }));
  app.post('/api/admin/search',handle(async req=>{
    if(!req.body||Object.keys(req.body).join(',')!=='query'||typeof req.body.query!=='string')throw new CryptoError(400,'Некорректный поиск.');
    const rows=await store.financeAdmin.search(req.body.query);return{rows:rows.slice(0,25),more:rows.length>25};
  }));
  app.get('/api/admin/players/:id',handle(req=>store.financeAdmin.player(String(req.params.id))));
  app.post('/api/admin/actions',handle(async(req,res)=>{
    const v=req.body;
    if(!v||Object.keys(v).some(k=>!['id','source','action','playerId','deltaUnits','operationId','reason','password'].includes(k))||![v.id,v.playerId].every(gameAccountId)
      ||!['adjust','block','unblock','refresh'].includes(v.action)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>500||/[\x00-\x1f\x7f]/.test(v.reason))
      throw new CryptoError(400,'Выбери действие, игрока и укажи причину от 5 до 500 символов.');
    const actorId=res.locals.account.id,now=Date.now();
    for(const[key,row]of attempts)if(now-row.at>60000)attempts.delete(key);
    const attempt=attempts.get(actorId)??{at:now,count:0};attempts.set(actorId,attempt);
    if(++attempt.count>10||verifying>=4)throw new CryptoError(429,'Слишком много подтверждений. Подожди минуту.');
    verifying++;try{await store.verifyPassword(actorId,v.password);}finally{verifying--;}
    const which=source(v.source),op={id:v.id,actorId,playerId:v.playerId,source:which,action:String(v.action),reason:v.reason.trim(),
      ...(v.action==='adjust'?{deltaUnits:adjustmentRequest({id:v.id,actorId,playerId:v.playerId,deltaUnits:v.deltaUnits,reason:v.reason.trim()}).deltaUnits}:{}),
      ...(v.action==='refresh'?{operationId:v.operationId}:{})};
    if(v.action==='refresh'&&!gameAccountId(v.operationId))throw new CryptoError(400,'Некорректный номер платежа.');
    return store.financeAdmin.command(op,()=>call(which,v.action,actorId,v.action==='adjust'?{id:op.id,actorId,playerId:op.playerId,deltaUnits:op.deltaUnits,reason:op.reason}:
      {playerId:op.playerId,operationId:op.operationId}));
  }));
  app.post('/api/admin/audit',handle(req=>{
    if(!req.body||Object.keys(req.body).some(k=>!['playerId','from','to','page'].includes(k))||req.body.playerId!==undefined&&!gameAccountId(req.body.playerId))throw new CryptoError(400,'Некорректный фильтр истории.');
    const f=financeFilters({from:req.body.from,to:req.body.to,page:req.body.page});return store.financeAdmin.history({playerId:req.body.playerId,from:f.from,to:f.to,page:f.page});
  }));
  app.use('/api/admin',(_req,res)=>res.status(404).json({error:'Метод кабинета не найден.'}));
  app.use('/api/admin',((err,_req,res,_next)=>{
    res.status(err?.type==='entity.too.large'?413:400).json({error:'Некорректный запрос кабинета.'});
  }) as express.ErrorRequestHandler);
  // This stops new requests. Settlements, provider callbacks and recovery of accepted payments continue.
  app.use(['/api/crypto-wallet','/api/nile-play','/api/usdt-wallet'],async(req,res,next)=>{
    if(req.method!=='POST'||!/^\/(deposits|deposit|quotes|withdrawals|rounds|claim)$/.test(req.path.toLowerCase().replace(/\/+$/,''))){next();return;}
    try{const session=await store.session(cookieToken(req.headers.cookie));if(session)await store.financeAdmin.assertAllowed(session.account.id);next();}catch(err){error(err,res);}
  });
}
