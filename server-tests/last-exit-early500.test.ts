import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';import {DemoWalletStore} from '../server/demoWallet';import {DemoExpansionStore} from '../server/demoExpansion';import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts';import {cardEngine} from '../server/games/cardEngine';
test('500 stake is debited, early payouts include the stake, and loss removes the entire 500',async()=>{
 const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('early500')");const wallet=new DemoWalletStore(db,()=>0);await wallet.operate('early500',{id:randomUUID(),kind:'deposit',amount:10000});await wallet.expansion.ready;
 let now=100000,point=10;const store=new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},()=>0,()=>now,cardEngine,()=>point);
 try{for(const [roll,ms,paid]of [[10,166,50500],[10,1589,55000],[10,3000,59500],[1,0,0],[1.005,166,0]]){
  point=roll;now+=100000;const before=await demoBalanceUnits(db,'early500');const s=(await store.operate('early500',{id:randomUUID(),gameId:'github-crash',action:'start',stakeUnits:'50000',settings:{}})).session;
  assert.equal(await demoBalanceUnits(db,'early500'),before-50000);now=s.startedAt!+ms;
  const action={id:randomUUID(),gameId:'github-crash' as const,action:'move' as const,sessionId:s.id,move:'cashout'};const r=await store.operate('early500',action);
  assert.equal(r.session.returnedUnits,String(paid));assert.equal(await demoBalanceUnits(db,'early500'),before-50000+paid);assert.equal(await demoReservedUnits(db,'early500'),0);
  await Promise.all(Array.from({length:5},(_,i)=>store.operate('early500',i%2?action:{...action,id:randomUUID()})));
  assert.equal(await demoBalanceUnits(db,'early500'),before-50000+paid);
 }}finally{await db.close();}
});
