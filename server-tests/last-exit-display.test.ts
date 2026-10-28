import test from 'node:test';import assert from 'node:assert/strict';
import type {ExpansionSession} from '../src/shared/casinoExpansion';
import {raceAnchor,raceDisplay,validRaceTime,RACE_CONNECTION_GRACE_MS,type RaceAnchor} from '../src/ui/lastExitModel';
const session=(state:'active'|'settled'='active'):ExpansionSession=>({id:'a',gameId:'github-crash',rulesVersion:1,state,stakeUnits:'1000',spentUnits:'1000',returnedUnits:'0',startedAt:10000,serverNow:15000,multiplier:Math.exp(.06*5),view:{player:[],dealer:[],community:[],actions:[],phase:1,ended:state==='settled',message:''}});
test('live presentation projects elapsed time only within its connection budget',()=>{
 const s=session(),a=raceAnchor(s,undefined,0);
 for(const now of [0,260,420,1800]){const d=raceDisplay(s,a,now);assert.equal(d.time,15000+now);assert.equal(d.stalled,false);assert.equal(d.value,Math.exp(.06*(5+now/1000)));}
 const frozen=raceDisplay(s,a,10000000);assert.equal(frozen.time,15000+RACE_CONNECTION_GRACE_MS);assert.equal(frozen.stalled,true);assert.equal(frozen.phase,'racing');
});
test('the countdown crosses into continuous growth without waiting for another packet',()=>{
 const s={...session(),serverNow:8000,startedAt:10000,multiplier:1},a=raceAnchor(s,undefined,0);
 assert.equal(raceDisplay(s,a,0).countdown,2);assert.equal(raceDisplay(s,a,1000).countdown,1);
 assert.equal(raceDisplay(s,a,2000).phase,'racing');assert(raceDisplay(s,a,2100).value>1);
});
test('foreign and invalid timing cannot animate a flight',()=>{assert.equal(raceDisplay(session(),{id:'other',from:0,to:90000,at:0,heardAt:0},100).phase,'idle');for(const value of [NaN,Infinity,0,101])assert.equal(validRaceTime({...session(),multiplier:value}),false);});
test('only confirmed settlement determines a result, including the cap',()=>{
 assert.equal(raceDisplay({...session('settled'),crashAt:1.15},undefined,1).phase,'crashed');
 const s={...session('settled'),returnedUnits:'100000',multiplier:100};assert.equal(raceDisplay(s,undefined,1).phase,'escaped');assert.equal(raceDisplay(s,undefined,1).value,100);
 const active={...session(),startedAt:0,serverNow:80000,multiplier:100};assert.equal(raceDisplay(active,raceAnchor(active,undefined,0),1000).phase,'racing');
});
test('slow and uneven replies do not stop, accelerate or rewind the frame clock',()=>{
 let s=session(),anchor:RaceAnchor=raceAnchor(s,undefined,0),next=0;
 const replies=[1100,2450,3200,4800,6200,7100];
 for(let now=0;now<=8000;now+=10){
  if(next<replies.length&&now>=replies[next]){
   // Each snapshot spent 900 ms in transit before being received.
   const serverNow=15000+now-900;s={...s,serverNow,multiplier:Math.exp(.06*(serverNow-10000)/1000)};
   const before=raceDisplay(s,anchor,now).time;anchor=raceAnchor(s,anchor,now);
   assert.equal(raceDisplay(s,anchor,now).time,before);next++;
  }
  const d=raceDisplay(s,anchor,now);assert.equal(d.time,15000+now);assert.equal(d.stalled,false);
  assert.equal(raceDisplay(s,anchor,now,true).time,d.time,'reduced motion must not make numbers jump');
 }
});
test('duplicates do not extend freshness and recovery discards a long outage without rewinding',()=>{
 const s=session(),anchor=raceAnchor(s,undefined,0);assert.equal(raceAnchor(s,anchor,2000),anchor);
 assert.equal(raceDisplay(s,anchor,10000).stalled,true);
 const recovered={...s,serverNow:25000,multiplier:Math.exp(.9)},next=raceAnchor(recovered,anchor,10000);
 assert.equal(raceDisplay(recovered,next,10000).time,25000);assert.equal(raceDisplay(recovered,next,10100).time,25100);assert.equal(raceDisplay(recovered,next,10100).stalled,false);
 const late={...s,serverNow:16000},lateAnchor=raceAnchor(late,anchor,10000);assert.equal(lateAnchor.from,18000);
});
test('settlement interrupts projection immediately and a new round gets its own clock',()=>{
 const s=session(),anchor=raceAnchor(s,undefined,0),settled={...session('settled'),crashAt:1.15};
 assert.equal(raceDisplay(settled,anchor,2000).phase,'crashed');assert.equal(raceDisplay(settled,anchor,2000).value,1.15);
 const paid={...settled,returnedUnits:'1230',multiplier:1.23};assert.equal(raceDisplay(paid,anchor,2000).hundredths,123);
 const next={...s,id:'new-round',serverNow:30000,startedAt:32000,multiplier:1};
 assert.equal(raceAnchor(next,anchor,20).from,30000);
});
