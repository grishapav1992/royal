import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  NEXT_VARIANT_GAMES, NEXT_VARIANT_DEFAULTS, NEXT_VARIANT_MAX, NEXT_CARD_LABELS, cardColor, colorMultiplier,
  combinations, kenoWinningCount, kenoMultiplier, kenoWinChance, keysMultiplier, duelMultiplier, duelWinningCount, duelWinChance, warMultiplier, splitStakeUnits,
  type ColorHistory, type DuelBand, type NextVariantGameId, type NextVariantSettings,
} from '../src/shared/casinoNextVariants';
import { BASE_VARIANT_GAMES, VARIANT_GAMES, validVariantView } from '../src/shared/casinoVariants';
import { validExpansionAction, type ExpansionAction } from '../src/shared/casinoExpansion';
import { startVariant, moveVariant, variantPayout } from '../server/games/casinoVariants';
import { startNextVariant, moveNextVariant } from '../server/games/casinoNextVariants';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';

const start=(gameId:NextVariantGameId,settings=NEXT_VARIANT_DEFAULTS[gameId]):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:structuredClone(settings)});
const move=(session:{id:string;gameId:NextVariantGameId},name:string,picks?:number[]):ExpansionAction=>({id:randomUUID(),gameId:session.gameId,action:'move',sessionId:session.id,move:name,...(picks===undefined?{}:{picks})});
async function fixture(draw:(max:number)=>number=()=>0){const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");const wallet=new DemoWalletStore(db,draw);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:100000});const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},draw);return {db,wallet,store};}
const bounded=(actual:number,target:number,tolerance=.00011)=>{assert(actual<=target+1e-12);assert(actual>=target-tolerance,`${actual} < ${target}`);};
function poolDraw(ids:number[],size:number):(max:number)=>number {const pool=Array.from({length:size},(_,i)=>i),values=[...ids];return max=>{assert.equal(max,pool.length);const index=pool.indexOf(values.shift()!);assert(index>=0);pool.splice(index,1);return index;};}

test('Keno enumerates all mini-tickets and both hypergeometric thresholds exactly',()=>{
  const counts=[0n,0n],numbers=[1,2,3,4,5];let total=0;
  for(let a=0;a<16;a++)for(let b=a+1;b<17;b++)for(let c=b+1;c<18;c++)for(let d=c+1;d<19;d++)for(let e=d+1;e<20;e++){
    total++;for(const target of [2,3] as const){const result=startNextVariant('variant-keno',{variant:{numbers,target}},'10000',poolDraw([a,b,c,d,e],20));assert.equal(result.variant.kind,'keno');if(result.variant.kind!=='keno')throw Error('Wrong view');if(result.variant.won)counts[target-2]++;assert.equal(new Set(result.variant.drawn).size,5);assert.equal(result.credit,result.variant.won?variantPayout('10000',kenoMultiplier(target)):0);}
  }
  assert.equal(total,Number(combinations(20,5)));for(const target of [2,3] as const){assert.equal(counts[target-2],kenoWinningCount(target));bounded(kenoWinChance(target)*kenoMultiplier(target),.98);assert(kenoMultiplier(target)<=NEXT_VARIANT_MAX['variant-keno']);}
});

test('all ordered Dragon pairs occupy one exact gap band and match its gross payout',()=>{
  const bands:DuelBand[]=['tie','near','middle','far'],counts=Object.fromEntries(bands.map(b=>[b,0])) as Record<DuelBand,number>;
  for(let a=0;a<52;a++)for(let b=0;b<52;b++)if(a!==b){
    let wonBands=0;for(const band of bands){const result=startNextVariant('variant-duel',{variant:{band}},'10000',poolDraw([a,b],52));if(result.variant.kind!=='duel')throw Error('Wrong view');assert.notEqual(result.variant.dragon,result.variant.tiger);assert(validVariantView(result.variant,'variant-duel',true));if(result.variant.won){counts[band]++;wonBands++;}assert.equal(result.credit,result.variant.won?variantPayout('10000',duelMultiplier(band)):0);}
    assert.equal(wonBands,1);
  }
  for(const band of bands){assert.equal(counts[band],duelWinningCount(band));bounded(duelWinChance(band)*duelMultiplier(band),.98);assert(duelMultiplier(band)<=NEXT_VARIANT_MAX['variant-duel']);}
  assert.equal(counts.tie,156);assert.equal(duelMultiplier('tie'),16.66);
});

test('War fronts use independent decks, Ace high and exact half-stake settlement',()=>{
  const counts={win:0,tie:0,loss:0};
  for(let a=0;a<52;a++)for(let b=0;b<52;b++)if(a!==b){
    for(const mode of ['shield','attack'] as const){let pair=0,draw=poolDraw([a,b],52);const result=startNextVariant('variant-war',{variant:{mode}},'1001',max=>{if(pair++===2)draw=poolDraw([a,b],52);return draw(max);});if(result.variant.kind!=='war')throw Error('Wrong view');assert(validVariantView(result.variant,'variant-war',true));const [first,second]=result.variant.fronts;assert.deepEqual([first.player,first.dealer],[second.player,second.dealer]);assert.equal(first.stakeUnits,'501');assert.equal(second.stakeUnits,'500');assert.equal(first.multiplier,warMultiplier(mode,first.result));assert.equal(result.credit,variantPayout('501',first.multiplier)+variantPayout('500',second.multiplier));if(mode==='shield')counts[first.result]++;}
  }
  assert.deepEqual(counts,{win:1248,tie:156,loss:1248});for(const mode of ['shield','attack'] as const)bounded((counts.win*warMultiplier(mode,'win')+counts.tie*warMultiplier(mode,'tie'))/2652,.98);
  let draws=0;const ace=startNextVariant('variant-war',{variant:{mode:'shield'}},'1000',max=>draws++%2===0?0:11);if(ace.variant.kind!=='war')throw Error('Wrong view');assert.equal(ace.variant.fronts[0].result,'win');
});

test('Fruits retains classic weights, all winning lines and every cent of the stake',()=>{
  assert.deepEqual(splitStakeUnits('1000',3),['334','333','333']);assert.deepEqual(splitStakeUnits('1001',2),['501','500']);
  let sum=0;for(let a=0;a<20;a++)for(let b=0;b<20;b++)for(let c=0;c<20;c++){
    const values=[a,b,c,a,b,c,a,b,c],result=startNextVariant('variant-fruits',{variant:{lines:3}},'1000',()=>values.shift()!);if(result.variant.kind!=='fruits')throw Error('Wrong view');assert.equal(result.variant.rows.reduce((s,r)=>s+Number(r.stakeUnits),0),1000);assert(validVariantView(result.variant,'variant-fruits',true));sum+=result.credit;
  }
  assert.equal(sum/(8000*1000),.97);
  for(const lines of [2,3] as const){const maximum=startNextVariant('variant-fruits',{variant:{lines}},'1001',()=>19);assert.equal(maximum.credit,1001*140);if(maximum.variant.kind!=='fruits')throw Error('Wrong view');assert.equal(maximum.variant.rows.length,lines);}
});

test('Color depletes one committed deck, uses conditional probabilities and caps six wins',()=>{
  let result=startNextVariant('variant-color',{variant:{}},'1000',()=>0);assert.equal(result.variant.kind,'color');if(result.variant.kind!=='color')throw Error('Wrong view');assert.equal(result.variant.history.length,0);assert.equal(result.variant.redRemaining,26);assert.equal(result.variant.blackRemaining,26);assert.throws(()=>moveNextVariant('variant-color',result.engine,'cashout',undefined,'1000'));
  for(let step=1;step<=6;step++){
    result=moveNextVariant('variant-color',result.engine,'black',undefined,'1000');assert.equal(result.ended,step===6);if(result.variant.kind!=='color')throw Error('Wrong view');assert.equal(result.variant.steps,step);assert.equal(result.variant.blackRemaining,26-step);assert.equal(result.variant.redRemaining,26);assert(validVariantView(result.variant,'variant-color',result.ended));assert.equal(result.credit,step===6?Number(result.variant.cashoutUnits):0);assert(result.variant.multiplier<=NEXT_VARIANT_MAX['variant-color']);
  }
  let expected=1;for(let step=0;step<6;step++)expected*=(26-step)/(52-step);if(result.variant.kind!=='color')throw Error('Wrong view');bounded(expected*result.variant.multiplier,.98);
  const first=moveNextVariant('variant-color',startNextVariant('variant-color',{variant:{}},'1000',()=>0).engine,'red',undefined,'1000');assert.equal(first.ended,true);assert.equal(first.credit,0);assert(validVariantView(first.variant,'variant-color',true));
  for(let sequence=0;sequence<64;sequence++){const history:ColorHistory=[];let probability=1,red=26,black=26;for(let step=0;step<6;step++){const color=sequence>>step&1?'red':'black';probability*=(color==='red'?red:black)/(red+black);if(color==='red')red--;else black--;history.push({card:NEXT_CARD_LABELS[step],prediction:color,color,won:true});bounded(probability*colorMultiplier(history),.98);assert(colorMultiplier(history)<=NEXT_VARIANT_MAX['variant-color']);}}
});

test('Keys chooses two cells at once, hides future traps and settles every terminal path',()=>{
  let successes=0;for(let trap=0;trap<4;trap++)for(let a=0;a<3;a++)for(let b=a+1;b<4;b++){
    const initial=startNextVariant('variant-keys',{variant:{}},'1000',()=>trap),result=moveNextVariant('variant-keys',initial.engine,'unlock',[a,b],'1000');if(result.variant.kind!=='keys')throw Error('Wrong view');assert(validVariantView(result.variant,'variant-keys',result.ended));if(!result.ended){successes++;assert.equal(result.variant.rows[0].filter(c=>c==='safe').length,2);assert.deepEqual(result.variant.rows.slice(1),Array.from({length:5},()=>Array(4).fill('hidden')));const paid=moveNextVariant('variant-keys',result.engine,'cashout',undefined,'1000');assert.equal(paid.credit,1960);assert(validVariantView(paid.variant,'variant-keys',true));}else{assert.equal(result.credit,0);assert.equal(result.variant.multiplier,0);}
  }
  assert.equal(successes,12);assert.equal(successes/24,.5);
  let result=startNextVariant('variant-keys',{variant:{}},'1000',()=>0);for(let step=1;step<=6;step++){result=moveNextVariant('variant-keys',result.engine,'unlock',[1,2],'1000');assert.equal(result.ended,step===6);assert(validVariantView(result.variant,'variant-keys',result.ended));if(result.variant.kind!=='keys')throw Error('Wrong view');assert.equal(result.variant.steps,step);assert.equal(result.variant.multiplier,keysMultiplier(step));bounded(.5**step*result.variant.multiplier,.98);assert.equal(result.credit,step===6?62720:0);}
});

test('all twelve variants validate strict settings, moves and public views',()=>{
  assert.equal(VARIANT_GAMES.length,18);assert.equal(BASE_VARIANT_GAMES.length,6);
  for(const game of NEXT_VARIANT_GAMES){const op=start(game);assert(validExpansionAction(op));assert(!validExpansionAction({...op,payoutUnits:'100000'}));assert(!validExpansionAction({...op,settings:{variant:{...op.settings.variant,deck:[1,2]}}}));const result=startVariant(game,NEXT_VARIANT_DEFAULTS[game],'1000',()=>0);assert(validVariantView(result.variant,game,result.ended));assert(!validVariantView({...result.variant,engine:{}},game,result.ended));assert(!validVariantView({...result.variant,kind:'unknown'},game,result.ended));}
  for(const settings of [{numbers:[1,1,2,3,4],target:2},{numbers:[0,2,3,4,5],target:2},{numbers:[1,2,3,4,21],target:2},{numbers:[1,2,3,4,5],target:4},{numbers:[1,2,3,4],target:2}])assert(!validExpansionAction(start('variant-keno',{variant:settings} as NextVariantSettings)));
  const color={id:randomUUID(),gameId:'variant-color' as const},keys={id:randomUUID(),gameId:'variant-keys' as const};for(const name of ['red','black','cashout'])assert(validExpansionAction(move(color,name)));assert(validExpansionAction(move(keys,'unlock',[0,3])));assert(validExpansionAction(move(keys,'cashout')));
  for(const op of [move(color,'red',[]),move(color,'unlock',[0,1]),move(keys,'unlock',[0]),move(keys,'unlock',[1,1]),move(keys,'unlock',[0,4]),move(keys,'cashout',[]),move({id:keys.id,gameId:'variant-war'},'red'),{...move(keys,'unlock',[0,1]),trap:3}])assert(!validExpansionAction(op));
  const c=startNextVariant('variant-color',{variant:{}},'1000',()=>0);if(c.variant.kind!=='color')throw Error('Wrong view');assert(!validVariantView({...c.variant,deck:[0,1,2]},'variant-color',false));assert(!validVariantView({...c.variant,redRemaining:25},'variant-color',false));const k=startNextVariant('variant-keys',{variant:{}},'1000',()=>0);if(k.variant.kind!=='keys')throw Error('Wrong view');assert(!validVariantView({...k.variant,rows:[['trap','hidden','hidden','hidden'],...k.variant.rows.slice(1)]},'variant-keys',false));
});

test('next variants debit once, share wallet and restore the exact committed game after restart',async()=>{
  const {db,wallet,store}=await fixture();try{
    for(const gameId of NEXT_VARIANT_GAMES){
      const op=start(gameId),before=await demoBalanceUnits(db,'alice'),result=await store.operate('alice',op);assert.equal(result.session.spentUnits,'1000');assert(validVariantView(result.session.view.variant,gameId,result.session.state==='settled'));assert(!('engine' in result.session));assert(!('settings' in result.session));assert(!('createdAt' in result.session));
      const replays=await Promise.all([store.operate('alice',op),store.operate('alice',op)]);assert(replays.every(r=>r.replayed));assert.equal(await demoBalanceUnits(db,'alice'),before-1000+Number(result.session.returnedUnits));await assert.rejects(store.operate('alice',{...op,stakeUnits:'5000'}),/изменить/);
      const reopened=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{throw Error('Must not redraw');}),recovered=(await reopened.active('alice')).sessions.find(s=>s.id===op.id);assert.deepEqual(recovered,result.session);
      if(gameId==='variant-color'||gameId==='variant-keys'){
        assert.equal(result.session.state,'active');assert.equal(await demoReservedUnits(db,'alice'),NEXT_VARIANT_MAX[gameId]*1000);const session={id:result.session.id,gameId},name=gameId==='variant-color'?'black':'unlock',picks=gameId==='variant-keys'?[1,2]:undefined;
        await assert.rejects(reopened.operate('bob',move(session,name,picks)),/найдена/);await assert.rejects(reopened.operate('alice',move(session,'cashout')),/недоступен/);const opMove=move(session,name,picks),first=await reopened.operate('alice',opMove);assert.equal(first.session.state,'active');assert.equal(first.session.view.variant?.kind,gameId==='variant-color'?'color':'keys');assert.equal(first.session.view.phase,2);assert.equal(first.session.spentUnits,'1000');assert.equal(first.session.returnedUnits,'0');assert.equal((await reopened.operate('alice',opMove)).replayed,true);
        if(gameId==='variant-color'){assert.deepEqual(first.session.view.actions.map(a=>a.move),['red','black','cashout']);assert.equal(JSON.stringify(first.session).includes('deck'),false);}else assert.deepEqual(first.session.view.actions.map(a=>a.move),['unlock','cashout']);
        const take=move(session,'cashout'),settled=await Promise.all([reopened.operate('alice',take),reopened.operate('alice',take)]);assert.equal(settled[0].session.returnedUnits,'1960');assert.equal(settled[1].wallet.balance,settled[0].wallet.balance);assert.equal(await demoReservedUnits(db,'alice'),0);await assert.rejects(reopened.operate('alice',move(session,name,picks)),/завершена/);
      }else assert.equal(result.session.state,'settled');
    }
    const ledger=await db.prepare("SELECT SUM(amount_units) AS total FROM demo_ledger WHERE account_id='alice'").get();assert.equal(Number(ledger!.total),await demoBalanceUnits(db,'alice'));for(const game of ['variant-color','variant-keys']){const row=await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source=? AND entry_type='win'").get(game);assert.equal(Number(row!.n),1);}
  }finally{await db.close();}
});

test('capacity reservations precede draws and survive failed move persistence without double credit',async()=>{
  const {db,wallet}=await fixture();try{
    let draws=0;const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{draws++;return 0;});await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-1000);for(const game of NEXT_VARIANT_GAMES)await assert.rejects(store.operate('alice',start(game)),/лимит/);assert.equal(draws,0);
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-87000+1000);const initial=await store.operate('alice',start('variant-color'));assert.equal(await demoReservedUnits(db,'alice'),87000);await assert.rejects(wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1}));const session={id:initial.session.id,gameId:'variant-color' as const},before=await demoBalanceUnits(db,'alice');
    await db.exec("CREATE FUNCTION reject_next_variant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted next variant'; END $$;CREATE TRIGGER reject_next_variant BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_next_variant()");
    const guess=move(session,'black');await assert.rejects(store.operate('alice',guess),/interrupted next variant/);assert.equal(await demoBalanceUnits(db,'alice'),before);const raw=await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get('alice',session.id);assert.deepEqual(JSON.parse(raw!.payload).engine.history,[]);
    await db.exec('DROP TRIGGER reject_next_variant ON demo_casino_requests');await store.operate('alice',guess);await db.exec('CREATE TRIGGER reject_next_variant BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_next_variant()');const take=move(session,'cashout');await assert.rejects(store.operate('alice',take),/interrupted next variant/);assert.equal(await demoBalanceUnits(db,'alice'),before);assert.equal(await demoReservedUnits(db,'alice'),87000);
    await db.exec('DROP TRIGGER reject_next_variant ON demo_casino_requests');const paid=await store.operate('alice',take);assert.equal(paid.session.returnedUnits,'1960');assert.equal(await demoReservedUnits(db,'alice'),0);assert.equal(await demoBalanceUnits(db,'alice'),before+1960);assert.equal((await store.operate('alice',take)).wallet.balance,paid.wallet.balance);
  }finally{await db.close();}
});

