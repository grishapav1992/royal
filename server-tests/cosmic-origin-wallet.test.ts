import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts';
import {validLuelonSlotSettlement,validLuelonSlotEnvelope} from '../src/shared/luelonSlots';
import type {ExpansionSession} from '../src/shared/casinoExpansion';

const GAME='studio-cosmic-escape' as const,ACCOUNT='cosmic-origin-player',STAKE='100';
const PURCHASES={
 'cosmic-chaos':{cost:40,spins:10,startMultiplier:1,beamAttempts:1},
 'ufo-invasion':{cost:75,spins:12,startMultiplier:1,beamAttempts:2},
 'deep-echo':{cost:135,spins:15,startMultiplier:3,beamAttempts:1},
} as const;
type Mode=keyof typeof PURCHASES;
type Sample=[max:number,value:number];
const move=(sessionId:string,revision:number)=>({id:randomUUID(),action:'move' as const,gameId:GAME,sessionId,move:'luelon-spin',revision});
const repeated=(max:number,count:number,value:number):Sample[]=>Array.from({length:count},()=>[max,value]);
function raw():Sample[] {
 // One three-symbol line pays 120 hundredths. The other cells do not create a paid line.
 const grid=[0,0,0,3,4,2,3,4,5,6,4,5,6,0,1];
 return [...grid.map(value=>[7,value] as Sample),...repeated(1000,20,999)];
}
function freeEntropy(mode:Mode,first:boolean):Sample[] {
 const beams=()=>repeated(1000,PURCHASES[mode].beamAttempts,999);
 return first
  ?[...raw(),[100,0],[1000,999],...beams(),[100,0],...raw(),...beams()]
  :[...raw(),[100,99],...beams(),[100,99]];
}
function assertValid(session:ExpansionSession) {
 assert.equal(session.gameId,GAME);assert.equal(session.rulesVersion,2);
 assert(validLuelonSlotSettlement(GAME,session.state,session.stakeUnits,session.spentUnits,session.returnedUnits,session.view.luelon));
 assert(validLuelonSlotEnvelope(GAME,session.state,session.view));
}

