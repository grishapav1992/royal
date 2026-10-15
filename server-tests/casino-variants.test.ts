import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BASE_VARIANT_GAMES, VARIANT_DEFAULTS, VARIANT_GEM_WEIGHTS, VARIANT_GEMS, VARIANT_MAX, diceMultiplier,
  gemWinningCount, gemWinChance, gemMultiplier, sicBoCount, sicBoMultiplier, vaultMultiplier, plinkoTable,
  validVariantView, type VariantGameId, type VariantSettings,
} from '../src/shared/casinoVariants';
import { validExpansionAction, type ExpansionAction } from '../src/shared/casinoExpansion';
import { startVariant, moveVariant, variantPayout } from '../server/games/casinoVariants';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';

const start=(gameId:VariantGameId,settings=VARIANT_DEFAULTS[gameId]):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:structuredClone(settings)});
const move=(s:{id:string;gameId:VariantGameId},name:string,picks?:number[]):ExpansionAction=>({id:randomUUID(),gameId:s.gameId,action:'move',sessionId:s.id,move:name,...(picks===undefined?{}:{picks})});
async function fixture(draw:(max:number)=>number=()=>0){const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");const wallet=new DemoWalletStore(db,draw);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:100000});const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},draw);return{db,wallet,store};}
const lower=(value:number,bound:number,slack=.00011)=>{assert(value<=bound+1e-12,value+' exceeds '+bound);assert(value>=bound-slack,value+' below tolerance');};

test('Dice intervals exhaust all 10000 outcomes and include only the lower boundary',()=>{
  for(const width of [30,50,70] as const){
    let wins=0,payout=0;for(let i=0;i<10000;i++){
      const r=startVariant('variant-dice',{variant:{width}},'10000',()=>i);assert.equal(r.variant.kind,'dice');
      if(r.variant.kind!=='dice')throw Error('Unexpected view');if(r.variant.won)wins++;payout+=r.credit;
      assert.equal(r.credit,r.variant.won?variantPayout('10000',diceMultiplier(width)):0);
    }
    assert.equal(wins,width*100);lower(payout/(10000*10000),.98);
    const low=(100-width)*50;assert.equal(startVariant('variant-dice',{variant:{width}},'1000',()=>low).credit,variantPayout('1000',diceMultiplier(width)));
    assert.equal(startVariant('variant-dice',{variant:{width}},'1000',()=>low+width*100).credit,0);
  }
});

test('Sic Bo exact sums enumerate all 216 outcomes, including triplets, with bounded return',()=>{
  let totalCount=0;
  for(let sum=3;sum<=18;sum++){
    let wins=0;for(let a=0;a<6;a++)for(let b=0;b<6;b++)for(let c=0;c<6;c++){
      const values=[a,b,c];const r=startVariant('variant-sic-bo',{variant:{sum}},'10000',()=>values.shift()!);if(r.credit)wins++;
    }
    assert.equal(wins,sicBoCount(sum));totalCount+=wins;lower(wins/216*sicBoMultiplier(sum),.98);
    assert(sicBoMultiplier(sum)<=VARIANT_MAX['variant-sic-bo']);
  }
  assert.equal(totalCount,216);assert.equal(sicBoMultiplier(3),211.68);assert.equal(sicBoMultiplier(18),211.68);
});

test('weighted gem enumeration matches binomial probabilities and every selected-gem payout bound',()=>{
  const counts=Array.from({length:6},()=>0n),hand:number[]=[];
  const walk=(weight:bigint)=>{if(hand.length===5){for(let gem=0;gem<6;gem++)if(hand.filter(i=>i===gem).length>=2)counts[gem]+=weight;return;}for(let gem=0;gem<6;gem++){hand.push(gem);walk(weight*BigInt(VARIANT_GEM_WEIGHTS[gem]));hand.pop();}};walk(1n);
  for(const gem of [0,1,2,3,4,5] as const){
    assert.equal(counts[gem],gemWinningCount(gem));lower(gemWinChance(gem)*gemMultiplier(gem),.98);
    assert(gemMultiplier(gem)<=VARIANT_MAX['variant-diamonds']);
    const random=VARIANT_GEM_WEIGHTS.slice(0,gem).reduce((a,b)=>a+b,0),r=startVariant('variant-diamonds',{variant:{gem}},'1000',()=>random);
    assert.equal(r.credit,variantPayout('1000',gemMultiplier(gem)));assert.equal(r.variant.kind,'diamonds');if(r.variant.kind==='diamonds')assert.deepEqual(r.variant.hand,Array(5).fill(VARIANT_GEMS[gem]));
  }
  assert.equal(gemWinChance(5),.0038423872);assert.equal(gemMultiplier(5),255.0497);
});

test('two Plinko paths and two Limbo tranches settle separately in exact units',()=>{
  for(const risk of ['low','medium','high'] as const){
    const table=plinkoTable(risk);let credit=0;
    for(let path=0;path<4096;path++){
      let draw=0;const result=startVariant('variant-plinko',{variant:{risk}},'1000',()=>path>>(draw++%12)&1);
      const bucket=Array.from({length:12},(_,i)=>path>>i&1).reduce((a,b)=>a+b,0);assert.equal(result.credit,2*variantPayout('500',table[bucket]));credit+=result.credit;
    }
    const expected=table.reduce((sum,m,bucket)=>{let comb=1;for(let i=1;i<=bucket;i++)comb=comb*(13-i)/i;return sum+m*comb/4096;},0);
    assert.equal(credit/(4096*1000),expected);
    assert(Math.max(...table)<=VARIANT_MAX['variant-plinko']);
  }
  const values=[0,Math.floor(2**32*.98/2),Math.floor(2**32*.98/1.2)];
  for(const target of [3,5,10] as const){
    assert.equal(startVariant('variant-limbo',{variant:{target}},'1000',()=>values[0]).credit,750+target*500);
    assert.equal(startVariant('variant-limbo',{variant:{target}},'1000',()=>values[1]).credit,750);
    assert.equal(startVariant('variant-limbo',{variant:{target}},'1000',()=>values[2]).credit,0);
  }
});

test('vault survival payout follows sampling without replacement and caps the sixth safe reveal',()=>{
  let survival=1;
  for(let opened=1;opened<=6;opened++){survival*=(14-opened)/(17-opened);lower(survival*vaultMultiplier(opened),.98);assert(vaultMultiplier(opened)<=VARIANT_MAX['variant-mines']);}
  let result=startVariant('variant-mines',{variant:{}},'1000',()=>0);assert.deepEqual(result.engine?.mines,[0,1,2]);assert.equal(result.ended,false);assert.deepEqual(result.variant.kind==='mines'?result.variant.cells:[],Array(16).fill('hidden'));
  assert.throws(()=>moveVariant('variant-mines',result.engine,'cashout',undefined,'1000'));
  for(let cell=3;cell<9;cell++){
    result=moveVariant('variant-mines',result.engine,'reveal',[cell],'1000');assert.equal(result.ended,cell===8);assert.equal(result.credit,cell===8?4573:0);
    if(cell<8)assert.throws(()=>moveVariant('variant-mines',result.engine,'reveal',[cell],'1000'));
  }
  assert.equal(result.variant.kind,'mines');if(result.variant.kind==='mines')assert.deepEqual(result.variant.opened,[3,4,5,6,7,8]);
  const mine=moveVariant('variant-mines',startVariant('variant-mines',{variant:{}},'1000',()=>0).engine,'reveal',[0],'1000');assert.equal(mine.credit,0);assert.equal(mine.ended,true);
});

test('variant requests reject extra settings, illegal moves and card-like selections on vault',()=>{
  for(const game of BASE_VARIANT_GAMES){assert(validExpansionAction(start(game)));assert(!validExpansionAction({...start(game),settings:{variant:{...(VARIANT_DEFAULTS[game].variant),payout:999999}}}));assert(!validExpansionAction({...start(game),payoutUnits:'100000'}));}
  for(const [game,settings] of [['variant-dice',{width:31}],['variant-plinko',{risk:'expert'}],['variant-limbo',{target:2}],['variant-sic-bo',{sum:2}],['variant-diamonds',{gem:6}],['variant-mines',{mines:[1,2,3]}]] as const)assert(!validExpansionAction(start(game,{variant:settings} as VariantSettings)));
  const s={id:randomUUID(),gameId:'variant-mines' as const};assert(validExpansionAction(move(s,'reveal',[15])));
  for(const op of [move(s,'reveal',[16]),move(s,'reveal',[]),move(s,'reveal',[1,2]),move(s,'cashout',[1]),move(s,'hold',[1]),move({id:s.id,gameId:'variant-dice'},'cashout')])assert(!validExpansionAction(op));
});

test('public result validation accepts every legal game and rejects leaked or mismatched boards',()=>{
  for(const game of BASE_VARIANT_GAMES){
    const result=startVariant(game,VARIANT_DEFAULTS[game],'1000',()=>0);
    assert(validVariantView(result.variant,game,result.ended));
    assert(!validVariantView({...result.variant,engine:{mines:[0,1,2]}},game,result.ended));
    assert(!validVariantView({...result.variant,kind:'unrecognized'},game,result.ended));
    if(game!=='variant-mines')assert(!validVariantView(result.variant,'variant-mines',true));
  }
  const vault=startVariant('variant-mines',{variant:{}},'1000',()=>0);
  if(vault.variant.kind!=='mines')throw Error('Unexpected vault view');
  assert(!validVariantView({...vault.variant,cells:['mine',...vault.variant.cells.slice(1)]},'variant-mines',false));
  const safe=moveVariant('variant-mines',vault.engine,'reveal',[3],'1000');assert(validVariantView(safe.variant,'variant-mines',false));
  assert(!validVariantView({...safe.variant,multiplier:0,cashoutUnits:'0'},'variant-mines',false));
  const stopped=moveVariant('variant-mines',safe.engine,'cashout',undefined,'1000');assert(validVariantView(stopped.variant,'variant-mines',true));
  const loss=moveVariant('variant-mines',safe.engine,'reveal',[0],'1000');assert(validVariantView(loss.variant,'variant-mines',true));
});

test('all six variants share a wallet, debit once and restore only public outcomes',async()=>{
  const {db,wallet,store}=await fixture();try{
    for(const gameId of BASE_VARIANT_GAMES){
      const op=start(gameId),before=await demoBalanceUnits(db,'alice'),r=await store.operate('alice',op);assert.equal(r.session.spentUnits,'1000');assert(r.session.view.variant);assert(!('engine' in r.session));assert(!('settings' in r.session));
      const replays=await Promise.all([store.operate('alice',op),store.operate('alice',op)]);assert(replays.every(x=>x.replayed));assert.equal(await demoBalanceUnits(db,'alice'),before-1000+Number(r.session.returnedUnits));
      const reopened=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{throw Error('Must not redraw');});assert.equal((await reopened.active('alice')).sessions.find(s=>s.id===op.id)?.id,op.id);
      await assert.rejects(store.operate('alice',{...op,stakeUnits:'5000'}),/изменить/);
      if(gameId==='variant-mines'){
        const s={id:r.session.id,gameId};assert.deepEqual(r.session.view.variant?.kind==='mines'?r.session.view.variant.cells:[],Array(16).fill('hidden'));
        await assert.rejects(reopened.operate('bob',move(s,'reveal',[3])),/найдена/);
        const safe=await reopened.operate('alice',move(s,'reveal',[3]));assert.equal(safe.session.state,'active');assert.equal(await demoReservedUnits(db,'alice'),5000);
        assert.equal(safe.session.view.variant?.kind==='mines'?safe.session.view.variant.cells.filter(c=>c==='hidden').length:0,15);
        await assert.rejects(reopened.operate('alice',move(s,'reveal',[3])),/закрытую/);
        const take=move(s,'cashout'),results=await Promise.all([reopened.operate('alice',take),reopened.operate('alice',take)]);
        assert.equal(results[0].session.returnedUnits,'1206');assert.equal(results[1].wallet.balance,results[0].wallet.balance);assert.equal(await demoReservedUnits(db,'alice'),0);
        await assert.rejects(reopened.operate('alice',move(s,'cashout')),/завершена/);
      }else assert.equal(r.session.state,'settled');
    }
    const ledger=await db.prepare("SELECT SUM(amount_units) AS total FROM demo_ledger WHERE account_id='alice'").get();assert.equal(Number(ledger!.total),await demoBalanceUnits(db,'alice'));
    const wins=await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='variant-mines' AND entry_type='win'").get();assert.equal(Number(wins!.n),1);
  }finally{await db.close();}
});

