import type {PostgresDatabase} from '../database';
import type {DemoWalletStore} from '../demoWallet';
import type {VirtualPvpLedger} from '../pvp/virtual-wallet';

export type ProgressionSourceContext = {
 sourceType:'paid-game'|'pvp'; sourceId:string; accountId:string; locationId:string; gameId:string;
 environment:string; fundingSource:'cash'|'reward'; acceptedAt:number;
};
export type ProgressionSourceSettlement = {
 sourceType:'paid-game'|'pvp'; sourceId:string; accountId:string; paidUnits:string; refundedUnits:string;
 settledAt:number; outcome:'settled'|'refunded';
};
export interface ProgressionSourceSink {
 readonly ready:Promise<void>;
 acceptRound(context:ProgressionSourceContext):Promise<unknown>;
 recordSettled(event:ProgressionSourceSettlement):Promise<unknown>;
 pendingRounds(accountId:string,sourceType:'paid-game'|'pvp'):Promise<ProgressionSourceContext[]>;
}
type SourceCommand={path:string;method:'GET'|'POST';body:unknown};
type Family='instant'|'casino'|'mines'|'flight';
const familyForPath:Record<string,Family>={'/operations':'instant','/casino-sessions':'casino','/expansion':'casino','/mines':'mines','/flight':'flight'};
const prefix=(family:Family)=>'native:'+family+':';
const MICRO_PER_CENT=10000n;
const integer=(value:unknown):bigint=>{
 if(typeof value!=='string'&&typeof value!=='number'||!/^\d+$/.test(String(value)))throw Error('Invalid progression source amount');
 return BigInt(value);
};
const timestamp=(value:unknown):number=>{
 const result=Number(value);if(!Number.isSafeInteger(result)||result<1)throw Error('Invalid progression source timestamp');return result;
};

/** Reads accepted engine records and exact debit/refund entries inside the common financial transaction. */
export class NativeProgressionSources {
 readonly ready:Promise<void>;
 constructor(private db:PostgresDatabase,private sink:ProgressionSourceSink,prerequisite:Promise<void>=Promise.resolve(),
  private environment:ProgressionSourceContext['environment']='VIRTUAL_USD'){
  this.ready=Promise.all([sink.ready,prerequisite]).then(()=>db.transaction(()=>db.exec(
   'CREATE INDEX IF NOT EXISTS progression_demo_ledger_operation ON demo_ledger(account_id,operation_id)')));
 }
 private async aggregate(accountId:string,roundId:string,gameId:string,family:Family){
  const ids=family==='casino'
   ? 'SELECT id FROM demo_casino_requests WHERE account_id=? AND session_id=? UNION SELECT ?'
   : 'SELECT ?';
  const args=family==='casino'?[accountId,roundId,roundId]:[roundId];
  const row=await this.db.prepare(`SELECT
   COALESCE(SUM(CASE WHEN entry_type='bet' THEN -amount_units ELSE 0 END),0)::text AS paid,
   COALESCE(SUM(CASE WHEN entry_type='refund' THEN amount_units ELSE 0 END),0)::text AS refunded,
   MIN(CASE WHEN entry_type='bet' THEN created_at END) AS accepted_at,MAX(created_at) AS settled_at
   FROM demo_ledger WHERE account_id=? AND source=? AND operation_id IN (${ids})`).get(accountId,gameId,...args);
  if(!row)throw Error('Missing progression source entries');
  return{paidUnits:String(integer(row.paid)*MICRO_PER_CENT),refundedUnits:String(integer(row.refunded)*MICRO_PER_CENT),
   acceptedAt:timestamp(row.accepted_at),settledAt:timestamp(row.settled_at)};
 }
 private async read(accountId:string,roundId:string,family:Family):Promise<{gameId:string;active:boolean}|null>{
  if(family==='instant'){
   const row=await this.db.prepare('SELECT result,kind FROM demo_operations WHERE account_id=? AND operation_id=?').get(accountId,roundId);
   if(!row||!['play','spin'].includes(row.kind))return null;
   const round=JSON.parse(String(row.result)).gameRound;
   if(!round||typeof round.gameId!=='string')throw Error('Missing accepted progression round metadata');
   return{gameId:round.gameId,active:false};
  }
  const table=family==='casino'?'demo_casino_sessions':family==='mines'?'demo_mines_sessions':'demo_flight_sessions';
  const row=await this.db.prepare(`SELECT * FROM ${table} WHERE account_id=? AND id=?`).get(accountId,roundId);
  if(!row)return null;
  return{gameId:family==='casino'?String(row.game_id):family==='mines'?'royal-mines':'royal-flight',active:row.state==='active'};
 }
 async afterCommand(accountId:string,command:SourceCommand,replayed:boolean){
  await this.ready;
  if(!this.db.inTransaction)throw Error('Progression source capture requires the financial transaction');
  const op=command.body as {id?:unknown;kind?:unknown;action?:unknown}|null;
  const family=familyForPath[command.path];
  const isStart=family==='instant'?op?.kind==='play'||op?.kind==='spin':op?.action==='start';
  if(command.method==='POST'&&!replayed&&family&&isStart&&typeof op?.id==='string'){
   const row=await this.read(accountId,op.id,family);
   if(!row)throw Error('Missing newly accepted progression round');
   const entries=await this.aggregate(accountId,op.id,row.gameId,family);
   await this.sink.acceptRound({sourceType:'paid-game',sourceId:prefix(family)+op.id,accountId,locationId:'south-park',
    gameId:row.gameId,environment:this.environment,fundingSource:'cash',acceptedAt:entries.acceptedAt});
  }
  // A read or an unrelated game operation can finish a previously accepted Flight or Crash round.
  // Only contexts accepted at their original paid start can enter this scan; old sessions are never imported.
  for(const context of await this.sink.pendingRounds(accountId,'paid-game')){
   const found=/^native:(instant|casino|mines|flight):(.+)$/.exec(context.sourceId);
   if(!found)continue;
   const kind=found[1] as Family,roundId=found[2],row=await this.read(accountId,roundId,kind);
   if(!row)throw Error('Missing saved progression round');
   if(row.gameId!==context.gameId)throw Error('Progression source identity changed');
   if(row.active)continue;
   const entries=await this.aggregate(accountId,roundId,row.gameId,kind);
   await this.sink.recordSettled({sourceType:'paid-game',sourceId:context.sourceId,accountId,paidUnits:entries.paidUnits,
    refundedUnits:entries.refundedUnits,settledAt:entries.settledAt,outcome:entries.refundedUnits===entries.paidUnits?'refunded':'settled'});
  }
 }
}

