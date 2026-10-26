import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {block} from './helpers/nile-play-fixture';
import {NileGameRuntime, type NativeCommand} from '../../server/finance/nile-game-runtime';
import {startLuelonSlotGame} from '../../server/games/luelonSlots';
import {startCaramel} from '../../server/games/caramelCarnival';
import {startConvoy} from '../../server/games/lastConvoy';
import {startNitro} from '../../server/games/nitroRun';
import {startAfter} from '../../server/games/afterglow';
import {startDracona} from '../../server/games/dracona';
import {seededRandom} from '../../src/shared/draconaMath';
import {LUELON_SLOT_INFO} from '../../src/shared/luelonSlotsModels';
import {PostgresDatabase} from '../../server/database';
import {DemoWalletStore} from '../../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits} from '../../server/demoWalletAmounts';

type Draw = (max:number)=>number;
type Scenario = {gameId:string; mode:string; stake:string; cost:number; view:string; settings:any; start:(draw:Draw)=>{ended:boolean}};
const scenarios:Scenario[] = [];
for(const [gameId, modes] of Object.entries({
 'studio-cosmic-escape': {normal:1,'cosmic-chaos':40,'ufo-invasion':75,'deep-echo':135},
 'studio-velvet-reign': {normal:1,booster:2,hyper:10,spotlight:100,'super-encore':300},
})) for(const [mode,cost] of Object.entries(modes)) {
 const settings={luelon:{mode}}, stake='20';
 scenarios.push({gameId,mode,stake,cost,view:'luelon',settings,start:draw=>startLuelonSlotGame(gameId as any,settings,stake,draw)});
}
for(const [mode,cost] of Object.entries({normal:1,festival:35})) {
 const settings={caramel:{mode:mode as 'normal'|'festival'}};
 scenarios.push({gameId:'studio-caramel-carnival',mode,stake:'100',cost,view:'caramel',settings,start:draw=>startCaramel(settings,'100',draw)});
}
scenarios.push(
 {gameId:'studio-last-convoy',mode:'normal',stake:'100',cost:1,view:'convoy',settings:{convoy:{mode:'normal'}},start:draw=>startConvoy({convoy:{mode:'normal'}},'100',draw)},
 ...['studio-nitro-run','studio-meme-overload'].map(gameId=>({gameId,mode:'normal',stake:'100',cost:1,view:'nitro',settings:{nitro:{mode:'normal'}},start:(draw:Draw)=>startNitro({nitro:{mode:'normal'}},'100',draw)})),
 {gameId:'studio-afterglow',mode:'normal',stake:'100',cost:1,view:'afterglow',settings:{afterglow:{mode:'normal'}},start:draw=>startAfter({afterglow:{mode:'normal'}},'100',0,draw)},
 {gameId:'studio-dracona',mode:'normal',stake:'1000',cost:1,view:'dracona',settings:{dracona:{mode:'normal'}},start:draw=>startDracona({dracona:{mode:'normal'}},'1000',draw)},
);
const command=(body:unknown=null):NativeCommand=>({path:'/expansion',body,method:body===null?'GET':'POST',query:{},flags:[true,true,true,true,true,true,true,true,2],rules:2,neopolisRules:3});
const seededDraw=(seed:number)=>{const random=seededRandom(seed);return (max:number)=>Math.floor(random()*max);};
function bonusSeed(spec:Scenario) {
 // Construct coverage with real engine outcomes; this search does not estimate their frequency.
 for(let seed=1;seed<=20000;seed++) if(!spec.start(seededDraw(seed)).ended)return seed;
 throw Error('No constructed bonus seed: '+spec.gameId+'/'+spec.mode);
}

