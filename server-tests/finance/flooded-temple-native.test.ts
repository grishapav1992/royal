import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {block} from './helpers/nile-play-fixture';
import {NileGameRuntime,type NativeCommand} from '../../server/finance/nile-game-runtime';
import {TEMPLE_GAME,validTempleSession} from '../../src/shared/floodedTemple';
import {validCascadeSession} from '../../src/shared/floodedTempleCascade';
const command=(body:unknown=null,capable=true):NativeCommand=>({path:'/expansion',method:body===null?'GET':'POST',body,flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{},templeRules:capable?1:0});
const start=()=>({id:randomUUID(),action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'normal'}}});
const move=(session:any,to?:number,rope=false)=>({id:randomUUID(),action:'move',gameId:TEMPLE_GAME,sessionId:session.id,revision:session.view.temple.revision,move:to===undefined?'temple-finish':rope?'temple-rope':'temple-step',...(to===undefined?{}:{picks:[to]})});
async function setup(){
  const c=await pvpFixture();await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  let draws=0;const choices=[0,0,0,98,0,0],draw=(max:number)=>{const n=choices[draws++%6];assert(n<max);return n;};
  const games=new NileGameRuntime(c.ledger,draw);await games.ready;return {...c,games,draw,draws:()=>draws};
}
test('Temple uses the common journal, preserves recovery and credits the complete six-step bonus once',async()=>{
  const c=await setup();try{
    const action=start(),initial=BigInt((await c.ledger.wallet(c.a)as any).balanceUnits);
    await assert.rejects(c.games.run(c.a,command(action,false)),/Обнови/);assert.equal(c.draws(),0);
    const replies=await Promise.all(Array.from({length:4},()=>c.games.run(c.a,command(action))))as any[];
    let session=replies[0].session;assert(validTempleSession(session));assert.equal(c.draws(),6);
    assert.equal(replies[0].wallet.asset,'USDT_NILE_TEST');assert.equal(replies[0].wallet.balanceUnits,String(initial-10000000n));
    const restored=new NileGameRuntime(c.ledger,c.draw);
    const hidden=await restored.run(c.a,command(null,false))as any;assert(!hidden.sessions.some((s:any)=>s.id===session.id));
    const active=await restored.run(c.a,command())as any;assert.deepEqual(active.sessions.find((s:any)=>s.id===session.id),session);
    let last:any,reply:any;
    for(const [to,rope]of [[6,false],[11,false],[12,true],[13,false],[8,false],[9,false]]as const){
      last=move(session,to,rope);await assert.rejects(restored.run(c.b,command(last)));
      reply=await restored.run(c.a,command(last));session=reply.session;assert(validTempleSession(session));
      if(session.state==='active')assert.equal(reply.wallet.balanceUnits,String(initial-10000000n));
    }
    const expected=initial-10000000n+17500000n;
    assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');assert.equal(c.draws(),6);
    const repeated=await restored.run(c.a,command(last))as any;assert(repeated.replayed);assert.equal(repeated.wallet.balanceUnits,String(expected));
    assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,String(expected));await c.ledger.audit();
  }finally{await c.close();}
});

test('native cascade starts debit once, cap once and survive a rejected financial journal append',async()=>{
  const c=await setup();try{
    let draws=0;const games=new NileGameRuntime(c.ledger,()=>{draws++;return 0;});
    const op={...start(),settings:{temple:{mode:'cascades'}}},native={...command(op),templeRules:2 as const};
    const before=await c.ledger.wallet(c.a),initial=BigInt((before as any).balanceUnits);
    await c.ledger.db.exec("CREATE FUNCTION reject_cascade_native_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='native' THEN RAISE EXCEPTION 'cascade native append failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_cascade_native BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_cascade_native_fn()");
    await assert.rejects(games.run(c.a,native),/cascade native append failure/);assert.deepEqual(await c.ledger.wallet(c.a),before);
    await c.ledger.db.exec('DROP TRIGGER reject_cascade_native ON events');
    const replies=await Promise.all(Array.from({length:4},()=>games.run(c.a,native)))as any[];
    assert(replies.every(r=>validCascadeSession(r.session)));assert.equal(draws,30);assert.equal(replies[0].session.returnedUnits,'500000');
    assert.equal(replies[0].wallet.balanceUnits,String(initial-10000000n+5000000000n));assert.equal(replies[0].wallet.reservedUnits,'0');
    await c.ledger.audit();
  }finally{await c.close();}
});
test('a rejected financial event rolls back the Temple move, reserve and receipt together',async()=>{
  const c=await setup();try{
    const begun=await c.games.run(c.a,command(start()))as any,end=move(begun.session);
    const before=await c.ledger.wallet(c.a);
    await c.ledger.db.exec("CREATE FUNCTION reject_temple_native_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='native' THEN RAISE EXCEPTION 'injected temple native failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_temple_native BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_temple_native_fn()");
    await assert.rejects(c.games.run(c.a,command(end)),/injected temple native failure/);
    assert.deepEqual(await c.ledger.wallet(c.a),before);
    const active=await c.games.run(c.a,command())as any;assert.equal(active.sessions.find((s:any)=>s.id===begun.session.id).state,'active');
    await c.ledger.db.exec('DROP TRIGGER reject_temple_native ON events');
    const paid=await c.games.run(c.a,command(end))as any;assert.equal(paid.session.state,'settled');assert.equal(paid.wallet.reservedUnits,'0');
    const replay=await c.games.run(c.a,command(end))as any;assert(replay.replayed);assert.equal(replay.wallet.balanceUnits,paid.wallet.balanceUnits);await c.ledger.audit();
  }finally{await c.close();}
});
test('the native command rejects unknown Temple protocol versions before changing the journal',async()=>{
  const c=await setup();try{
    const before=await c.ledger.wallet(c.a);
    await assert.rejects(c.games.run(c.a,{...command(start()),templeRules:3 as any}),/Некорректный запрос/);
    assert.equal(c.draws(),0);assert.deepEqual(await c.ledger.wallet(c.a),before);
  }finally{await c.close();}
});
