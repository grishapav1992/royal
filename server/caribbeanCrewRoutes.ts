import express,{type Application,type RequestHandler} from 'express';
import {accounts,allowedOrigin,cookieToken} from './accounts';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
import {CrewCollectionError,type CaribbeanCrewStore} from './caribbeanCrew';
export function installCaribbeanCrew(app:Application,store:CaribbeanCrewStore=accounts.caribbeanCrew,session:(token:string|undefined)=>Promise<{account:{id:string;skin:number|null}}|null|undefined>=token=>accounts.session(token)){
 app.use('/api/caribbean-crew',async(req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
  if(!allowedOrigin(req.get('origin'))||req.get('sec-fetch-site')==='cross-site'){res.status(403).json({error:'origin-forbidden'});return;}
  try{const account=(await session(cookieToken(req.headers.cookie)))?.account;
   if(!account||account.skin===null){res.status(401).json({error:'sign-in-required'});return;}
   if(req.get(WALLET_ACCOUNT_HEADER)!==account.id){res.status(409).json({error:'account-changed'});return;}
   res.locals.accountId=account.id;next();
  }catch{res.status(503).json({error:'collection-unavailable'});}
 },express.json({limit:'2kb',inflate:false}));
 const handle=(action:(account:string,body:unknown)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
  try{res.json(await action(res.locals.accountId,req.body));}catch(error){res.status(error instanceof CrewCollectionError?error.status:503).json({error:error instanceof CrewCollectionError?error.code:'collection-unavailable'});}
 };
 app.get('/api/caribbean-crew',handle(account=>store.snapshot(account)));
 app.post('/api/caribbean-crew',handle((account,body)=>store.operate(account,body)));
}
