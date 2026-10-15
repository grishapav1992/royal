import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { BASE_EXPANSION_GAMES, validExpansionAction, type ExpansionAction, type ExpansionGameId } from '../src/shared/casinoExpansion';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';
const start=(gameId:ExpansionGameId,side=false):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:gameId==='github-dragon-tiger'?{bet:'dragon'}:gameId==='github-sic-bo'?{bet:'small'}:['github-three-card','github-ultimate'].includes(gameId)?{side}:{}});
const move=(s:{id:string;gameId:ExpansionGameId},name:string,picks?:number[]):ExpansionAction=>({id:randomUUID(),gameId:s.gameId,action:'move',sessionId:s.id,move:name,...(picks?{picks}:{})});
async function fixture(){const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");const wallet=new DemoWalletStore(db,()=>0);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:100000});return{db,wallet};}
test('all twenty-six games use the common wallet and reload private state without duplicated debits',async()=>{
  const {db,wallet}=await fixture();try{
    for(const gameId of BASE_EXPANSION_GAMES){
      const op=start(gameId,true),before=await demoBalanceUnits(db,'alice'),first=await wallet.expansion.operate('alice',op);
      assert.equal(first.session.gameId,gameId);assert.equal(first.session.spentUnits,gameId==='github-ultimate'||gameId==='github-let-it-ride'?'3000':['github-three-card','github-switch','github-crazy-four'].includes(gameId)?'2000':'1000');
      assert(!('engine' in first.session));assert(!('crashPoint' in first.session));if(gameId==='github-crash')assert(!('crashAt' in first.session));
      const replies=await Promise.all(Array.from({length:3},()=>wallet.expansion.operate('alice',op)));assert(replies.every(r=>r.replayed));
      const balance=await demoBalanceUnits(db,'alice');assert.equal(balance,before-Number(first.session.spentUnits)+Number(first.session.returnedUnits));
      const reopened=new DemoWalletStore(db,()=>{throw Error('must not redraw');});assert((await reopened.expansion.active('alice')).sessions.some(s=>s.id===op.id));
      await assert.rejects(wallet.expansion.operate('alice',{...op,stakeUnits:'5000'}),/изменить/);
      if(first.session.state==='active'&&gameId!=='github-crash'){
        await assert.rejects(reopened.expansion.operate('bob',move(first.session,first.session.view.actions[0].move)),/найдена/);
        let current=first.session;
        for(let turn=0;turn<20&&current.state==='active';turn++){
          const name=gameId==='github-pai-gow'?'auto':gameId==='github-deuces'?'hold':gameId==='github-let-it-ride'?'pull':gameId==='github-ultimate'?current.view.actions.find(a=>a.move==='check')?'check':'play1':['no-insurance','keep','stand','play1','play','check','decline','andar'].find(m=>current.view.actions.some(a=>a.move===m))??current.view.actions[0].move;
          const action=move(current,name,name==='hold'?[]:undefined),r=await reopened.expansion.operate('alice',action);current=r.session;
          assert.equal((await reopened.expansion.operate('alice',action)).wallet.balance,r.wallet.balance);
        }
        assert.equal(current.state,'settled',gameId+' ends');
      }
      assert.equal((await wallet.casino.active('alice')).sessions.length,0,'old Hi-Lo/Tower response excludes expansion state');
    }
    const ledger=await db.prepare('SELECT SUM(amount_units) AS total FROM demo_ledger WHERE account_id=?').get('alice');assert.equal(Number(ledger!.total),await demoBalanceUnits(db,'alice'));
  }finally{await db.close();}
});
test('additional wagers, partial refunds, cross-game IDs and shared capacity are enforced',async()=>{
  const {db,wallet}=await fixture();try{
    const op=start('github-let-it-ride'),r=await wallet.expansion.operate('alice',op);assert.equal(await demoReservedUnits(db,'alice'),3003000);
    await wallet.expansion.operate('alice',move(r.session,'pull'));assert.equal(await demoReservedUnits(db,'alice'),3002000);
    const refunds=await db.prepare("SELECT amount_units FROM demo_ledger WHERE account_id='alice' AND entry_type='refund'").all();assert.deepEqual(refunds.map(r=>Number(r.amount_units)),[1000]);
    await assert.rejects(wallet.operate('alice',{id:op.id,kind:'deposit',amount:10}),/использован/);
    await assert.rejects(wallet.casino.operate('alice',{id:op.id,gameId:'github-hilo',action:'start',stakeUnits:'1000',settings:{}}),/изменить/);
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-3002000);await assert.rejects(wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1}));
    await assert.rejects(wallet.expansion.operate('alice',start('github-deuces')),/лимит/);
    for(const bad of [{...start('github-war'),payoutUnits:'9999'},{...start('github-sic-bo'),settings:{bet:'triple'}},{...move(r.session,'pull'),engine:{}}])assert(!validExpansionAction(bad));
  }finally{await db.close();}
});
test('failed state or request persistence rolls back both debit and payout',async()=>{
  const {db,wallet}=await fixture();try{
    const initial=await demoBalanceUnits(db,'alice');
    await db.exec("CREATE FUNCTION reject_expansion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted'; END $$;CREATE TRIGGER reject_expansion BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_expansion()");
    const op=start('github-sic-bo');await assert.rejects(wallet.expansion.operate('alice',op),/interrupted/);assert.equal(await demoBalanceUnits(db,'alice'),initial);assert.equal((await wallet.expansion.active('alice')).sessions.length,0);
    await db.exec('DROP TRIGGER reject_expansion ON demo_casino_requests');const r=await wallet.expansion.operate('alice',start('github-let-it-ride'));const action=move(r.session,'pull');
    await db.exec('CREATE TRIGGER reject_expansion BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_expansion()');await assert.rejects(wallet.expansion.operate('alice',action),/interrupted/);assert.equal(await demoBalanceUnits(db,'alice'),initial-3000);assert.equal((await wallet.expansion.active('alice')).sessions.find(s=>s.id===r.session.id)!.returnedUnits,'0');
    await db.exec('DROP TRIGGER reject_expansion ON demo_casino_requests');assert.equal((await wallet.expansion.operate('alice',action)).session.returnedUnits,'1000');
  }finally{await db.close();}
});
test('Crash hides the future stop, never pays after it and serializes concurrent cashouts',async()=>{
  const {db,wallet}=await fixture();let clock=10000;
  const store=new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},()=>0,()=>clock,cardEngine,()=>2);
  try{
    const r=await store.operate('alice',start('github-crash'));assert(!('crashAt' in r.session));clock=17000;
    const action=move(r.session,'cashout'),results=await Promise.all([store.operate('alice',action),store.operate('alice',action)]);
    assert.equal(results[0].session.returnedUnits,'1340');assert.equal(results[1].wallet.balance,results[0].wallet.balance);
    const wins=await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='github-crash' AND entry_type='win'").get();assert.equal(Number(wins!.n),1);
    const late=await store.operate('alice',start('github-crash'));clock+=20000;const stopped=await store.operate('alice',move(late.session,'cashout'));assert.equal(stopped.session.returnedUnits,'0');assert.equal(stopped.session.state,'settled');
    assert.equal((await store.operate('alice',move(late.session,'cashout'))).wallet.balance,stopped.wallet.balance);
    assert.equal(await demoReservedUnits(db,'alice'),0);
  }finally{await db.close();}
});

