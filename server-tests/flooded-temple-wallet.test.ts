import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {DemoExpansionStore} from '../server/demoExpansion';
import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts';
import {TEMPLE_GAME,validTempleSession} from '../src/shared/floodedTemple';
async function fixture(bonus=true){
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet=new DemoWalletStore(db,()=>0);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:10000});await wallet.expansion.ready;
  let draws=0;const values=[0,0,0,98,0,0],draw=(max:number)=>{const n=bonus?values[draws++%6]:(draws++,0);assert(n<max);return n;};
  const create=()=>new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},draw);
  const store=create(),operate=(account:string,op:unknown,s=store,capable=true)=>s.operate(account,op,2,true,true,true,true,true,true,true,true,2,3,true,false,capable);
  const start=()=>({id:randomUUID(),action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'normal'}}});
  const move=(session:any,room?:number,rope=false)=>({id:randomUUID(),action:'move',gameId:TEMPLE_GAME,sessionId:session.id,revision:session.view.temple.revision,move:room===undefined?'temple-finish':rope?'temple-rope':'temple-step',...(room===undefined?{}:{picks:[room]})});
  return {db,wallet,store,create,operate,start,move,draws:()=>draws};
}
test('simultaneous retries of a paid start spend once and do not draw another board',async()=>{
  const f=await fixture(false);try{
    const before=await demoBalanceUnits(f.db,'alice'),op=f.start();
    const replies=await Promise.all(Array.from({length:5},()=>f.operate('alice',op)));
    assert(replies.every(r=>validTempleSession(r.session)&&r.session.state==='settled'));
    assert.equal(await demoBalanceUnits(f.db,'alice'),before-1000);assert.equal(f.draws(),4);assert.equal(await demoReservedUnits(f.db,'alice'),0);
    await assert.rejects(f.operate('alice',{...op,stakeUnits:'2000'}));assert.equal(f.draws(),4);
    const rows=await f.db.prepare('SELECT kind,count(*) AS n FROM demo_ledger WHERE account_id=? GROUP BY kind').all('alice');
    assert(rows.length>0);
  }finally{await f.db.close();}
});
test('Caribbean and Temple capabilities remain separate after integration',async()=>{
  const f=await fixture();try{
    const started=await f.operate('alice',f.start()),before=await demoBalanceUnits(f.db,'alice'),draws=f.draws();
    const caribbeanOnly=await f.store.active('alice',true,true,true,true,true,true,true,2,3,true,false,false);
    assert(!caribbeanOnly.sessions.some(s=>s.gameId===TEMPLE_GAME));
    const templeOnly=await f.store.active('alice',true,true,true,true,true,true,true,2,3,false,false,true);
    const forestOnly=await f.store.active('alice',true,true,true,true,true,true,true,2,3,false,true,false);assert(!forestOnly.sessions.some(s=>s.gameId===TEMPLE_GAME));
    await assert.rejects(f.store.operate('alice',f.start(),2,true,true,true,true,true,true,true,true,2,3,true,true,false),/Обнови/);
    await assert.rejects(f.store.operate('alice',{...f.start(),gameId:'studio-forest-heart',settings:{forestHeart:{mode:'normal'}}},2,true,true,true,true,true,true,true,true,2,3,true,false,true),/Обнови/);
    assert(templeOnly.sessions.some(s=>s.id===started.session.id));
    await assert.rejects(f.store.operate('alice',f.start(),2,true,true,true,true,true,true,true,true,2,3,true,false,false));
    await assert.rejects(f.store.operate('alice',{id:randomUUID(),action:'start',gameId:'studio-caribbean-treasures',stakeUnits:'100',settings:{caribbean:{lines:1,mode:'normal'}}},2,true,true,true,true,true,true,true,true,2,3,false,false,true));
    assert.equal(await demoBalanceUnits(f.db,'alice'),before);assert.equal(f.draws(),draws);
  }finally{await f.db.close();}
});
test('bonus survives a new store, hides from old clients, rejects foreign and stale moves and settles once',async()=>{
  const f=await fixture();try{
    const before=await demoBalanceUnits(f.db,'alice'),op=f.start();let reply=await f.operate('alice',op);
    assert(validTempleSession(reply.session));assert.equal(reply.session.state,'active');assert.equal(await demoBalanceUnits(f.db,'alice'),before-1000);assert(await demoReservedUnits(f.db,'alice')>0);
    await assert.rejects(f.operate('alice',f.start()));
    await assert.rejects(f.operate('alice',op,f.store,false));assert.equal(f.draws(),6);
    assert(!(await f.store.active('alice')).sessions.some(s=>s.gameId===TEMPLE_GAME));
    const first=f.move(reply.session,6);await assert.rejects(f.operate('bob',first));
    const racing=await Promise.allSettled([f.operate('alice',first),f.operate('alice',{...first,id:randomUUID()})]);assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);
    const restored=f.create(),active=await restored.active('alice',true,true,true,true,true,true,true,2,3,true,false,true);
    let session=active.sessions.find(s=>s.id===op.id)!;assert.equal(session.view.temple!.revision,2);
    let last:any=first;
    for(const [to,rope]of [[11,false],[12,true],[13,false],[8,false],[9,false]]as const){last=f.move(session,to,rope);reply=await f.operate('alice',last,restored);session=reply.session;assert(validTempleSession(session));if(session.state==='active')assert.equal(await demoBalanceUnits(f.db,'alice'),before-1000);}
    assert.equal(session.returnedUnits,'1750');assert.equal(await demoBalanceUnits(f.db,'alice'),before+750);assert.equal(await demoReservedUnits(f.db,'alice'),0);assert.equal(f.draws(),6);
    const repeat=await f.operate('alice',last,restored);assert(repeat.replayed);assert.deepEqual(repeat.session,session);assert.equal(await demoBalanceUnits(f.db,'alice'),before+750);
    await assert.rejects(f.operate('alice',{...last,id:randomUUID()},restored));
  }finally{await f.db.close();}
});
test('ending early preserves collected rewards and invalid actions leave state, funds and entropy unchanged',async()=>{
  const f=await fixture();try{
    const before=await demoBalanceUnits(f.db,'alice');let reply=await f.operate('alice',f.start());
    const invalid=f.move(reply.session,19);await assert.rejects(f.operate('alice',invalid));assert.equal(f.draws(),6);
    for(const to of[6,7,6,7])reply=await f.operate('alice',f.move(reply.session,to));
    assert.equal(reply.session.view.temple!.bonusState!.payoutUnits,'100');assert.equal(reply.session.view.temple!.bonusState!.left,2);
    const end=f.move(reply.session);reply=await f.operate('alice',end);assert.equal(reply.session.returnedUnits,'100');assert.equal(await demoBalanceUnits(f.db,'alice'),before-900);
    await f.operate('alice',end);assert.equal(await demoBalanceUnits(f.db,'alice'),before-900);
  }finally{await f.db.close();}
});
test('failed shared ledger append rolls back the final move and can be retried exactly once',async()=>{
  const f=await fixture();try{
    let reply=await f.operate('alice',f.start());const before=await demoBalanceUnits(f.db,'alice'),end=f.move(reply.session);
    await f.db.exec("CREATE FUNCTION reject_temple_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='win' THEN RAISE EXCEPTION 'injected temple failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_temple BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_temple_fn()");
    await assert.rejects(f.operate('alice',end),/injected temple failure/);
    assert.equal(await demoBalanceUnits(f.db,'alice'),before);assert(await demoReservedUnits(f.db,'alice')>0);
    await f.db.exec('DROP TRIGGER reject_temple ON demo_ledger');
    reply=await f.operate('alice',end);assert.equal(reply.session.state,'settled');assert.equal(await demoReservedUnits(f.db,'alice'),0);
    assert((await f.operate('alice',end)).replayed);
  }finally{await f.db.close();}
});
test('every allowed stake spends the exact integer amount and invalid starts never draw',async()=>{
  const f=await fixture(false);try{
    let expected=await demoBalanceUnits(f.db,'alice');
    await assert.rejects(f.operate('alice',{...f.start(),stakeUnits:'1001'}));
    await assert.rejects(f.operate('bob',f.start()));assert.equal(f.draws(),0);
    for(const stake of[1000,2000,5000,10000,20000,50000]){
      const action={...f.start(),stakeUnits:String(stake)},reply=await f.operate('alice',action);expected-=stake;
      assert(validTempleSession(reply.session));assert.equal(reply.session.spentUnits,String(stake));assert.equal(reply.session.returnedUnits,'0');assert.equal(await demoBalanceUnits(f.db,'alice'),expected);
    }
    assert.equal(f.draws(),24);assert.equal(await demoReservedUnits(f.db,'alice'),0);
  }finally{await f.db.close();}
});
