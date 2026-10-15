import {randomUUID} from 'node:crypto';
import type {PostgresDatabase} from './database';
import {demoBalanceUnits,demoReservedUnits,MAX_DEMO_UNITS,recordDemoUnits,saveDemoUnits} from './demoWalletAmounts';

export type ProviderPendingReason = 'debit'|'credit'|'refund'|'rollback'|'transfer';
export function providerDecimal(units:bigint):string {
  if(units<0n)throw new Error('Invalid provider balance');
  return `${units/100n}.${(units%100n).toString().padStart(2,'0')}`;
}
export async function providerPendingUnits(db:PostgresDatabase,accountId:string):Promise<bigint> {
  const row=await db.prepare('SELECT pending_units FROM capro_pending_balances WHERE account_id=?').get(accountId);
  const units=row?.pending_units??'0';
  if(typeof units!=='string'||!/^(0|[1-9][0-9]*)$/.test(units))throw new Error('Invalid saved provider balance');
  return BigInt(units);
}
export async function saveProviderPendingUnits(db:PostgresDatabase,accountId:string,operationId:string,change:bigint,units:bigint,reason:ProviderPendingReason) {
  if(units<0n)throw new Error('Invalid provider balance');
  await db.transaction(async()=>{
    if(await providerPendingUnits(db,accountId)+change!==units)throw new Error('Provider pending ledger does not match balance');
    await db.prepare('INSERT INTO capro_pending_balances(account_id,pending_units) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET pending_units=excluded.pending_units').run(accountId,units.toString());
    await db.prepare('INSERT INTO capro_pending_ledger(account_id,operation_id,amount_units,pending_balance_units,reason,created_at) VALUES (?,?,?,?,?,?)').run(accountId,operationId,change.toString(),units.toString(),reason,Date.now());
  },{lockKey:'account:'+accountId});
}

// Run after a local round has updated its reserves and ledger, under the same account lock.
export async function releaseProviderPending(db:PostgresDatabase,accountId:string):Promise<bigint> {
  return db.transaction(async()=>{
    const pending=await providerPendingUnits(db,accountId);if(!pending)return 0n;
    const balance=await demoBalanceUnits(db,accountId),reserved=await demoReservedUnits(db,accountId);
    if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(reserved)||balance<0||reserved<0)throw new Error('Invalid demo wallet capacity');
    const capacity=MAX_DEMO_UNITS-balance-reserved;if(capacity<=0)return pending;
    const released=pending<BigInt(capacity)?pending:BigInt(capacity),remaining=pending-released;
    const operationId=`capro:transfer:${randomUUID()}`,nextBalance=balance+Number(released);
    await saveDemoUnits(db,accountId,nextBalance);
    await recordDemoUnits(db,accountId,operationId,'win',Number(released),nextBalance,'casinoapipro','Отложенный выигрыш');
    await saveProviderPendingUnits(db,accountId,operationId,-released,remaining,'transfer');
    return remaining;
  },{lockKey:'account:'+accountId});
}
