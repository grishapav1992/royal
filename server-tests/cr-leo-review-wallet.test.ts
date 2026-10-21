import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
async function writeProof(name: string, value: unknown) {
  if (process.env.CR_LEO_PROOF_DIR) await writeFile(join(process.env.CR_LEO_PROOF_DIR, name), JSON.stringify(value, null, 2) + '\n');
}
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { PENALTY_GAME, type PenaltyRisk, type PenaltyHero } from '../src/shared/crLeo';

const risks: PenaltyRisk[] = ['safe','sharp','extreme'];
const chance = { safe:75, sharp:60, extreme:45 };
async function fixture() {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('review')");
  let now = 100000, roll = 0, zone = 0, draws = 0;
  const wallet = new DemoWalletStore(db,()=>now);
  await wallet.operate('review',{id:randomUUID(),kind:'deposit',amount:100000});
  await wallet.expansion.ready;
  const store = new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},max=>{if(max===100){draws++;return roll;}return max===18?zone:0;},()=>now);
  const start = (risk:PenaltyRisk,stake='50000',hero:PenaltyHero='cr')=>({id:randomUUID(),gameId:PENALTY_GAME,action:'start' as const,stakeUnits:stake,settings:{penalty:{hero,risk}}});
  const move = (id:string,revision:number,kind='penalty-kick',risk?:PenaltyRisk)=>({id:randomUUID(),gameId:PENALTY_GAME,action:'move' as const,sessionId:id,revision,move:kind,...(risk?{penaltyRisk:risk}:{})});
  return {db,store,start,move,draws:()=>draws,set:(value=0,sector=0)=>{roll=value;zone=sector;now+=61000;}};
}

test('actual PostgreSQL ledger returns exactly 99 percent across all 100 rolls for each risk and either hero',async()=>{
  const f=await fixture(),rows=[];
  try {
    for(const hero of ['cr','leo'] as const)for(const risk of risks){
      const before=await demoBalanceUnits(f.db,'review');let goals=0,paid=0;
      for(let roll=0;roll<100;roll++){
        f.set(roll,roll%18);const op=f.start(risk,'50000',hero),reply=await f.store.operate('review',op);
        assert.equal(reply.session.spentUnits,'50000');
        if(reply.session.state==='active'){
          goals++;const bank=f.move(op.id,1,'cashout');const result=await f.store.operate('review',bank);paid+=Number(result.session.returnedUnits);
          assert.equal((await f.store.operate('review',bank)).session.returnedUnits,result.session.returnedUnits);
        }else assert.equal(reply.session.returnedUnits,'0');
        assert.equal(await demoReservedUnits(f.db,'review'),0);
      }
      assert.equal(goals,chance[risk]);assert.equal(paid,4950000);assert.equal(await demoBalanceUnits(f.db,'review'),before-50000);
      rows.push({hero,risk,rounds:100,goals,stakeUnits:50000,totalSpentUnits:5000000,totalReturnedUnits:paid,rtpPercent:99});
    }
    assert.equal(f.draws(),600);
    const ledger=await f.db.prepare("SELECT entry_type, COUNT(*) AS n, SUM(amount_units) AS units FROM demo_ledger WHERE source=? GROUP BY entry_type").all(PENALTY_GAME);
    const bets=ledger.find(r=>r.entry_type==='bet')!,wins=ledger.find(r=>r.entry_type==='win')!;
    assert.equal(Number(bets.n),600);assert.equal(Number(wins.n),600);assert.equal(Number(bets.units),-30000000);assert.equal(Number(wins.units),29700000);
    await writeProof('review-ledger-rtp.json',{verified:true,simulatedCoinsOnly:true,productionWrites:false,rows,ledger});
  }finally{await f.db.close();}
});