test('exchange fees, sixth-card selection and a prepaid Andar choice use exact shared debits',async()=>{
  const {db,wallet}=await fixture();try{
    for(const gameId of ['github-oasis','github-russian','github-caribbean-draw'] as const){
      const first=await wallet.expansion.operate('alice',start(gameId)),before=await demoBalanceUnits(db,'alice'),action=move(first.session,gameId==='github-caribbean-draw'?'draw':'exchange',[0,1]);
      await assert.rejects(wallet.expansion.operate('alice',move(first.session,gameId==='github-caribbean-draw'?'draw':'exchange',[0,5])),/количество/);
      const r=await wallet.expansion.operate('alice',action);assert.equal(before-await demoBalanceUnits(db,'alice'),gameId==='github-caribbean-draw'?1000:2000);
      assert.equal((await wallet.expansion.operate('alice',action)).wallet.balance,r.wallet.balance);
      await wallet.expansion.operate('alice',move(r.session,'fold'));
    }
    const six=await wallet.expansion.operate('alice',start('github-russian')),bought=await wallet.expansion.operate('alice',move(six.session,'buy-sixth'));assert.equal(bought.session.spentUnits,'2000');assert.equal(bought.session.view.player.length,6);
    const picked=await wallet.expansion.operate('alice',move(bought.session,'discard',[5]));assert.equal(picked.session.spentUnits,'2000');assert.equal(picked.session.view.player.length,5);await wallet.expansion.operate('alice',move(picked.session,'fold'));
    const first=await wallet.expansion.operate('alice',start('github-andar-bahar'));assert.equal(first.session.spentUnits,'1000');assert.equal(first.session.view.player.length,1);
    const r=await wallet.expansion.operate('alice',move(first.session,'andar'));assert.equal(r.session.spentUnits,'1000');assert(['0','1900','2000'].includes(r.session.returnedUnits));assert.equal(r.session.state,'settled');
    const ledger=await db.prepare('SELECT SUM(amount_units) AS total FROM demo_ledger WHERE account_id=?').get('alice');assert.equal(Number(ledger!.total),await demoBalanceUnits(db,'alice'));
  }finally{await db.close();}
});

test('the largest Mississippi payout fits the shared reservation and is credited once',async()=>{
  const {db,wallet}=await fixture();
  const rigged:typeof cardEngine=async(game,name,payload,picks,side)=>{
    const r=await cardEngine(game,name,payload,picks,side);
    if(game==='mississippi'&&name==='start'){
      const p=r.payload as {ph:unknown[];cc:unknown[]};const card=(v:number)=>({d:1,v,w:true});p.ph=[card(1),card(13)];p.cc=[card(12),card(11),card(10)];r.view=(await cardEngine(game,'view',p)).view;
    }return r;
  };
  const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>0,Date.now,rigged);
  try{
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-5010000+1000);
    let r=await store.operate('alice',start('github-mississippi'));assert.equal(await demoReservedUnits(db,'alice'),5010000);
    let last:ExpansionAction;for(let i=0;i<3;i++){last=move(r.session,'play3');r=await store.operate('alice',last);}
    assert.equal(r.session.returnedUnits,'5010000');assert.equal(r.session.spentUnits,'10000');assert.equal(r.wallet.balance,(MAX_DEMO_UNITS-9000)/100);assert.equal(await demoReservedUnits(db,'alice'),0);
    assert.equal((await store.operate('alice',last!)).wallet.balance,r.wallet.balance);
    const payouts=await db.prepare("SELECT amount_units FROM demo_ledger WHERE source='github-mississippi' AND entry_type='win'").all();assert.deepEqual(payouts.map(r=>Number(r.amount_units)),[5010000]);
  }finally{await db.close();}
});
