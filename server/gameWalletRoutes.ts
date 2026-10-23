import express,{type Application} from 'express';
import {accounts,allowedOrigin,cookieToken} from './accounts';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
import {playCommand} from './nilePlayRoutes';
import {createDemoWalletRequestLimit} from './demoWalletRequestLimit';
import {CARAMEL_CLIENT_HEADER} from '../src/shared/caramelCarnival';
import {VELVET_CLIENT_HEADER} from '../src/shared/velvetReign';
import {CONVOY_CLIENT_HEADER} from '../src/shared/lastConvoy';
import {NITRO_CLIENT_HEADER} from '../src/shared/nitroRun';
import {AFTER_CLIENT_HEADER} from '../src/shared/afterglow';
import {AFTER_PROGRESS_HEADER,AFTER_PROGRESS_VERSION} from '../src/shared/afterglowWardrobe';
import {MEME_CLIENT_HEADER} from '../src/shared/memeOverload';
import {PENALTY_CLIENT_HEADER} from '../src/shared/crLeo';
import {DRACONA_CLIENT_HEADER} from '../src/shared/dracona';

export function installGameWallet(app:Application,socket=process.env.NILE_PLAY_SOCKET_FILE){
 const seeded=new Set<string>();
 app.use('/api/game-wallet',async(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Cookie');
  if(!allowedOrigin(req.get('origin'))||req.get('sec-fetch-site')==='cross-site'){res.status(403).json({error:'Этот источник запросов не разрешён.'});return;}
  const account=(await accounts.session(cookieToken(req.headers.cookie)))?.account;
  if(!account||req.get(WALLET_ACCOUNT_HEADER)!==account.id){res.status(401).json({error:'Войди в свой аккаунт, чтобы использовать USDT.'});return;}
  res.locals.accountId=account.id;next();
 },createDemoWalletRequestLimit(),express.json({limit:'2kb',inflate:false}));
 app.use('/api/game-wallet',((error,_req,res,next)=>{if(error?.status>=400&&error.status<500)res.status(error.status).json({error:'Некорректный запрос игрового баланса.'});else next(error);})as express.ErrorRequestHandler);
 app.use('/api/game-wallet',async(req,res)=>{
  if(!['GET','POST'].includes(req.method)){res.status(405).json({error:'Действие не поддерживается.'});return;}
  if(!socket){res.status(503).json({error:'Тестовый USDT пока не подключён.'});return;}
  if(req.path==='/afterglow-wardrobe'&&req.get(AFTER_PROGRESS_HEADER)!==AFTER_PROGRESS_VERSION){res.status(409).json({error:'Обнови страницу для нового прогресса GIRLHUB.'});return;}
  const query:Record<string,string>={};
  for(const [key,value]of Object.entries(req.query)){if(typeof value!=='string'){res.status(400).json({error:'Некорректные параметры запроса.'});return;}query[key]=value;}
  const flags=[CARAMEL_CLIENT_HEADER,VELVET_CLIENT_HEADER,CONVOY_CLIENT_HEADER,NITRO_CLIENT_HEADER,AFTER_CLIENT_HEADER].map(header=>req.get(header)==='1');
  flags.push(req.get(AFTER_PROGRESS_HEADER)===AFTER_PROGRESS_VERSION,...[MEME_CLIENT_HEADER,PENALTY_CLIENT_HEADER,DRACONA_CLIENT_HEADER].map(header=>req.get(header)==='1'));
  try{
   const account=res.locals.accountId;
   const op=req.body;
   if(req.method==='POST'&&(op?.action==='start'||op?.kind==='play'||op?.kind==='spin'))await accounts.financeAdmin.assertAllowed(account);
   const legacy=seeded.has(account)?null:{wardrobe:await accounts.wallet.expansion.wardrobe.snapshot(account),convoy:await accounts.wallet.expansion.convoyProgress(account)};
   const result=await playCommand(socket,account,'native-game',{path:req.path,method:req.method,body:req.method==='POST'?req.body:null,query,flags,rules:req.get('X-Royal-Card-Rules')==='2'?2:1,legacy});
   if(result.status!==200){const code=String(result.value?.code??'');res.status([400,404,405,409,429].includes(result.status)?result.status:503).json({error:/[а-я]/i.test(code)?code.replace(/демомонет/g,'USDT').replace(/демобаланса/g,'баланса USDT'):code==='play_wallet_unassigned'?'Нажми «Пополнить USDT», чтобы получить адрес.':code==='play_reserve_insufficient'?'Резерва казино недостаточно для этой ставки.':'Ответ не подтверждён. Повтори то же действие.'});return;}
   if(seeded.size>10000)seeded.clear();seeded.add(account);res.json(result.value);
  }catch(error){if(error instanceof Error&&(error as any).status===403)res.status(403).json({error:error.message});else res.status(503).json({error:'Ответ не получен. Повтори проверку той же операции: повторного списания не будет.'});}
 });
}