async function acceptedOperation(db:PostgresDatabase,accountId:string,id:unknown){
 if(typeof id!=='string')return false;
 return !!await db.prepare(`SELECT 1 FROM demo_operations WHERE account_id=? AND operation_id=?
  UNION ALL SELECT 1 FROM demo_mines_requests WHERE account_id=? AND id=?
  UNION ALL SELECT 1 FROM demo_flight_requests WHERE account_id=? AND id=?
  UNION ALL SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=? LIMIT 1`).get(accountId,id,accountId,id,accountId,id,accountId,id);
}

/** Adds progression to the live shared wallet without changing the engines or their mathematical source hashes. */
export function instrumentProgressionWallet<T extends DemoWalletStore>(db:PostgresDatabase,wallet:T,sink:ProgressionSourceSink):T{
 const sources=new NativeProgressionSources(db,sink,wallet.ready);
 const invoke=async(target:object,method:Function,path:string,name:string,args:unknown[])=>{
  await sources.ready;
  const accountId=args[0] as string,body=name==='operate'?args[1]:null;
  return db.transaction(async()=>{
   const replayed=body?await acceptedOperation(db,accountId,(body as {id?:unknown}).id):false;
   const result=await Reflect.apply(method,target,args);
   await sources.afterCommand(accountId,{path,method:body?'POST':'GET',body},replayed);
   return result;
  },{lockKey:'account:'+accountId});
 };
 const nested=new Map<PropertyKey,object>();
 const paths:Record<string,string>={mines:'/mines',flight:'/flight',casino:'/casino-sessions',expansion:'/expansion'};
 return new Proxy(wallet,{get(target,key,receiver){
  if(key==='ready')return sources.ready;
  const value=Reflect.get(target,key,receiver);
  if(typeof key==='string'&&paths[key]){
   if(value===null||typeof value!=='object')throw Error('Missing instrumented wallet engine');
   if(!nested.has(key))nested.set(key,new Proxy(value,{get(engine,member){
    const fn=Reflect.get(engine,member);
    if(typeof fn!=='function')return fn;
    if(['operate','active','snapshot','settleDue'].includes(String(member)))return(...args:unknown[])=>invoke(engine,fn,paths[key],String(member),args);
    return fn.bind(engine);
   }}));
   return nested.get(key);
  }
  if(typeof value==='function'){
   if(key==='operate'||key==='snapshot')return(...args:unknown[])=>invoke(target,value,key==='operate'?'/operations':'/',String(key),args);
   return value.bind(target);
  }
  return value;
 }});
}

/** Preserves the PvP money implementation and captures its committed metadata in the same transaction. */
export function instrumentProgressionPvpLedger<T extends VirtualPvpLedger>(db:PostgresDatabase,ledger:T,sink:ProgressionSourceSink):T{
 const ready=Promise.all([ledger.ready,sink.ready]).then(()=>{});
 return new Proxy(ledger,{get(target,key,receiver){
  if(key==='ready')return ready;
  const method=Reflect.get(target,key,receiver);
  if(typeof method!=='function')return method;
  if(key!=='pvpHold'&&key!=='pvpFinish')return method.bind(target);
  return async(accountId:string,value:unknown,now=Date.now())=>{
   await ready;
   return db.transaction(async()=>{
    const result=await Reflect.apply(method,target,[accountId,value,now]);
    if(result.replayed)return result;
    const matchId=(value as {matchId:string}).matchId;
    const bank=await db.prepare('SELECT * FROM virtual_pvp_banks WHERE match_id=?').get(matchId);
    if(!bank)throw Error('Missing paid PvP source bank');
    if(key==='pvpHold'){
     const hold=await db.prepare('SELECT * FROM virtual_pvp_holds WHERE match_id=? AND account_id=?').get(matchId,accountId);
     if(!hold||hold.state!=='held')throw Error('Missing paid PvP source hold');
     await sink.acceptRound({sourceType:'pvp',sourceId:matchId,accountId,locationId:'south-park',gameId:String(bank.game_id),
      environment:'VIRTUAL_USD',fundingSource:'cash',acceptedAt:now});
    }else{
     if(!['settled','refunded'].includes(bank.state))throw Error('PvP source was not settled');
     for(const hold of await db.prepare('SELECT * FROM virtual_pvp_holds WHERE match_id=? ORDER BY account_id').all(matchId)){
      const paidUnits=String(integer(hold.stake_units)*MICRO_PER_CENT);
      await sink.recordSettled({sourceType:'pvp',sourceId:matchId,accountId:String(hold.account_id),paidUnits,
       refundedUnits:bank.state==='refunded'?paidUnits:'0',settledAt:now,outcome:bank.state==='refunded'?'refunded':'settled'});
     }
    }
    return result;
   });
  };
 }});
}
