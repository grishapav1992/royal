import { applySchemaMigration } from '../database-migrations';
import type { DatabaseRow, PostgresDatabase } from '../database';
import { CryptoError } from '../crypto/config';
import { gameAccountId } from '../../src/shared/nileWallet';
import { COMBAT_USDT_STAKES, type CombatEscrowReceipt } from '../../src/shared/combatEscrow';
type Services={
 atomic<T>(fn:()=>Promise<T>):Promise<T>;
 wallet(account:string):Promise<DatabaseRow>;
 post(account:string,id:string,key:string,available:bigint,reserved:bigint):Promise<void>;
 canFund():boolean;custody():{units:bigint;until:number}|undefined;now():number;
};
const fail=(status:number,message:string):never=>{throw new CryptoError(status,message);};
export class CryptoCombatEscrow {
 readonly ready:Promise<void>;
 constructor(private db:PostgresDatabase,prerequisite:Promise<void>,private services:Services){
  this.ready=prerequisite.then(()=>applySchemaMigration(db,{id:'crypto-combat-escrow-v1',statements:[`CREATE TABLE IF NOT EXISTS crypto_combat_matches(
   id TEXT PRIMARY KEY,accounts TEXT NOT NULL,stake_units BIGINT NOT NULL CHECK(stake_units>0),
   state TEXT NOT NULL CHECK(state IN ('active','settled','refunded','cancelled')),
   expires_at BIGINT NOT NULL,winner TEXT NOT NULL DEFAULT '',fee_units BIGINT NOT NULL DEFAULT 0,payout_units BIGINT NOT NULL DEFAULT 0)`,
   `CREATE TABLE IF NOT EXISTS crypto_combat_seats(
   account_id TEXT PRIMARY KEY REFERENCES accounts(id),match_id TEXT NOT NULL REFERENCES crypto_combat_matches(id),
   stake_units BIGINT NOT NULL CHECK(stake_units>0),capacity_units BIGINT NOT NULL CHECK(capacity_units>=0))`,
   `CREATE INDEX IF NOT EXISTS crypto_combat_expiry ON crypto_combat_matches(state,expires_at)`]}));
 }
 private receipt(row:DatabaseRow):CombatEscrowReceipt{
  return{id:row.id,accounts:JSON.parse(row.accounts),stakeUnits:String(row.stake_units),state:row.state,
   winner:row.winner,feeUnits:String(row.fee_units),payoutUnits:String(row.payout_units),expiresAt:Number(row.expires_at)};
 }
 async capacity(account:string){await this.ready;return BigInt((await this.db.prepare('SELECT capacity_units FROM crypto_combat_seats WHERE account_id=?').get(account))?.capacity_units??0);}
 private request(actor:string,value:unknown,action:'fund'|'settle'|'cancel'){
  if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Некорректный запрос банка боя.');
  const v=value as Record<string,any>,keys=action==='settle'?'accounts,id,stakeUnits,winner':'accounts,id,stakeUnits';
  if(Object.keys(v).sort().join(',')!==keys||!gameAccountId(v.id)||!Array.isArray(v.accounts)||v.accounts.length!==2
   ||!v.accounts.every(gameAccountId)||v.accounts[0]===v.accounts[1]||v.accounts[0]!==actor
   ||typeof v.stakeUnits!=='string'||!(COMBAT_USDT_STAKES as readonly number[]).some(n=>String(n*1_000_000)===v.stakeUnits)
   ||action==='settle'&&(typeof v.winner!=='string'||v.winner!==''&&!v.accounts.includes(v.winner)))fail(400,'Некорректный запрос банка боя.');
  return v as {id:string;accounts:[string,string];stakeUnits:string;winner?:string};
 }
 private async existing(v:{id:string;accounts:string[];stakeUnits:string}){
  const old=await this.db.prepare('SELECT * FROM crypto_combat_matches WHERE id=?').get(v.id);
  if(old&&(old.accounts!==JSON.stringify(v.accounts)||String(old.stake_units)!==v.stakeUnits))fail(409,'Этот номер боя уже использован.');
  return old;
 }
 async fund(actor:string,value:unknown){
  const v=this.request(actor,value,'fund');await this.ready;
  return this.services.atomic(async()=>{
   const old=await this.existing(v);if(old)return old.state==='active'&&old.expires_at<=this.services.now()?this.finish(old,''):this.receipt(old);
   if(!this.services.canFund())fail(503,'Ставки USDT в боях пока не подключены.');
   const custody=this.services.custody(),now=this.services.now();
   const liabilities=BigInt((await this.db.prepare('SELECT coalesce(sum(balance_units+reserved_units),0)::text AS units FROM crypto_wallets').get())!.units);
   if(!custody||custody.until<=now||custody.units<liabilities)fail(503,'Баланс USDT временно не подтверждён.');
   const stake=BigInt(v.stakeUnits),capacity=stake*9n/10n;
   for(const account of v.accounts){
    if(await this.db.prepare('SELECT 1 FROM crypto_combat_seats WHERE account_id=?').get(account))fail(409,'Сначала заверши другой бой USDT.');
    if(!await this.db.prepare('SELECT 1 FROM accounts WHERE id=?').get(account))fail(409,'Второй игрок должен открыть кошелёк USDT.');
    const wallet=await this.services.wallet(account);
    if(BigInt(wallet.balance_units)<stake)fail(409,'У одного из игроков недостаточно USDT.');
    if(BigInt(wallet.balance_units)+BigInt(wallet.reserved_units)+capacity>1_000_000_000_000n)fail(409,'Недостаточно места в кошельке для выигрыша.');
   }
   await this.db.prepare("INSERT INTO crypto_combat_matches(id,accounts,stake_units,state,expires_at) VALUES (?,?,?,'active',?)").run(v.id,JSON.stringify(v.accounts),v.stakeUnits,now+150000);
   for(const account of v.accounts){
    await this.db.prepare('INSERT INTO crypto_combat_seats VALUES (?,?,?,?)').run(account,v.id,v.stakeUnits,String(capacity));
    await this.services.post(account,v.id,'combat-reserve:'+v.id+':'+account,-stake,stake);
   }
   return this.receipt((await this.existing(v))!);
  });
 }
 private async finish(row:DatabaseRow,winner:string){
  if(row.state!=='active')return this.receipt(row);
  const accounts=JSON.parse(row.accounts) as string[],stake=BigInt(row.stake_units);
  if(row.expires_at<=this.services.now())winner='';
  const fee=winner?stake/10n:0n,payout=winner?stake*2n-fee:0n;
  await this.db.prepare('DELETE FROM crypto_combat_seats WHERE match_id=?').run(row.id);
  for(const account of accounts)await this.services.post(account,row.id,(winner?'combat-settle:':'combat-refund:')+row.id+':'+account,winner?(account===winner?payout:0n):stake,-stake);
  await this.db.prepare('UPDATE crypto_combat_matches SET state=?,winner=?,fee_units=?,payout_units=? WHERE id=?').run(winner?'settled':'refunded',winner,String(fee),String(payout),row.id);
  return this.receipt((await this.db.prepare('SELECT * FROM crypto_combat_matches WHERE id=?').get(row.id))!);
 }
 async settle(actor:string,value:unknown){
  const v=this.request(actor,value,'settle');await this.ready;
  return this.services.atomic(async()=>{
   const old=await this.existing(v);if(!old)fail(409,'Банк боя не найден.');
   return this.finish(old!,v.winner!);
  });
 }
 async cancel(actor:string,value:unknown){
  const v=this.request(actor,value,'cancel');await this.ready;
  return this.services.atomic(async()=>{
   const old=await this.existing(v);if(old)return this.finish(old,'');
   // A tombstone prevents a delayed funding request from debiting a cancelled fight.
   await this.db.prepare("INSERT INTO crypto_combat_matches(id,accounts,stake_units,state,expires_at) VALUES (?,?,?,'cancelled',?)").run(v.id,JSON.stringify(v.accounts),v.stakeUnits,this.services.now()+150000);
   return this.receipt((await this.existing(v))!);
  });
 }
 async recoverExpired(){
  await this.ready;
  await this.services.atomic(async()=>{
   for(const row of await this.db.prepare("SELECT * FROM crypto_combat_matches WHERE state='active' AND expires_at<=? ORDER BY expires_at LIMIT 100").all(this.services.now()))await this.finish(row,'');
  });
 }
 async history(account:string){
  await this.ready;
  return (await this.db.prepare("SELECT * FROM crypto_combat_matches WHERE accounts::jsonb @> ?::jsonb ORDER BY expires_at DESC LIMIT 50").all(JSON.stringify([account]))).map(row=>this.receipt(row));
 }
 async audit(){
  await this.ready;let mismatches=0;
  for(const row of await this.db.prepare('SELECT * FROM crypto_combat_matches').all()){
   const accounts=JSON.parse(row.accounts) as string[],stake=BigInt(row.stake_units),winner=row.winner;
   if(row.state==='cancelled'){
    if((await this.db.prepare('SELECT 1 FROM crypto_ledger WHERE operation_id=?').get(row.id)))mismatches++;
    continue;
   }
   for(const account of accounts){
    const rows=await this.db.prepare('SELECT * FROM crypto_ledger WHERE operation_id=? AND account_id=? ORDER BY id').all(row.id,account);
    const expected=[{key:'combat-reserve:',available:-stake,reserved:stake}];
    if(row.state!=='active')expected.push({key:winner?'combat-settle:':'combat-refund:',available:winner?(account===winner?stake*19n/10n:0n):stake,reserved:-stake});
    if(rows.length!==expected.length||expected.some((e,i)=>!rows[i]||rows[i].entry_key!==e.key+row.id+':'+account||BigInt(rows[i].available_delta)!==e.available||BigInt(rows[i].reserved_delta)!==e.reserved))mismatches++;
   }
   if(row.state==='settled'&&(!accounts.includes(winner)||BigInt(row.fee_units)!==stake/10n||BigInt(row.payout_units)!==stake*19n/10n))mismatches++;
  }
  return mismatches;
 }
}
