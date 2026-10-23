import {createHash} from 'node:crypto';
import { CommonSkinPayments } from '../skinPayments';
import { SKIN_UUID } from '../../src/shared/skinStudio';
import {DemoWalletStore,WalletError} from '../demoWallet';
import type {PostgresDatabase} from '../database';
import type {NilePlayLedger} from './nile-play-ledger';
import {demoBalanceUnits,demoReservedUnits,MAX_DEMO_UNITS,saveDemoUnits} from '../demoWalletAmounts';
import {prepareGame} from '../games/core';
import {expansionMax} from '../demoExpansion';
import {isExpansionGame} from '../../src/shared/casinoExpansion';
import {sessionReservation,type SessionState} from '../games/casinoSessions';
import {isSessionGame} from '../../src/shared/casinoSessions';
import {minesOdds,exactPayoutUnits} from '../../src/shared/originalGames';
import {FLIGHT_MAX_MULTIPLIER} from '../../src/shared/flightGame';
import {validAfterWardrobe,type AfterWardrobe} from '../../src/shared/afterglowWardrobe';
import {validConvoyProgress,type ConvoyProgress} from '../../src/shared/convoyWardrobe';

export type NativeCommand={path:string;method:'GET'|'POST';body:unknown;flags:boolean[];rules:1|2;query:Record<string,string>;legacy?:{wardrobe:AfterWardrobe;convoy:ConvoyProgress}|null};
const fail=(message:string):never=>{throw new WalletError(409,message);};
/** Existing engines keep a cents projection inside the financial transaction. Only the Nile journal owns money. */
export class NileGameRuntime{
 readonly ready:Promise<void>;
 private store:DemoWalletStore;
 private projection:PostgresDatabase;
 constructor(private ledger:NilePlayLedger,draw?: (max:number)=>number){
  const prerequisite=ledger.ready.then(()=>ledger.db.transaction(async()=>ledger.db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS native_legacy_progress(account_id TEXT PRIMARY KEY REFERENCES accounts(id),convoy_rounds BIGINT NOT NULL CHECK(convoy_rounds>=0),wardrobe_json TEXT NOT NULL,imported_at BIGINT NOT NULL)`)));
  // Every call runs under the one financial journal lock. Engine-local account locks are redundant here.
  const db=new Proxy(ledger.db,{get(target,key){if(key==='transaction')return<T>(action:()=>Promise<T>)=>target.transaction(action);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}})as PostgresDatabase;
  this.projection=db;this.store=new DemoWalletStore(db,draw,undefined,prerequisite);this.ready=Promise.all([this.store.ready,this.store.expansion.ready]).then(()=>{});
 }
 async skinPurchase(account: string, value: unknown) {
  const op = value as { id: string; action: 'reserve'|'capture'|'refund' };
  if (!op || Object.keys(op).sort().join(',') !== 'action,id' || typeof op.id !== 'string' || !SKIN_UUID.test(op.id) || !['reserve','capture','refund'].includes(op.action)) throw new WalletError(400,'Некорректная покупка образа.');
  await this.ready;
  return this.ledger.nativeTransaction(account, async context => {
   const cents = context.available / 10000n;
   if (cents > BigInt(MAX_DEMO_UNITS)) throw new WalletError(409,'Баланс превышает лимит интерфейса.');
   await this.ledger.db.prepare('INSERT INTO accounts(id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
   const beforeReserve = BigInt(await demoReservedUnits(this.ledger.db,account))*10000n;
   if (beforeReserve !== context.reserved) throw Error('Native reservation differs from journal');
   await saveDemoUnits(this.projection,account,Number(cents));
   const previous = await this.ledger.db.prepare('SELECT state FROM skin_purchases WHERE id=?').get(op.id);
   if (op.action === 'reserve' && !previous) {
    if (!context.ready) throw new WalletError(409,'Подтверждение тестового USDT временно недоступно.');
    if (context.available < 10000000n) throw new WalletError(409,'На общем балансе недостаточно USDT. Нужно 10 USDT.');
   }
   const result = await new CommonSkinPayments(this.projection,Promise.resolve()).skinPurchase(account,op.id,op.action);
   const available = context.available+(BigInt(await demoBalanceUnits(this.ledger.db,account))-cents)*10000n;
   const reserve = BigInt(await demoReservedUnits(this.ledger.db,account))*10000n;
   if (available !== context.available || reserve !== context.reserved) await context.post(available,reserve,createHash('sha256').update(JSON.stringify(op)).digest('hex'));
   return result;
  });
 }
 private async replay(account:string,id:unknown){
  if(typeof id!=='string')return false;
  return !!await this.ledger.db.prepare(`SELECT 1 FROM demo_operations WHERE account_id=? AND operation_id=? UNION ALL SELECT 1 FROM demo_mines_requests WHERE account_id=? AND id=?
   UNION ALL SELECT 1 FROM demo_flight_requests WHERE account_id=? AND id=? UNION ALL SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=? LIMIT 1`).get(account,id,account,id,account,id,account,id);
 }
 private coverage(command:NativeCommand):bigint{
  const op=command.body as any;if(command.method!=='POST'||!op)return 0n;
  if(command.path==='/operations'&&(op.kind==='play'||op.kind==='spin')){
   const game=op.kind==='spin'?prepareGame('royal-coins',1,{}):prepareGame(op.gameId,op.rulesVersion,op.input);
   if(!Number.isSafeInteger(op.amount)||op.amount<1)return 0n;return BigInt(op.amount)*100n*BigInt(game.maxMultiplier);
  }
  if(op.action!=='start')return 0n;
  if(command.path==='/expansion'&&isExpansionGame(op.gameId)&&typeof op.stakeUnits==='string'&&/^\d{1,12}$/.test(op.stakeUnits))return BigInt(op.stakeUnits)*BigInt(Math.max(expansionMax(op.gameId,1),expansionMax(op.gameId,2)));
  if(command.path==='/casino-sessions'&&isSessionGame(op.gameId)&&typeof op.stakeUnits==='string'&&/^\d{1,12}$/.test(op.stakeUnits))return sessionReservation({...op,state:'active'}as SessionState);
  if(command.path==='/flight'&&Number.isSafeInteger(op.amount)&&op.amount>0)return BigInt(op.amount)*100n*BigInt(FLIGHT_MAX_MULTIPLIER);
  if(command.path==='/mines'&&Number.isSafeInteger(op.amount)&&op.amount>0&&Number.isInteger(op.mineCount)&&op.mineCount>=1&&op.mineCount<=24)return exactPayoutUnits(BigInt(op.amount)*100n,minesOdds.getMultiplier(op.mineCount,25-op.mineCount));
  return 0n;
 }
 async run(account:string,value:unknown):Promise<unknown>{
  const c=value as NativeCommand;
  if(!c||!['body,flags,method,path,query,rules','body,flags,legacy,method,path,query,rules'].includes(Object.keys(c).sort().join(','))||!['GET','POST'].includes(c.method)
   ||!['/','/operations','/mines','/flight','/casino-sessions','/expansion','/expansion/presentation','/convoy-progress','/afterglow-wardrobe'].includes(c.path)
   ||!Array.isArray(c.flags)||c.flags.length!==9||!c.flags.every(flag=>typeof flag==='boolean')||![1,2].includes(c.rules)||!c.query||typeof c.query!=='object'||Array.isArray(c.query))throw new WalletError(400,'Некорректный запрос игрового баланса.');
  if(c.path!=='/expansion/presentation'&&Object.keys(c.query).length)throw new WalletError(400,'Параметры запроса не поддерживаются.');
  if((c.body as any)?.kind==='deposit')throw new WalletError(400,'Пополняй общий баланс тестовым USDT через кошелёк Nile.');
  if((c.body as any)?.gameId==='studio-neopolis')throw new WalletError(409,'Эта игра пока не опубликована.');
  await this.ready;
  return this.ledger.nativeTransaction(account,async context=>{
   const cents=context.available/10000n;
   if(cents>BigInt(MAX_DEMO_UNITS))return fail('Сумма баланса превышает лимит игрового интерфейса.');
   await this.ledger.db.prepare('INSERT INTO accounts(id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
   if(c.legacy&&!await this.ledger.db.prepare('SELECT 1 FROM native_legacy_progress WHERE account_id=?').get(account)){
    if(!validAfterWardrobe(c.legacy.wardrobe)||!validConvoyProgress(c.legacy.convoy))throw new WalletError(400,'Некорректный прежний прогресс игр.');
    const p=c.legacy.wardrobe;
    await this.ledger.db.prepare('INSERT INTO native_legacy_progress(account_id,convoy_rounds,wardrobe_json,imported_at) VALUES(?,?,?,?)').run(account,c.legacy.convoy.completedRounds,JSON.stringify(p),Date.now());
    await this.ledger.db.prepare('INSERT INTO demo_afterglow_wardrobe(account_id,selected_girl,selected_look,revision) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(account,p.selectedGirl,p.selectedLook,p.revision);
    await this.ledger.db.prepare('INSERT INTO demo_afterglow_stake_album(account_id,points_units) VALUES(?,?) ON CONFLICT DO NOTHING').run(account,p.albumUnits);
    for(let girl=0;girl<4;girl++)await this.ledger.db.prepare('INSERT INTO demo_afterglow_stake_girls(account_id,girl,points_units) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(account,girl,p.pointsUnits[girl]);
   }
   const beforeReserve=BigInt(await demoReservedUnits(this.ledger.db,account))*10000n;
   if(beforeReserve!==context.reserved)throw Error('Native game reserve projection does not match the journal');
   await saveDemoUnits(this.projection,account,Number(cents));
   const op=c.body as any,replay=await this.replay(account,op?.id);
   if(!replay&&c.method==='POST'&&(op?.action==='start'||op?.kind==='play'||op?.kind==='spin')){
    if(!context.ready)return fail('Подтверждение тестового USDT временно недоступно.');
    let coverage:bigint;try{coverage=this.coverage(c)*10000n;}catch{throw new WalletError(400,'Некорректная игра или ставка.');}
    if(context.house<coverage)return fail('В резерве казино недостаточно USDT для максимального выигрыша. Уменьши ставку.');
   }
   let result:any;const flags=c.flags;
   if(c.method==='GET'){
    switch(c.path){
     case '/':result=await this.store.snapshot(account);break;
     case '/mines':result=await this.store.mines.active(account);break;
     case '/flight':result=await this.store.flight.snapshot(account);break;
     case '/casino-sessions':result=await this.store.casino.active(account);break;
     case '/expansion':result=await this.store.expansion.active(account,...flags.slice(0,5),...flags.slice(6));break;
     case '/expansion/presentation':result=await this.store.expansion.presentation(account,c.query.sessionId,Number(c.query.phase),Number(c.query.step));break;
     case '/convoy-progress':result=await this.store.expansion.convoyProgress(account);break;
     case '/afterglow-wardrobe':result=await this.store.expansion.wardrobe.snapshot(account);break;
     default:throw new WalletError(405,'Действие не поддерживается.');
    }
   }else switch(c.path){
    case '/operations':result=await this.store.operate(account,c.body);break;
    case '/mines':result=await this.store.mines.operate(account,c.body);break;
    case '/flight':result=await this.store.flight.operate(account,c.body);break;
    case '/casino-sessions':result=await this.store.casino.operate(account,c.body);break;
    case '/expansion':result=await this.store.expansion.operate(account,c.body,c.rules,...flags);break;
    case '/afterglow-wardrobe':result=await this.store.expansion.wardrobe.choose(account,c.body);break;
    default:throw new WalletError(405,'Действие не поддерживается.');
   }
   const after=BigInt(await demoBalanceUnits(this.ledger.db,account)),reserve=BigInt(await demoReservedUnits(this.ledger.db,account))*10000n;
   const available=context.available+(after-cents)*10000n;
   if(available!==context.available||reserve!==context.reserved)await context.post(available,reserve,createHash('sha256').update(JSON.stringify(c)).digest('hex'));
   if(result&&typeof result==='object'){
    if(c.path==='/convoy-progress'){const legacy=await this.ledger.db.prepare('SELECT convoy_rounds FROM native_legacy_progress WHERE account_id=?').get(account);result.completedRounds+=Number(legacy?.convoy_rounds??0);}
    const wallet='wallet'in result?result.wallet:'balance'in result?result:null;
    if(wallet){const nile=await this.ledger.wallet(account);wallet.asset='USDT_NILE_TEST';wallet.testOnly=true;wallet.scale=2;wallet.balance=Number(available)/1000000;wallet.balanceUnits=String(available);
      if(nile.state==='assigned'){wallet.reservedUnits=nile.reservedUnits;wallet.revision=nile.revision;}}
   }
   return result;
  });
 }
}