for(const mode of Object.keys(PURCHASES) as Mode[])for(const profile of [2,undefined]) {
 test(`Cosmic ${mode} saved profile ${profile??'absent'} retains empty, first and final states across PostgreSQL reconnect`,async()=>{
  let db=new PostgresDatabase(':memory:'),pending:Sample[]=[],draws=0;
  const draw=(max:number)=>{
   draws++;const sample=pending.shift();assert(sample,'A replay or reconnect must not request entropy');
   assert.equal(max,sample[0]);return sample[1];
  };
  try {
   await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
   await db.prepare('INSERT INTO accounts(id) VALUES(?)').run(ACCOUNT);
   let wallet=new DemoWalletStore(db,draw);
   const config=PURCHASES[mode],spent=BigInt(STAKE)*BigInt(config.cost);
   await wallet.operate(ACCOUNT,{id:randomUUID(),kind:'deposit',amount:config.cost});
   const start={id:randomUUID(),action:'start' as const,gameId:GAME,stakeUnits:STAKE,settings:{luelon:{mode}}};
   let session=(await wallet.expansion.operate(ACCOUNT,start)).session;
   assertValid(session);assert.equal(session.spentUnits,String(spent));assert.equal(session.returnedUnits,'0');
   assert.equal(session.view.luelon!.history.length,0);assert.equal(session.view.luelon!.bonus!.features.multiplier,config.startMultiplier);
   assert.equal(await demoBalanceUnits(db,ACCOUNT),0);assert.equal(draws,0);
   const row=await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(ACCOUNT,start.id),saved=JSON.parse(row!.payload);
   // Purchase origin rules are identical across entry profiles. Only historical metadata is constructed here.
   if(profile===undefined)delete saved.mathProfileVersion;else saved.mathProfileVersion=profile;
   await db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?').run(JSON.stringify(saved),ACCOUNT,start.id);

   const reconnect=async(expected:ExpansionSession,last?:ReturnType<typeof move>)=>{
    assert.equal(pending.length,0);
    const count=draws,balance=await demoBalanceUnits(db,ACCOUNT),reserve=await demoReservedUnits(db,ACCOUNT);
    const ledger=await db.prepare('SELECT id,operation_id,entry_type,amount_units,balance_units FROM demo_ledger WHERE account_id=? ORDER BY id').all(ACCOUNT);
    const schema=db.schema;await db.close();db=new PostgresDatabase(schema,{existingSchema:true});wallet=new DemoWalletStore(db,draw);
    const recovered=(await wallet.expansion.active(ACCOUNT)).sessions.find(s=>s.id===start.id)!;
    assert.deepEqual(recovered,expected);assertValid(recovered);assert.equal(draws,count);
    assert.equal(await demoBalanceUnits(db,ACCOUNT),balance);assert.equal(await demoReservedUnits(db,ACCOUNT),reserve);
    const startReplay=await wallet.expansion.operate(ACCOUNT,start);assert(startReplay.replayed);assert.deepEqual(startReplay.session,expected);
    if(last){const replay=await wallet.expansion.operate(ACCOUNT,last);assert(replay.replayed);assert.deepEqual(replay.session,expected);}
    assert.equal(draws,count);assert.equal(await demoBalanceUnits(db,ACCOUNT),balance);assert.equal(await demoReservedUnits(db,ACCOUNT),reserve);
    assert.deepEqual(await db.prepare('SELECT id,operation_id,entry_type,amount_units,balance_units FROM demo_ledger WHERE account_id=? ORDER BY id').all(ACCOUNT),ledger);
    const state=await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(ACCOUNT,start.id),payload=JSON.parse(state!.payload);
    assert.equal(payload.mathProfileVersion,profile);assert.equal(Object.hasOwn(payload,'mathProfileVersion'),profile!==undefined);
   };

   await reconnect(session);
   pending=freeEntropy(mode,true);let last=move(start.id,0);
   session=(await wallet.expansion.operate(ACCOUNT,last)).session;
   assert.equal(pending.length,0);assertValid(session);assert.equal(session.state,'active');
   assert.equal(session.view.luelon!.history[0].featuresBefore.multiplier,config.startMultiplier);
   assert.equal(session.view.luelon!.history[0].featuresAfter.multiplier,50);
   assert.equal(session.view.luelon!.history[0].frames.length,2);
   assert(session.view.luelon!.history[0].frames[1].events.some(event=>event.kind==='echo'));
   assert.equal(session.view.luelon!.totalPayoutUnits,'12000');assert.equal(session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,ACCOUNT),0);
   await reconnect(session,last);

   while(session.state==='active') {
    pending=freeEntropy(mode,false);last=move(start.id,session.view.luelon!.revision);
    session=(await wallet.expansion.operate(ACCOUNT,last)).session;assert.equal(pending.length,0);assertValid(session);
    assert.equal(session.spentUnits,String(spent));
    if(session.state==='active'){assert.equal(session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,ACCOUNT),0);}
   }
   const expected=String(BigInt(STAKE)*60n*BigInt(config.spins+1));
   assert.equal(session.view.luelon!.history.length,config.spins);assert.equal(session.view.luelon!.bonus!.played,config.spins);
   assert.equal(session.view.luelon!.capped,false);assert.equal(session.returnedUnits,expected);
   assert.equal(await demoBalanceUnits(db,ACCOUNT),Number(expected));assert.equal(await demoReservedUnits(db,ACCOUNT),0);
   await reconnect(session,last);
   const after=draws;await assert.rejects(wallet.expansion.operate(ACCOUNT,{...last,id:randomUUID()}));assert.equal(draws,after);
   const entries=await db.prepare('SELECT entry_type,amount_units FROM demo_ledger WHERE account_id=? AND source=? ORDER BY id').all(ACCOUNT,GAME);
   assert.deepEqual(entries,[{entry_type:'bet',amount_units:-Number(spent)},{entry_type:'win',amount_units:Number(expected)}]);
  }finally{await db.close();}
 });
}