test('failed immediate next-variant settlement atomically rolls back stake, game and payout',async()=>{
  const {db,store}=await fixture();try{const before=await demoBalanceUnits(db,'alice'),op=start('variant-fruits');await db.exec("CREATE FUNCTION reject_next_start() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted next start'; END $$;CREATE TRIGGER reject_next_start BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_next_start()");await assert.rejects(store.operate('alice',op),/interrupted next start/);assert.equal(await demoBalanceUnits(db,'alice'),before);assert.equal((await store.active('alice')).sessions.length,0);const count=await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='variant-fruits'").get();assert.equal(Number(count!.n),0);await db.exec('DROP TRIGGER reject_next_start ON demo_casino_requests');const result=await store.operate('alice',op);assert.equal(result.session.returnedUnits,'5000');assert.equal(await demoBalanceUnits(db,'alice'),before+4000);assert.equal((await store.operate('alice',op)).wallet.balance,result.wallet.balance);}finally{await db.close();}
});

test('sixth Color and Keys moves pay automatically once and loss releases every reservation',async()=>{
  const {db,store}=await fixture();try{
    for(const gameId of ['variant-color','variant-keys'] as const){
      const initial=await store.operate('alice',start(gameId)),session={id:initial.session.id,gameId};let last=initial;
      for(let step=1;step<=6;step++){const op=move(session,gameId==='variant-color'?'black':'unlock',gameId==='variant-keys'?[1,2]:undefined);last=await store.operate('alice',op);assert.equal(last.session.state,step===6?'settled':'active');assert.equal(last.session.view.actions.length,step===6?0:3-(gameId==='variant-keys'?1:0));if(step===6){assert.equal((await store.operate('alice',op)).session.returnedUnits,last.session.returnedUnits);assert.equal(await demoReservedUnits(db,'alice'),0);}}
      assert.equal(last.session.returnedUnits,gameId==='variant-color'?'86658':'62720');await assert.rejects(store.operate('alice',move(session,'cashout')),/завершена/);
      const next=await store.operate('alice',start(gameId)),losing=move({id:next.session.id,gameId},gameId==='variant-color'?'red':'unlock',gameId==='variant-keys'?[0,1]:undefined),before=await demoBalanceUnits(db,'alice'),lost=await store.operate('alice',losing);assert.equal(lost.session.state,'settled');assert.equal(lost.session.returnedUnits,'0');assert.equal(lost.session.view.actions.length,0);assert.equal(await demoReservedUnits(db,'alice'),0);assert.equal(await demoBalanceUnits(db,'alice'),before);assert(validVariantView(lost.session.view.variant,gameId,true));assert.equal((await store.operate('alice',losing)).replayed,true);
    }
  }finally{await db.close();}
});

test('invalid committed boards and illegal active moves never create a payout',()=>{
  const color=startNextVariant('variant-color',{variant:{}},'1000',()=>0);assert(color.engine?.kind==='color');if(color.engine?.kind!=='color')throw Error('Wrong engine');
  assert.throws(()=>moveNextVariant('variant-color',{...color.engine,deck:Array(52).fill(0)},'black',undefined,'1000'),/private color/);assert.throws(()=>moveNextVariant('variant-color',{...color.engine,history:[{card:'A♥',color:'red',prediction:'red',won:true}]},'black',undefined,'1000'),/private color/);assert.throws(()=>moveNextVariant('variant-color',color.engine,'red',[0],'1000'));
  const keys=startNextVariant('variant-keys',{variant:{}},'1000',()=>0);assert(keys.engine?.kind==='keys');if(keys.engine?.kind!=='keys')throw Error('Wrong engine');for(const picks of [[0],[0,0],[0,4],[-1,2]])assert.throws(()=>moveNextVariant('variant-keys',keys.engine,'unlock',picks,'1000'));assert.throws(()=>moveNextVariant('variant-keys',{...keys.engine,picks:[[0,1]]},'cashout',undefined,'1000'),/private keys/);assert.throws(()=>moveVariant('variant-keys',keys.engine,'cashout',undefined,'1000'));
  assert.deepEqual(keys.engine.picks,[]);assert.deepEqual(color.engine.history,[]);
});