test('actual settlements match independent integer amounts for all four stakes, three risks and five stopping points',async()=>{
  const f=await fixture(),rows=[];
  try {
    for(const stake of ['1000','5000','10000','50000'])for(const risk of risks)for(let stop=1;stop<=5;stop++){
      f.set();const before=await demoBalanceUnits(f.db,'review'),op=f.start(risk,stake);let result=await f.store.operate('review',op);
      for(let revision=1;revision<stop;revision++)result=await f.store.operate('review',f.move(op.id,revision));
      if(stop<5)result=await f.store.operate('review',f.move(op.id,stop,'cashout'));
      const expected=BigInt(stake)*99n*100n**BigInt(stop)/(100n*BigInt(chance[risk])**BigInt(stop));
      assert.equal(result.session.returnedUnits,String(expected));assert.equal(await demoBalanceUnits(f.db,'review'),before-Number(stake)+Number(expected));assert.equal(await demoReservedUnits(f.db,'review'),0);
      rows.push({stake,risk,stop,paidUnits:String(expected)});
    }
    await writeProof('review-settlement-grid.json',{verified:true,cases:rows.length,rows});
  }finally{await f.db.close();}
});

test('losing any step after changing risks forfeits one stake and releases the whole reserve',async()=>{
  const f=await fixture();
  try {
    for(let loseAt=1;loseAt<=5;loseAt++){
      f.set(loseAt===1?99:0);const before=await demoBalanceUnits(f.db,'review'),op=f.start('safe');let result=await f.store.operate('review',op);
      for(let revision=1;revision<loseAt;revision++){f.set(revision===loseAt-1?99:0);const action=f.move(op.id,revision,'penalty-kick',risks[revision%3]);result=await f.store.operate('review',action);await f.store.operate('review',action);}
      assert.equal(result.session.state,'settled');assert.equal(result.session.returnedUnits,'0');assert.equal(await demoBalanceUnits(f.db,'review'),before-50000);assert.equal(await demoReservedUnits(f.db,'review'),0);
      await assert.rejects(f.store.operate('review',f.move(op.id,loseAt,'cashout')));
    }
  }finally{await f.db.close();}
});

test('cashout racing a next shot commits exactly one action and never duplicates a credit',async()=>{
  const f=await fixture();
  try {
    for(const risk of risks){
      f.set();const op=f.start(risk),before=await demoBalanceUnits(f.db,'review');await f.store.operate('review',op);
      const bank=f.move(op.id,1,'cashout'),kick=f.move(op.id,1,'penalty-kick','extreme');
      const replies=await Promise.allSettled([f.store.operate('review',bank),f.store.operate('review',kick)]);assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);
      let saved=(await f.store.active('review')).sessions.find(s=>s.id===op.id)!;
      if(saved.state==='active')saved=(await f.store.operate('review',f.move(op.id,2,'cashout'))).session;
      assert.equal(await demoBalanceUnits(f.db,'review'),before-50000+Number(saved.returnedUnits));assert.equal(await demoReservedUnits(f.db,'review'),0);
      const credits=await f.db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE source=? AND entry_type='win' AND operation_id IN (SELECT id FROM demo_casino_requests WHERE session_id=?)").get(PENALTY_GAME,op.id);assert.equal(Number(credits!.n),1);
    }
  }finally{await f.db.close();}
});

test('older clients never receive football sessions and cannot debit a football stake without the capability',async()=>{
  const f=await fixture();
  try {
    const before=await demoBalanceUnits(f.db,'review'),op=f.start('safe');
    await assert.rejects(f.store.operate('review',op,2,true,true,true,true,true,true,true,false));
    assert.equal(await demoBalanceUnits(f.db,'review'),before);assert.equal(f.draws(),0);assert.equal(await demoReservedUnits(f.db,'review'),0);
    await f.store.operate('review',op);
    const older=await f.store.active('review',true,true,true,true,true,true,false),current=await f.store.active('review');
    assert(!older.sessions.some(s=>s.gameId===PENALTY_GAME));assert(current.sessions.some(s=>s.gameId===PENALTY_GAME));assert.equal(older.wallet.balance,current.wallet.balance);
    const other=await f.store.operate('review',{id:randomUUID(),gameId:'github-diamonds',action:'start',stakeUnits:'1000',settings:{}},2,true,true,true,true,true,true,true,false);
    assert(!other.sessions.some(s=>s.gameId===PENALTY_GAME));assert(other.sessions.some(s=>s.gameId==='github-diamonds'));
    const bank=f.move(op.id,1,'cashout');await assert.rejects(f.store.operate('review',bank,2,true,true,true,true,true,true,true,false));
    const paid=await f.store.operate('review',bank);assert.equal(paid.session.returnedUnits,'66000');assert.equal(await demoReservedUnits(f.db,'review'),0);
  }finally{await f.db.close();}
});
