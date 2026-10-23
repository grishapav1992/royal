import type { PostgresDatabase } from './database';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, recordDemoUnits } from './demoWalletAmounts';
import { COMBAT_STAKES } from '../src/shared/combat';

export async function combatEscrowSchema(db:PostgresDatabase){
 await db.exec(`CREATE TABLE IF NOT EXISTS combat_matches(
 id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('active','settled','refunded')),
 stake_units BIGINT NOT NULL, accounts TEXT NOT NULL, expires_at BIGINT NOT NULL,
 winner TEXT NOT NULL DEFAULT '', fee_units BIGINT NOT NULL DEFAULT 0, payout_units BIGINT NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS combat_reservations(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 match_id TEXT NOT NULL REFERENCES combat_matches(id), reserved_units BIGINT NOT NULL CHECK(reserved_units>=0));
 CREATE INDEX IF NOT EXISTS combat_expiry ON combat_matches(state,expires_at); `);
}

/** Escrow uses the existing wallet and its account locks, with durable, atomic settlement. */
export class CombatEscrowStore {
 constructor(private db:PostgresDatabase,private prerequisite:Promise<void>,private now:()=>number=Date.now){}
 private async locked<T>(id:string,accounts:string[],fn:()=>Promise<T>){
  const sorted=[...accounts].sort();
  return this.db.transaction(async()=>{
   for(const account of sorted)await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(this.db.schema+':key:account:'+account);
   return fn();
  },{lockKey:'combat:'+id});
 }
 private async balance(account:string,units:number){
  if(!Number.isSafeInteger(units)||units<0||units+await demoReservedUnits(this.db,account)>MAX_DEMO_UNITS)throw Error('Недостаточно места на балансе для выплаты.');
  await this.db.prepare('INSERT INTO demo_wallets(account_id,balance,fraction_units) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET balance=excluded.balance,fraction_units=excluded.fraction_units').run(account,Math.floor(units/100),units%100);
 }
 async fund(id:string,accounts:string[],stake:number){
  await this.prerequisite;
  if(accounts.length!==2||new Set(accounts).size!==2||!(COMBAT_STAKES as readonly number[]).includes(stake))throw Error('Недопустимые участники или ставка.');
  return this.locked(id,accounts,async()=>{
   const old=await this.db.prepare('SELECT * FROM combat_matches WHERE id=?').get(id);
   if(old){
    if(old.accounts!==JSON.stringify(accounts)||old.stake_units!==stake*100||old.state!=='active')throw Error('Этот бой уже завершён или изменён.');
    return;
   }
   const units=stake*100;
   for(const account of accounts){
    if(await this.db.prepare('SELECT 1 FROM combat_reservations WHERE account_id=?').get(account))throw Error('Сначала заверши другой бой.');
    const balance=await demoBalanceUnits(this.db,account);
    if(balance<units)throw Error('У одного из игроков недостаточно монет.');
    if(balance-units+units*1.9+await demoReservedUnits(this.db,account)>MAX_DEMO_UNITS)throw Error('Недостаточно места на балансе для выигрыша.');
   }
   await this.db.prepare("INSERT INTO combat_matches(id,state,stake_units,accounts,expires_at) VALUES (?,'active',?,?,?)").run(id,units,JSON.stringify(accounts),this.now()+120000);
   for(const account of accounts){
    const balance=await demoBalanceUnits(this.db,account)-units;
    await this.balance(account,balance);
    await recordDemoUnits(this.db,account,id,'bet',-units,balance,'mortal-kombat','Mortal Kombat');
    await this.db.prepare('INSERT INTO combat_reservations(account_id,match_id,reserved_units) VALUES (?,?,?)').run(account,id,units*1.9);
   }
  });
 }
 async settle(id:string,winner=''){
  await this.prerequisite;
  const row=await this.db.prepare('SELECT * FROM combat_matches WHERE id=?').get(id);
  if(!row)throw Error('Ставки боя не найдены.');
  const accounts=JSON.parse(row.accounts) as string[];
  if(winner&&!accounts.includes(winner))throw Error('Недопустимый победитель.');
  return this.locked(id,accounts,async()=>{
   const match=(await this.db.prepare('SELECT * FROM combat_matches WHERE id=?').get(id))!;
   if(match.state!=='active')return {winner:match.winner,fee:match.fee_units/100,payout:match.payout_units/100};
   const units=Number(match.stake_units),fee=winner?units/10:0,payout=winner?units*2-fee:0;
   await this.db.prepare('DELETE FROM combat_reservations WHERE match_id=?').run(id);
   for(const account of accounts){
    const credit=winner?(account===winner?payout:0):units;
    if(!credit)continue;
    const balance=await demoBalanceUnits(this.db,account)+credit;
    await this.balance(account,balance);
    await recordDemoUnits(this.db,account,id,winner?'win':'refund',credit,balance,'mortal-kombat','Mortal Kombat');
   }
   await this.db.prepare('UPDATE combat_matches SET state=?,winner=?,fee_units=?,payout_units=? WHERE id=?').run(winner?'settled':'refunded',winner,fee,payout,id);
   return {winner,fee:fee/100,payout:payout/100};
  });
 }
 async recoverExpired(){
  await this.prerequisite;
  for(const row of await this.db.prepare("SELECT id FROM combat_matches WHERE state='active' AND expires_at<=?").all(this.now()))await this.settle(row.id);
 }
}
