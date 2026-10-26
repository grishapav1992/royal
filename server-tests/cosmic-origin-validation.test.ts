import test from 'node:test';
import assert from 'node:assert/strict';
import {startLuelonSlotGame,moveLuelonSlotGame,slotPay} from '../server/games/luelonSlots';
import {luelonSlotLineWins,validLuelonSlotSettlement,type LuelonSlotFrame,type LuelonSlotSpin,type LuelonSlotView} from '../src/shared/luelonSlots';
import {getLuelonSlotRules,LUELON_SLOT_PROFILES} from '../src/shared/luelonSlotsModels';

const game='studio-cosmic-escape' as const;
const modes=['cosmic-chaos','ufo-invasion','deep-echo'] as const;
type Mode=typeof modes[number];
type Sample=[max:number,value:number];
const rules=getLuelonSlotRules(game);
const modeInfo=(mode:Mode)=>rules.info.modes.find(item=>item.id===mode)!;
const settings=(mode:Mode)=>({luelon:{mode}});
const grid=[0,0,0,3,4,2,3,4,5,6,4,5,6,0,1];
const restore=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function entropy(samples:Sample[]){
 let used=0;const draw=(max:number)=>{const next=samples[used++];assert(next,'Unexpected entropy domain '+max);assert.equal(next[0],max);assert(next[1]>=0&&next[1]<max);return next[1];};
 return{draw,complete:()=>assert.equal(used,samples.length)};
}
function freeEntropy(mode:Mode,first=false){
 const raw=():Sample[]=>[...grid.map(symbol=>[7,symbol] as Sample),...Array.from({length:20},()=>[1000,999] as Sample)];
 const beams=():Sample[]=>Array.from({length:LUELON_SLOT_PROFILES.cosmicBeamAttempts[mode]},()=>[1000,999]);
 const samples:Sample[]=[...raw(),[100,first?0:99]];
 if(first)samples.push([1000,999]);
 samples.push(...beams(),[100,first?0:99]);
 if(first)samples.push(...raw(),...beams());
 return entropy(samples);
}
function valid(view:LuelonSlotView,stake='100'){
 const settled=view.phase==='complete';return validLuelonSlotSettlement(game,settled?'settled':'active',stake,String(BigInt(stake)*BigInt(modeInfo(view.mode as Mode).cost)),settled?view.totalPayoutUnits:'0',view);
}

/** Self-consistent untrusted receipt: only its initial multiplier has no legal origin. */
function forgedPurchase(mode:Mode,complete:boolean){
 const view=restore(startLuelonSlotGame(game,settings(mode),'100').luelon),count=complete?modeInfo(mode).spins:1;
 view.bonus!.features.multiplier=50;
 for(let index=0;index<count;index++){
  const before=restore(view.bonus!.features),after=restore(before);
  const frame:LuelonSlotFrame={index:0,gridBefore:[...grid],gridAfter:[...grid],wins:luelonSlotLineWins(game,grid,[],50).map(win=>({...win,payoutUnits:'0',uncappedPayoutUnits:'0'})),events:[],payoutUnits:'0',uncappedPayoutUnits:'0',removed:[],drops:[],refills:[]};
  const payment=slotPay(rules,[frame],'100',view.totalPayoutUnits);
  assert(!payment.capped);assert.equal(frame.wins.length,1);assert.equal(payment.paid,6000n);
  const spin:LuelonSlotSpin={index,kind:'free-spin',rows:3,initialGrid:[...grid],frames:[frame],finalGrid:[...grid],payoutUnits:String(payment.paid),uncappedPayoutUnits:String(payment.raw),triggerAwards:0,featuresBefore:before,featuresAfter:after,events:[],stopReason:'complete'};
  view.history.push(spin);view.spin=spin;view.revision=view.history.length;view.totalPayoutUnits=String(BigInt(view.totalPayoutUnits)+payment.paid);view.bonus!.played++;view.bonus!.remaining--;view.bonus!.features=after;
 }
 view.phase=complete?'complete':'bonus';return view;
}

for(const mode of modes){
 for(const complete of [false,true])test(`${mode}: self-consistent ${complete?'settled':'active'} receipt cannot invent an initial x50 multiplier`,()=>{
  const forged=forgedPurchase(mode,complete);assert.equal(forged.history[0].featuresBefore.multiplier,50);assert(BigInt(forged.totalPayoutUnits)>0n);assert.equal(forged.bonus!.remaining,complete?0:modeInfo(mode).spins-1);
  assert.equal(valid(restore(forged)),false);
  if(!complete){let draws=0;assert.throws(()=>moveLuelonSlotGame(forged,'100',forged.revision,'luelon-spin',undefined,()=>{draws++;return 0;}));assert.equal(draws,0);}
 });
 test(`${mode}: legal x${modeInfo(mode).startMultiplier} origin accepts first-spin energy to x50, echo and serialized continuations`,()=>{
  const stake='20';let result=startLuelonSlotGame(game,settings(mode),stake),first=true;
  assert.equal(result.luelon.bonus!.features.multiplier,modeInfo(mode).startMultiplier);assert(valid(result.luelon,stake));
  while(!result.ended){const source=freeEntropy(mode,first);result=moveLuelonSlotGame(restore(result.luelon),stake,result.luelon.revision,'luelon-spin',undefined,source.draw);source.complete();assert(valid(restore(result.luelon),stake));
   if(first){const spin=result.luelon.history[0];assert.equal(spin.featuresBefore.multiplier,modeInfo(mode).startMultiplier);assert.equal(spin.featuresAfter.multiplier,50);assert.equal(spin.frames.length,2);const energy=spin.frames[0].events.find(event=>event.kind==='energy')!;assert.equal(energy.before,modeInfo(mode).startMultiplier);assert.equal(energy.after,50);assert(spin.frames[1].events.some(event=>event.kind==='echo'));first=false;}
  }
  assert.equal(result.luelon.bonus!.played,modeInfo(mode).spins);assert.equal(result.luelon.bonus!.remaining,0);assert.equal(result.luelon.capped,false);
 });
}

test('unplayed purchases also reject a forged x50 origin before entropy is requested',()=>{
 for(const mode of modes){const view=restore(startLuelonSlotGame(game,settings(mode),'100').luelon);view.bonus!.features.multiplier=50;assert.equal(valid(view),false);let draws=0;assert.throws(()=>moveLuelonSlotGame(view,'100',0,'luelon-spin',undefined,()=>{draws++;return 0;}));assert.equal(draws,0);}
});

