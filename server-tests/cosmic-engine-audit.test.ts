import test from 'node:test';
import assert from 'node:assert/strict';
import {startLuelonSlotGame,moveLuelonSlotGame} from '../server/games/luelonSlots';
import {luelonSlotLineWins,validLuelonSlotSettlement,type LuelonSlotView} from '../src/shared/luelonSlots';
import {getLuelonSlotRules,LUELON_SLOT_PROFILES} from '../src/shared/luelonSlotsModels';
import {COSMIC_ESCAPE_BET_UNITS} from '../src/shared/cosmicEscapeBets';
const game='studio-cosmic-escape' as const;
type Sample={max:number;value:number};
function entropy(values:Sample[]){let index=0;const draw=(max:number)=>{const n=values[index++];assert(n,'Unexpected entropy request '+max);assert.equal(n.max,max);assert(n.value>=0&&n.value<max);return n.value;};return{draw,complete:()=>assert.equal(index,values.length)};}
const sample=(max:number,value:number):Sample=>({max,value});
const baseGrid=Array.from({length:15},(_,i)=>i%7);
function base(count:number){const v=[...baseGrid.map(n=>sample(7,n)),...Array.from({length:15},()=>sample(1000,999)),sample(1000000,count>=3?0:999999)];v.push(count>=3?sample(100,count===5?0:count===4?5:20):sample(3,count));for(let col=0;col<count;col++)v.push(sample(5-col,0),sample(3,0));return v;}
function raw(wild=false,ordinary=6,scatters:number[]=[]){const v=[...Array.from({length:15},()=>sample(7,ordinary)),...Array.from({length:15},()=>sample(1000,wild?0:999))];for(let col=0;col<5;col++){v.push(sample(1000,scatters.includes(col)?0:999));if(scatters.includes(col))v.push(sample(3,0));}return v;}
function beams(mode:string,columns:number[]=[]){const attempts=LUELON_SLOT_PROFILES.cosmicBeamAttempts[mode as keyof typeof LUELON_SLOT_PROFILES.cosmicBeamAttempts];return Array.from({length:attempts},(_,i)=>columns[i]===undefined?[sample(1000,999)]:[sample(1000,0),sample(5,columns[i])]).flat();}
function free(mode:string,options:{energy?:number;wild?:boolean;ordinary?:number;columns?:number[];scatters?:number[];echo?:boolean;echoWild?:boolean;capFirst?:boolean}={}){
 const v=[...raw(options.wild,options.ordinary,options.scatters),sample(100,options.energy===undefined?99:0)];if(options.energy!==undefined)v.push(sample(1000,options.energy));v.push(...beams(mode,options.columns));if(!options.capFirst){v.push(sample(100,options.echo?0:99));if(options.echo)v.push(...raw(options.echoWild,options.ordinary),...beams(mode));}return v;
}
const settings=(mode:string)=>({luelon:{mode}});
function next(view:LuelonSlotView,stake:string,values:Sample[]){const e=entropy(values),r=moveLuelonSlotGame(view,stake,view.revision,'luelon-spin',undefined,e.draw);e.complete();return r;}
for(const count of [0,1,2,3,4,5])test('Cosmic '+count+' portals grant the exact natural continuation budget',()=>{
 const e=entropy(base(count));let r=startLuelonSlotGame(game,settings('normal'),'20',e.draw);e.complete();const expected=count<3?0:count===3?10:count===4?12:15;assert.equal(r.luelon.spin!.triggerAwards,expected);assert.equal(r.luelon.spin!.initialGrid.filter(n=>n===8).length,count);assert.equal(r.luelon.spin!.payoutUnits,'0');
 if(!expected){assert(r.ended);return;}assert.equal(r.luelon.bonus!.id,'cosmic-chaos');assert.equal(r.credit,0);for(let i=0;i<expected;i++){r=next(r.luelon,'20',free('cosmic-chaos',{ordinary:6,scatters:[0,1,2,3,4]}));assert.equal(r.luelon.bonus!.remaining,expected-i-1);assert.equal(r.luelon.bonus!.awarded,expected);assert.equal(r.luelon.spin!.triggerAwards,0);}assert(r.ended);assert.equal(r.luelon.history.length,expected+1);
});
for(const mode of ['cosmic-chaos','ufo-invasion','deep-echo'])test(mode+': echo pays each frame once and consumes one free spin',()=>{
 const start=startLuelonSlotGame(game,settings(mode),'100');const before=start.luelon.bonus!.remaining;const r=next(start.luelon,'100',free(mode,{energy:0,echo:true}));const spin=r.luelon.spin!,factor=mode==='deep-echo'?4:2;
 assert.equal(spin.frames.length,2);assert.equal(r.luelon.bonus!.remaining,before-1);assert.equal(r.luelon.bonus!.played,1);assert.equal(spin.featuresBefore.multiplier,mode==='deep-echo'?3:1);assert.equal(spin.featuresAfter.multiplier,factor);assert.equal(spin.frames.flatMap(f=>f.events).filter(e=>e.kind==='energy').length,1);assert.equal(spin.frames[1].events.filter(e=>e.kind==='echo').length,1);
 // Every screen has twenty five-of-a-kind symbol6 lines, each worth3.2 base stakes.
 const frame=20*320*factor;assert.equal(spin.frames[0].payoutUnits,String(frame));assert.equal(spin.frames[1].payoutUnits,String(frame));assert.equal(spin.payoutUnits,String(frame*2));assert.equal(r.luelon.totalPayoutUnits,String(frame*2));assert.equal(r.credit,0);
 const persisted=JSON.parse(JSON.stringify(r.luelon));const after=next(persisted,'100',free(mode));assert.equal(after.luelon.spin!.featuresBefore.multiplier,factor);assert.equal(after.luelon.spin!.featuresAfter.multiplier,factor);
});
test('UFO duplicate beam attempts select one column and beam WILDs do not persist',()=>{
 const start=startLuelonSlotGame(game,settings('ufo-invasion'),'100'),r=next(start.luelon,'100',free('ufo-invasion',{columns:[2,2]}));const frame=r.luelon.spin!.frames[0];assert.equal(frame.events.filter(e=>e.kind==='expand').length,1);assert.deepEqual(frame.events.find(e=>e.kind==='expand')!.positions,[2,7,12]);assert.deepEqual(r.luelon.bonus!.features.wilds,[]);
 const second=next(r.luelon,'100',free('ufo-invasion'));assert.equal(second.luelon.spin!.frames[0].events.filter(e=>e.kind==='expand').length,0);assert(second.luelon.spin!.finalGrid.every(s=>s===6));
});
test('whole-round cap applies in the first frame and in echo on every stake and purchase',()=>{
 let cases=0;for(const stake of COSMIC_ESCAPE_BET_UNITS)for(const mode of ['cosmic-chaos','ufo-invasion','deep-echo'])for(const echo of [false,true]){
  const start=startLuelonSlotGame(game,settings(mode),stake),r=next(start.luelon,stake,free(mode,{energy:999,wild:!echo,echo,echoWild:true,capFirst:!echo}));const cap=BigInt(stake)*10000n;assert(r.ended);assert(r.luelon.capped);assert.equal(r.credit,Number(cap));assert.equal(r.luelon.totalPayoutUnits,String(cap));assert.equal(r.luelon.bonus!.remaining,0);assert.equal(r.luelon.history.length,1);assert.equal(r.luelon.spin!.frames.length,echo?2:1);
  if(echo){assert.equal(r.luelon.spin!.frames[0].payoutUnits,String(BigInt(stake)*3200n));assert.equal(r.luelon.spin!.frames[1].payoutUnits,String(BigInt(stake)*6800n));}assert.throws(()=>moveLuelonSlotGame(r.luelon,stake,r.luelon.revision,'luelon-spin',undefined,()=>{throw Error('No entropy after settlement');}));cases++;
 }assert.equal(cases,156);
});
test('all allowed stakes settle every symbol/count/multiplier exactly without rounding',()=>{
 const info=getLuelonSlotRules(game).info;for(const stake of COSMIC_ESCAPE_BET_UNITS){assert.equal(BigInt(stake)%20n,0n);for(const symbol of info.symbols)for(const amount of Object.values(symbol.pays)){assert.equal(amount%5,0);for(let factor=1;factor<=50;factor++)assert.equal(BigInt(stake)*BigInt(amount)*BigInt(factor)%100n,0n);}}
});
test('line scorer chooses the more valuable shorter all-WILD prefix once per line',()=>{
 // On the top row 77766: symbol0 pays120 for the three WILDs; symbol6 extends to5 and pays320.
 // On77768: symbol6 extends to4 and pays80, so the WILD-only prefix wins for200.
 const grid=Array(15).fill(8);grid.splice(0,5,7,7,7,6,8);const line=luelonSlotLineWins(game,grid).find(w=>w.line===0)!;assert.equal(line.symbol,7);assert.equal(line.count,3);assert.equal(line.payHundredths,200);assert.equal(luelonSlotLineWins(game,grid).filter(w=>w.line===0).length,1);
});
test('forged accumulated payment and changed cap status fail settlement validation',()=>{
 const start=startLuelonSlotGame(game,settings('deep-echo'),'100'),r=next(start.luelon,'100',free('deep-echo',{energy:0,echo:true}));for(const mutate of [(v:LuelonSlotView)=>{v.totalPayoutUnits=String(BigInt(v.totalPayoutUnits)+1n);},(v:LuelonSlotView)=>{v.history[0].frames[0].payoutUnits='0';},(v:LuelonSlotView)=>{v.capped=true;},(v:LuelonSlotView)=>{v.bonus!.remaining++;}]){const forged=structuredClone(r.luelon);mutate(forged);assert(!validLuelonSlotSettlement(game,'active','100','13500','0',forged));}
});