for(const spec of scenarios)test(`${spec.gameId}/${spec.mode}: common USDT charges full cost once and settles a recovered complete bonus once`, async t=>{
 const seed=bonusSeed(spec);t.diagnostic('Constructed bonus seed '+seed);
 if(spec.view==='luelon')assert.equal(LUELON_SLOT_INFO[spec.gameId as keyof typeof LUELON_SLOT_INFO]!.modes.find(m=>m.id===spec.mode)!.cost,spec.cost);
 const c=await pvpFixture();
 try {
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));
  await c.ledger.sync(c.source,await c.reconciliation());
  // Preserve a fraction smaller than the engines' cent unit through every debit and credit.
  const matchId=randomUUID();
  for(const account of [c.a,c.b])await c.ledger.pvpHold(account,{matchId,gameId:'durak',stakeUnits:'1010000'});
  await c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'});
  const initial=BigInt((await c.ledger.wallet(c.a) as any).balanceUnits), draw=seededDraw(seed);
  let draws=0; const counted=(max:number)=>{draws++;return draw(max);};
  let games=new NileGameRuntime(c.ledger,counted);
  const start={id:randomUUID(),action:'start',gameId:spec.gameId,stakeUnits:spec.stake,settings:spec.settings};
  let reply:any=await games.run(c.a,command(start));
  const spent=BigInt(spec.stake)*BigInt(spec.cost), heldBalance=initial-spent*10000n;
  assert.equal(reply.session.state,'active');assert.equal(reply.session.spentUnits,String(spent));
  assert.equal(reply.session.returnedUnits,'0');assert.equal(reply.wallet.balanceUnits,String(heldBalance));
  const startDraws=draws;
  const starts=await Promise.all([games.run(c.a,command(start)),games.run(c.a,command(start))]) as any[];
  assert(starts.every(r=>r.replayed&&r.wallet.balanceUnits===String(heldBalance)));assert.equal(draws,startDraws);
  await assert.rejects(games.run(c.a,command({...start,stakeUnits:String(Number(spec.stake)*2)})));
  await assert.rejects(games.run(c.a,command({...start,settings:{...spec.settings,paidCost:0}})));
  if(spec.view==='luelon') {
   const alternate=LUELON_SLOT_INFO[spec.gameId as keyof typeof LUELON_SLOT_INFO]!.modes.find(mode=>mode.id!==spec.mode)!.id;
   await assert.rejects(games.run(c.a,command({...start,settings:{luelon:{mode:alternate}}})));
  }
  if(spec.view==='caramel')await assert.rejects(games.run(c.a,command({...start,settings:{caramel:{mode:spec.mode==='normal'?'festival':'normal'}}})));
  await assert.rejects(games.run(c.a,command({...start,id:randomUUID()})));
  assert.equal(draws,startDraws);
  games=new NileGameRuntime(c.ledger,counted);
  const recovered=await games.run(c.a,command()) as any;
  assert.deepEqual(recovered.sessions.find((s:any)=>s.id===start.id),reply.session);
  let last:any=start, moves=0;
  while(reply.session.state==='active') {
   const session=reply.session, action=session.view.actions[0], revision=session.view[spec.view].revision;
   assert.equal(action.cost,0);assert.equal(session.spentUnits,String(spent));assert.equal(session.returnedUnits,'0');
   last={id:randomUUID(),action:'move',gameId:spec.gameId,sessionId:start.id,move:action.move,revision};
   if(action.move==='luelon-pick')last.picks=[0];
   const before=draws;
   await assert.rejects(games.run(c.a,command({...last,stakeUnits:'100000'})));
   await assert.rejects(games.run(c.a,command({...last,settings:{luelon:{mode:'super-encore'}}})));
   assert.equal(draws,before);
   const duplicate=await Promise.all([games.run(c.a,command(last)),games.run(c.a,command(last))]) as any[];
   assert(duplicate.some(r=>r.replayed));assert.deepEqual(duplicate[0].session,duplicate[1].session);
   reply=duplicate[0];moves++;assert(moves<=256);
   if(reply.session.state==='active') {
    assert.equal(reply.wallet.balanceUnits,String(heldBalance));
    const after=draws;
    await assert.rejects(games.run(c.a,command({...last,id:randomUUID()})));
    assert.equal(draws,after);
   }
  }
  assert(moves>0);assert.equal(reply.session.spentUnits,String(spent));
  const final=heldBalance+BigInt(reply.session.returnedUnits)*10000n;
  assert.equal(reply.wallet.balanceUnits,String(final));assert.equal(reply.wallet.reservedUnits,'0');
  const settledDraws=draws, repeated=await games.run(c.a,command(last)) as any;
  assert(repeated.replayed);assert.equal(repeated.wallet.balanceUnits,String(final));assert.equal(draws,settledDraws);
  await assert.rejects(games.run(c.a,command({...last,id:randomUUID()})));
  assert.equal((await c.ledger.wallet(c.a) as any).balanceUnits,String(final));
  const debits=await c.ledger.db.prepare("SELECT count(*) AS n,sum(-amount_units) AS units FROM demo_ledger WHERE account_id=? AND source=? AND entry_type='bet'").get(c.a,spec.gameId);
  const credits=await c.ledger.db.prepare("SELECT count(*) AS n,sum(amount_units) AS units FROM demo_ledger WHERE account_id=? AND source=? AND entry_type='win'").get(c.a,spec.gameId);
  assert.equal(Number(debits!.n),1);assert.equal(String(debits!.units),String(spent));
  assert.equal(Number(credits!.n),1);assert.equal(String(credits!.units),reply.session.returnedUnits);
  assert.equal(final%10000n,initial%10000n);await c.ledger.audit();
 } finally {await c.close();}
});