test('variant max payouts, shared reservation and failed persistence preserve wallet capacity',async()=>{
  const {db,wallet,store}=await fixture(()=>99);try{
    // A selected rare gem at its largest payout must fit even at the capacity boundary.
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-VARIANT_MAX['variant-diamonds']*1000+1000);
    const rare=await store.operate('alice',start('variant-diamonds',{variant:{gem:5}}));assert.equal(rare.session.returnedUnits,'255049');assert(rare.wallet.balance*100<=MAX_DEMO_UNITS);assert.equal(await demoReservedUnits(db,'alice'),0);
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-1000);await assert.rejects(store.operate('alice',start('variant-sic-bo',{variant:{sum:3}})),/лимит/);
    const vaultStore=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>0);
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-5000+1000);const vault=await vaultStore.operate('alice',start('variant-mines'));assert.equal(await demoReservedUnits(db,'alice'),5000);
    await assert.rejects(wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1}));
    const before=await demoBalanceUnits(db,'alice');await db.exec("CREATE FUNCTION reject_variant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted variant'; END $$;CREATE TRIGGER reject_variant BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_variant()");
    const s={id:vault.session.id,gameId:'variant-mines' as const};await assert.rejects(vaultStore.operate('alice',move(s,'reveal',[3])),/interrupted/);assert.equal(await demoBalanceUnits(db,'alice'),before);assert.equal((await vaultStore.active('alice')).sessions.find(x=>x.id===s.id)?.view.variant?.kind,'mines');
    const raw=await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get('alice',s.id);assert.deepEqual(JSON.parse(raw!.payload).engine.opened,[]);
    await db.exec('DROP TRIGGER reject_variant ON demo_casino_requests');await vaultStore.operate('alice',move(s,'reveal',[3]));
    await db.exec('CREATE TRIGGER reject_variant BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_variant()');await assert.rejects(vaultStore.operate('alice',move(s,'cashout')),/interrupted/);assert.equal(await demoBalanceUnits(db,'alice'),before);assert.equal(await demoReservedUnits(db,'alice'),5000);
    await db.exec('DROP TRIGGER reject_variant ON demo_casino_requests');const settled=await vaultStore.operate('alice',move(s,'cashout'));assert.equal(settled.session.returnedUnits,'1206');assert.equal(await demoReservedUnits(db,'alice'),0);
  }finally{await db.close();}
});

test('failed immediate variant credit rolls back the start, stake, payout and request',async()=>{
  const {db,store}=await fixture();try{
    const before=await demoBalanceUnits(db,'alice'),op=start('variant-sic-bo',{variant:{sum:3}});
    await db.exec("CREATE FUNCTION reject_variant_start() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted start'; END $$;CREATE TRIGGER reject_variant_start BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_variant_start()");
    await assert.rejects(store.operate('alice',op),/interrupted start/);assert.equal(await demoBalanceUnits(db,'alice'),before);assert.equal((await store.active('alice')).sessions.length,0);
    const ledger=await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='variant-sic-bo'").get();assert.equal(Number(ledger!.n),0);
    await db.exec('DROP TRIGGER reject_variant_start ON demo_casino_requests');const result=await store.operate('alice',op);assert.equal(result.session.returnedUnits,'211680');assert.equal(await demoBalanceUnits(db,'alice'),before-1000+211680);
    assert.equal((await store.operate('alice',op)).wallet.balance,result.wallet.balance);
  }finally{await db.close();}
});
