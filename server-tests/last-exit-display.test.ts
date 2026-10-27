import test from 'node:test';import assert from 'node:assert/strict';
import type {ExpansionSession} from '../src/shared/casinoExpansion';
import {raceAnchor,raceDisplay,validRaceTime,RACE_DISPLAY_BUFFER_MS,type RaceAnchor} from '../src/ui/lastExitModel';
const session=(state:'active'|'settled'='active'):ExpansionSession=>({id:'a',gameId:'github-crash',rulesVersion:1,state,stakeUnits:'1000',spentUnits:'1000',returnedUnits:'0',startedAt:10000,serverNow:15000,multiplier:Math.exp(.06*5),view:{player:[],dealer:[],community:[],actions:[],phase:1,ended:state==='settled',message:''}});
test('presentation freezes at confirmed time even after a long network gap',()=>{const s=session(),a={id:'a',from:14000,to:15000,at:100};for(const now of [100,260,420,10000000]){const d=raceDisplay(s,a,now);assert(d.time<=s.serverNow!);assert(d.value<=s.multiplier!);}assert.equal(raceDisplay(s,a,10000000).time,15000);});
test('a confirmed countdown cannot become a running multiplier before a reply arrives',()=>{const s={...session(),startedAt:20000},a={id:'a',from:15000,to:15000,at:0};const d=raceDisplay(s,a,999999);assert.equal(d.phase,'waiting');assert.equal(d.value,1);assert.equal(d.countdown,5);});
test('foreign and invalid timing cannot animate a flight',()=>{assert.equal(raceDisplay(session(),{id:'other',from:0,to:90000,at:0},100).phase,'idle');for(const value of [NaN,Infinity,0,101])assert.equal(validRaceTime({...session(),multiplier:value}),false);});
test('confirmed settlement, including the cap, determines the result independently of animation',()=>{assert.equal(raceDisplay({...session('settled'),crashAt:1.15},undefined,1).phase,'crashed');const s={...session('settled'),returnedUnits:'100000',multiplier:100};assert.equal(raceDisplay(s,undefined,1).phase,'escaped');assert.equal(raceDisplay(s,undefined,1).value,100);});
test('uneven server replies preserve a steady clock on every frame',()=>{
 let s=session(),anchor:RaceAnchor|undefined=raceAnchor(s,undefined,0),next=0;
 const replies=[350,735,1030,1430,1800,2130,2480,2870];
 for(let now=0;now<=3100;now+=10){
  if(next<replies.length&&now>=replies[next]){
   s={...s,serverNow:15000+now,multiplier:Math.exp(.06*(5+now/1000))};
   const before=raceDisplay(s,anchor,now).time;anchor=raceAnchor(s,anchor,now);
   assert.equal(raceDisplay(s,anchor,now).time,before,'receiving a reply must not jump the clock');next++;
  }
  const d=raceDisplay(s,anchor,now);assert.equal(d.time,15000-RACE_DISPLAY_BUFFER_MS+now);
  assert(d.time<=s.serverNow!);assert(d.value<=s.multiplier!);
  assert.equal(raceDisplay(s,anchor,now,true).time,d.time,'reduced motion must not make numbers jump');
 }
});
test('buffered countdown retains two seconds and starts without a catch-up wave',()=>{
 let s={...session(),serverNow:8000,startedAt:10000,multiplier:1},anchor=raceAnchor(s,undefined,0);
 assert.equal(raceDisplay(s,anchor,0).countdown,2);
 for(let now=350;now<=2800;now+=350){
  s={...s,serverNow:8000+now,multiplier:Math.exp(.06*Math.max(0,(now-2000)/1000))};anchor=raceAnchor(s,anchor,now);
  assert.equal(raceDisplay(s,anchor,now).time,8000+Math.max(0,now-RACE_DISPLAY_BUFFER_MS));
 }
 assert.equal(raceDisplay(s,anchor,2800).phase,'racing');
});
test('connection loss freezes at confirmation, and recovery resumes without a jump',()=>{
 const s=session(),anchor=raceAnchor(s,undefined,0);
 assert.equal(raceDisplay(s,anchor,10000).time,s.serverNow);
 const recovered={...s,serverNow:25000,multiplier:Math.exp(.9)},next=raceAnchor(recovered,anchor,10000);
 assert.equal(raceDisplay(recovered,next,10000).time,s.serverNow);
 assert.equal(raceDisplay(recovered,next,10100).time,s.serverNow!+100);
 assert.equal(raceDisplay(recovered,next,1000000).time,recovered.serverNow);
});
test('settlement interrupts the buffer immediately and a new round gets its own clock',()=>{
 const s=session(),anchor=raceAnchor(s,undefined,0),settled={...session('settled'),crashAt:1.15};
 assert.equal(raceDisplay(settled,anchor,0).phase,'crashed');assert.equal(raceDisplay(settled,anchor,0).value,1.15);
 const next={...s,id:'new-round',serverNow:30000,startedAt:32000,multiplier:1};
 assert.equal(raceAnchor(next,anchor,20).from,30000);assert.equal(raceAnchor(s,anchor,100),anchor);
});