for(const [gameId,settings,cost] of [
 ['studio-velvet-reign',{luelon:{mode:'spotlight'}},100],
 ['studio-velvet-reign',{luelon:{mode:'super-encore'}},300],
 ['studio-cosmic-escape',{luelon:{mode:'deep-echo'}},135],
 ['studio-caramel-carnival',{caramel:{mode:'festival'}},35],
] as const)test(`${gameId}/${Object.values(settings)[0].mode}: enough for base stake cannot fund the full purchased bonus`,async()=>{
 const c=await pvpFixture();let draws=0;
 try {
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));
  await c.ledger.sync(c.source,await c.reconciliation());
  const games=new NileGameRuntime(c.ledger,()=>{draws++;return 0;}),op={id:randomUUID(),action:'start',gameId,stakeUnits:'1000',settings};
  assert(10<=200&&10*cost>200);
  await assert.rejects(games.run(c.a,command(op)),/Недостаточно.*начальных ставок/);
  assert.equal(draws,0);assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');
  assert.equal(await c.ledger.db.prepare('SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND id=?').get(c.a,op.id),undefined);
  await c.ledger.audit();
 } finally {await c.close();}
});

for(const spec of scenarios)test(`${spec.gameId}/${spec.mode}: deployed demo-wallet engine charges full cost and settles a recovered bonus once`,async t=>{
 const seed=bonusSeed(spec);t.diagnostic('Constructed bonus seed '+seed);
 const db=new PostgresDatabase(':memory:');
 try {
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('bonus-audit'),('other-player')");
  let draws=0;const draw=seededDraw(seed),counted=(max:number)=>{draws++;return draw(max);};
  let wallet=new DemoWalletStore(db,counted);
  await wallet.operate('bonus-audit',{id:randomUUID(),kind:'deposit',amount:200});
  const initial=await demoBalanceUnits(db,'bonus-audit'),spent=Number(spec.stake)*spec.cost;
  const start={id:randomUUID(),action:'start',gameId:spec.gameId,stakeUnits:spec.stake,settings:spec.settings};
  let reply:any=await wallet.expansion.operate('bonus-audit',start);
  assert.equal(reply.session.state,'active');assert.equal(reply.session.spentUnits,String(spent));
  assert.equal(reply.session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,'bonus-audit'),initial-spent);
  const firstDraws=draws;
  const starts=await Promise.all([wallet.expansion.operate('bonus-audit',start),wallet.expansion.operate('bonus-audit',start)]);
  assert(starts.every(r=>r.replayed));assert.equal(draws,firstDraws);
  await assert.rejects(wallet.expansion.operate('bonus-audit',{...start,stakeUnits:String(Number(spec.stake)*2)}));
  await assert.rejects(wallet.expansion.operate('bonus-audit',{...start,id:randomUUID()}));
  if(spec.view==='luelon') {
   const alternate=LUELON_SLOT_INFO[spec.gameId as keyof typeof LUELON_SLOT_INFO]!.modes.find(mode=>mode.id!==spec.mode)!.id;
   await assert.rejects(wallet.expansion.operate('bonus-audit',{...start,settings:{luelon:{mode:alternate}}}));
  }
  if(spec.view==='caramel')await assert.rejects(wallet.expansion.operate('bonus-audit',{...start,settings:{caramel:{mode:spec.mode==='normal'?'festival':'normal'}}}));
  assert.equal(draws,firstDraws);
  wallet=new DemoWalletStore(db,counted);
  const recovered=await wallet.expansion.active('bonus-audit');
  assert.deepEqual(recovered.sessions.find(s=>s.id===start.id),reply.session);
  let last:any=start,moves=0;
  while(reply.session.state==='active') {
   const session=reply.session,action=session.view.actions[0];assert.equal(action.cost,0);
   last={id:randomUUID(),action:'move',gameId:spec.gameId,sessionId:start.id,move:action.move,revision:session.view[spec.view].revision};
   if(action.move==='luelon-pick')last.picks=[0];
   const before=draws;
   await assert.rejects(wallet.expansion.operate('bonus-audit',{...last,stakeUnits:'100000'}));
   await assert.rejects(wallet.expansion.operate('bonus-audit',{...last,settings:{luelon:{mode:'super-encore'}}}));
   await assert.rejects(wallet.expansion.operate('other-player',last));assert.equal(draws,before);
   const replies=await Promise.all([wallet.expansion.operate('bonus-audit',last),wallet.expansion.operate('bonus-audit',last)]);
   assert(replies.some(r=>r.replayed));assert.deepEqual(replies[0].session,replies[1].session);
   reply=replies[0];moves++;assert(moves<=256);assert.equal(reply.session.spentUnits,String(spent));
   if(reply.session.state==='active') {
    assert.equal(reply.session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,'bonus-audit'),initial-spent);
    const after=draws;await assert.rejects(wallet.expansion.operate('bonus-audit',{...last,id:randomUUID()}));assert.equal(draws,after);
   }
  }
  assert(moves>0);const final=initial-spent+Number(reply.session.returnedUnits);
  assert.equal(await demoBalanceUnits(db,'bonus-audit'),final);assert.equal(reply.wallet.balance,final/100);
  assert.equal(await demoReservedUnits(db,'bonus-audit'),0);
  const settledDraws=draws;
  assert((await wallet.expansion.operate('bonus-audit',last)).replayed);
  await assert.rejects(wallet.expansion.operate('bonus-audit',{...last,id:randomUUID()}));assert.equal(draws,settledDraws);
  assert.equal(await demoBalanceUnits(db,'bonus-audit'),final);
  const debits=await db.prepare("SELECT count(*) AS n,sum(-amount_units) AS units FROM demo_ledger WHERE account_id=? AND source=? AND entry_type='bet'").get('bonus-audit',spec.gameId);
  const credits=await db.prepare("SELECT count(*) AS n,sum(amount_units) AS units FROM demo_ledger WHERE account_id=? AND source=? AND entry_type='win'").get('bonus-audit',spec.gameId);
  assert.equal(Number(debits!.n),1);assert.equal(String(debits!.units),String(spent));
  assert.equal(Number(credits!.n),1);assert.equal(String(credits!.units),reply.session.returnedUnits);
 } finally {await db.close();}
});

