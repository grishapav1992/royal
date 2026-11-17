import test from 'node:test';
import assert from 'node:assert/strict';
import {ConvoyMotion,type ConvoyMotionOptions,type ConvoyMotionOperation} from '../src/ui/ConvoyMotion';
import {startConvoy} from '../server/games/lastConvoy';
import {layoutDraw} from '../scripts/game-layout-scenarios';
import type {ConvoyResult} from '../src/shared/lastConvoy';
import type {NativeSlotSession} from '../src/ui/slotKit/SlotSessions';

function scenario(predicate:(result:ConvoyResult)=>boolean){
 for(let seed=1;seed<10000;seed++){
  const result=startConvoy({convoy:{mode:'normal'}},'10',layoutDraw(seed));
  if(predicate(result))return {id:`round-${seed}`,gameId:'studio-last-convoy',rulesVersion:2,state:result.ended?'settled':'active',stakeUnits:'10',spentUnits:'10',returnedUnits:String(result.credit),view:{convoy:result.view}} as NativeSlotSession<'convoy'>;
 }
 throw Error('No deterministic convoy scenario');
}
const cascade=scenario(result=>result.view.spin.frames.some(frame=>frame.removed.length>0)&&result.view.spin.frames[0].addedPins.length>0);
const bonus=scenario(result=>result.view.spin.freeAward>0);

function fixture(motion=true,fast=false){
 const events:string[]=[],totals:string[]=[],grids:number[][]=[];
 const nodes=new Map<string,{textContent:string;innerHTML:string;replaceChildren():void}>();
 for(const key of ['[data-cc-groups]','[data-cc-message]'])nodes.set(key,{textContent:'',innerHTML:'',replaceChildren(){this.innerHTML='';}});
 const root={dataset:{} as Record<string,string>,querySelector:(key:string)=>nodes.get(key)} as unknown as HTMLElement;
 const operation:ConvoyMotionOperation={token:'visual-1',account:'account-1',generation:0,motion,fast};
 let valid=true;
 const options:ConvoyMotionOptions={root,
  board:{setPins:pins=>events.push('pins:'+pins.join(',')),begin:()=>events.push('begin'),settle:async(_token,grid)=>{grids.push([...grid]);return true;},clearOverlay:()=>{},show:grid=>grids.push([...grid]),highlight:()=>{},remove:()=>events.push('remove'),gravity:()=>events.push('gravity'),cancel:()=>events.push('cancel')},
  audio:{begin:async()=>{events.push('spin');},stopSpin:()=>events.push('stop-spin'),stopReel:column=>events.push('land:'+column),feature:name=>events.push(name),cascade:()=>events.push('cascade'),drop:()=>events.push('drop'),tickets:()=>events.push('tickets'),outcome:won=>events.push(won?'win':'settle')},
  current:()=>valid,delay:async()=>true,total:value=>totals.push(String(value)),factor:()=>{},tickets:()=>{},features:()=>events.push('features')};
 const facade=new ConvoyMotion(options);
 return {facade,options,operation,events,totals,grids,root,nodes,invalidate:()=>{valid=false;}};
}

test('start gives neutral feedback without revealing a result or total',()=>{
 const f=fixture();f.facade.begin(f.operation,[4,10]);f.facade.phase('stopping');f.facade.land(2);
 assert.equal(f.root.dataset.phase,'stopping');assert.deepEqual(f.totals,[]);assert.deepEqual(f.grids,[]);
 assert(f.events.includes('pins:4,10'));assert(f.events.includes('land:2'));assert(!f.events.includes('win'));
 f.facade.cancel();f.facade.land(3);assert(!f.events.includes('land:3'));assert.equal(f.root.dataset.animationToken,'');
});

for(const [motion,fast] of [[true,false],[true,true],[false,false]])test(`confirmed cascade keeps the server grid, exact total and transcript (${motion}, ${fast})`,async()=>{
 const f=fixture(motion,fast),before=JSON.stringify(cascade);f.facade.begin(f.operation,[]);
 assert.equal(await f.facade.present(cascade,f.operation),true);
 assert.deepEqual(f.grids.at(-1),cascade.view.convoy.spin.finalGrid);
 assert.equal(f.totals.at(-1),cascade.state==='settled'?cascade.returnedUnits:cascade.view.convoy.totalPayoutUnits);
 assert.equal(JSON.stringify(cascade),before);assert(f.events.indexOf('barricade')<f.events.indexOf('cascade'));
 assert.equal(f.events.includes('gravity'),motion);assert.equal(f.events.filter(event=>event==='win').length,1);
 const count=f.events.length;assert.equal(await f.facade.present(cascade,f.operation),false);assert.equal(f.events.length,count);
 f.facade.finish(f.operation);assert.equal(f.root.dataset.phase,'idle');assert.equal(f.root.dataset.animationToken,'');
});

test('bonus signal comes from the confirmed award and repeats do not replay it',async()=>{
 const f=fixture(false);f.facade.begin(f.operation,[]);assert.equal(await f.facade.present(bonus,f.operation),true);
 assert.equal(f.events.filter(event=>event==='tickets').length,1);
 assert.match(f.nodes.get('[data-cc-message]')!.textContent,/СИГНАЛ ПРИНЯТ/);
 assert.equal(await f.facade.present(bonus,f.operation),false);assert.equal(f.events.filter(event=>event==='tickets').length,1);
});

for(const interruption of ['cancel','account-or-visibility','destroy'] as const)test(`interruption during a cascade cannot emit a late result (${interruption})`,async()=>{
 const f=fixture();let release!:(value:boolean)=>void;
 f.options.delay=()=>new Promise(resolve=>{release=resolve;});
 f.facade.begin(f.operation,[]);const presenting=f.facade.present(cascade,f.operation);
 await new Promise<void>(resolve=>setImmediate(resolve));assert(release);
 if(interruption==='cancel')f.facade.cancel();else if(interruption==='destroy')f.facade.destroy();else f.invalidate();
 const count=f.events.length;release(true);assert.equal(await presenting,false);assert.equal(f.events.length,count);
 assert(!f.events.includes('win'));assert(!f.events.includes('tickets'));
 f.facade.destroy();
});

test('a cancelled reel landing cannot reveal an outcome',async()=>{
 const f=fixture();f.options.board.settle=async()=>false;f.facade.begin(f.operation,[]);
 assert.equal(await f.facade.present(cascade,f.operation),false);assert(!f.events.includes('win'));assert(!f.events.includes('barricade'));
});


test('the confirmed credited amount takes precedence over the presentation subtotal',async()=>{
 const f=fixture(false),session=structuredClone(cascade);session.state='settled';session.returnedUnits=String(BigInt(session.view.convoy.totalPayoutUnits)+1n);
 f.facade.begin(f.operation,[]);assert.equal(await f.facade.present(session,f.operation),true);
 assert.equal(f.totals.at(-1),session.returnedUnits);
});

test('a late cancelled presentation cannot overwrite the next visual operation',async()=>{
 const f=fixture();let release!:(value:boolean)=>void;
 f.options.board.settle=()=>new Promise(resolve=>{release=resolve;});
 f.facade.begin(f.operation,[]);const stale=f.facade.present(cascade,f.operation);
 const next={...f.operation,token:'visual-2'};f.facade.begin(next,[]);const count=f.events.length;
 release(true);assert.equal(await stale,false);assert.equal(f.events.length,count);
 assert.equal(f.root.dataset.animationToken,'visual-2');f.facade.land(1);assert.equal(f.events.at(-1),'land:1');f.facade.destroy();
});