for(const [gameId,settings,cost] of [
 ['studio-velvet-reign',{luelon:{mode:'spotlight'}},100],
 ['studio-velvet-reign',{luelon:{mode:'super-encore'}},300],
 ['studio-cosmic-escape',{luelon:{mode:'deep-echo'}},135],
 ['studio-caramel-carnival',{caramel:{mode:'festival'}},35],
] as const)test(`${gameId}/${Object.values(settings)[0].mode}: demo-wallet rejects an unaffordable full purchase before drawing`,async()=>{
 const db=new PostgresDatabase(':memory:');let draws=0;
 try {
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('bonus-audit')");
  const wallet=new DemoWalletStore(db,()=>{draws++;return 0;});
  await wallet.operate('bonus-audit',{id:randomUUID(),kind:'deposit',amount:200});
  const op={id:randomUUID(),action:'start',gameId,stakeUnits:'1000',settings};
  assert(10<=200&&10*cost>200);
  await assert.rejects(wallet.expansion.operate('bonus-audit',op),/Недостаточно.*начальных ставок/);
  assert.equal(draws,0);assert.equal(await demoBalanceUnits(db,'bonus-audit'),20000);
  assert.equal(await db.prepare('SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND id=?').get('bonus-audit',op.id),undefined);
 } finally {await db.close();}
});
