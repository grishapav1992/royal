import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTsuCue,TsuSounds,type TsuCue} from '../games/tsu-e-fa/TsuSounds';
import {TsuFeedback} from '../games/tsu-e-fa/TsuFeedback';
import {createTsuDuel,lockTsuDuel,advanceTsuDuel,publicTsuDuel} from '../server/pvp/tsu-duel';
import type {PvpChallenge} from '../src/shared/pvp';
import type {GameAudio} from '../src/game/GameAudio';

test('original sound palette stays finite, below clipping and fades to silence at device sample rates',()=>{
  const cues:TsuCue[]=['lock','ready','beat','reveal','draw','round-win','round-lose','match-win','match-lose'];
  for(const rate of [22050,48000,96000])for(const cue of cues){
    const data=renderTsuCue(cue,rate,2);let sum=0,peak=0,mean=0;
    for(const n of data){assert(Number.isFinite(n));sum+=n*n;mean+=n;peak=Math.max(peak,Math.abs(n));}
    assert(peak<.75,cue);assert(Math.sqrt(sum/data.length)>.01,cue);assert(Math.abs(mean/data.length)<.015,cue);
    assert.equal(Math.abs(data[0]),0);assert.equal(Math.abs(data.at(-1)!),0);
  }
});

function timeline(){
  let now=1000,enabled=true,cancelled=0;
  const events:{cue:TsuCue;at:number;variant:number}[]=[];
  const output={available:()=>enabled,lead:()=>40,play:(cue:TsuCue,at=now,variant=0)=>{events.push({cue,at,variant});return Math.max(now+40,at);},cancel:()=>{cancelled++;}};
  const feedback=new TsuFeedback(output),c={id:'duel',creatorId:'a',opponentId:'b',ready:[],status:'arriving',disconnected:[],winnerId:null}as unknown as PvpChallenge;
  let state=createTsuDuel(now);
  const update=(at=now,active=true)=>{now=at;return feedback.update(c,publicTsuDuel(state,0,!!c.disconnected.length),now,now,active);};
  return{feedback,c,events,output,update,now:()=>now,set:(s:typeof state)=>{state=s;},state:()=>state,mute:(value:boolean)=>{enabled=!value;},cancelled:()=>cancelled};
}

test('two real rounds sound once each, reveal and score share the estimated accent, reopening is quiet',()=>{
  const f=timeline();f.update();f.c.status='playing';f.update();
  for(let round=1;round<=2;round++){
    let s=f.state(),at=f.now()+10;
    s=lockTsuDuel(s,0,{kind:'choose',round,choice:'rock'},at);f.set(s);f.update(at);f.update(at);
    s=lockTsuDuel(s,1,{kind:'choose',round,choice:'scissors'},at+1);f.set(s);
    for(let beat=0;beat<5;beat++)f.update(at+1+beat*800);
    s=advanceTsuDuel(s,s.endsAt);f.set(s);if(s.phase==='finished'){f.c.status='finished';f.c.winnerId='a';}
    const revealAt=s.startsAt;assert(f.update(revealAt));assert.equal(f.feedback.score(s.score,revealAt)[0],round-1);
    assert(!f.update(revealAt+40));assert.equal(f.feedback.score(s.score,revealAt+40)[0],round);
    f.update(revealAt+100);f.update(revealAt+200);
    if(round===1){s=advanceTsuDuel(s,s.endsAt);f.set(s);f.update(s.startsAt);}
  }
  assert.equal(f.events.filter(e=>e.cue==='beat').length,10);
  assert.equal(f.events.filter(e=>e.cue==='reveal').length,2);
  assert.equal(f.events.filter(e=>e.cue==='round-win').length,1);
  assert.equal(f.events.filter(e=>e.cue==='match-win').length,1);
  const count=f.events.length,reopened=new TsuFeedback(f.output);reopened.update(f.c,publicTsuDuel(f.state(),0,false),f.now(),f.now());assert.equal(f.events.length,count);
});

test('mute and pause cancel queued sound and consume missed beats without a catch-up burst',()=>{
  const f=timeline();f.update();f.c.status='playing';f.update();
  let s=lockTsuDuel(f.state(),0,{kind:'choose',round:1,choice:'paper'},1001);
  s=lockTsuDuel(s,1,{kind:'choose',round:1,choice:'rock'},1002);f.set(s);f.update(1002);
  f.mute(true);f.update(1200);f.update(2602);const count=f.events.length;
  f.mute(false);f.update(2603);assert.equal(f.events.length,count);
  f.update(3402);assert.equal(f.events.at(-1)!.variant,3);
  f.c.disconnected=[{accountId:'b',until:70000}];f.update(3500);assert(f.cancelled()>1);
  s={...s,startsAt:s.startsAt+10000,endsAt:s.endsAt+10000};f.set(s);f.c.disconnected=[];
  f.update(13500);assert.equal(f.events.filter(e=>e.cue==='beat').length,2);
  f.update(14202);assert.equal(f.events.at(-1)!.variant,4);
  const hiddenCount=f.events.length;s=advanceTsuDuel(s,s.endsAt);f.set(s);f.update(s.startsAt,false);f.update(s.startsAt+50,true);
  assert.equal(f.events.length,hiddenCount);assert(!f.events.some(e=>e.cue==='reveal'));
});

test('shared volume, mute, suspension and disposal stop every owned voice and release subscriptions',()=>{
  class Node {gain={value:0};buffer:any;onended:any;stopped=false;disconnected=false;connect(n:unknown){return n;}disconnect(){this.disconnected=true;}start(){}stop(at?:number){if(at===undefined)this.stopped=true;}}
  const sources:Node[]=[];let muted=false,volume=.35,listener=()=>{},unsubscribed=false;
  const c=Object.assign(new EventTarget(),{state:'running',currentTime:1,sampleRate:48000,baseLatency:.01,outputLatency:.03,
    createGain:()=>new Node(),createBuffer:(_channels:number,length:number,rate:number)=>({duration:length/rate,copyToChannel(){}}),
    createBufferSource:()=>{const source=new Node();sources.push(source);return source;}});
  const host={context:c,output:new Node(),unlock:async()=>{},getPreferences:()=>({muted,volume,casinoEnabled:true}),onPreferences:(cb:()=>void)=>{listener=cb;return()=>{unsubscribed=true;};}}as unknown as GameAudio;
  const sound=new TsuSounds(host,{hidden:false}as Document);
  assert(sound.play('reveal')!>=performance.now());assert.equal(sound.getState().activeVoices,1);
  muted=true;listener();assert.equal(sound.getState().activeVoices,0);assert(sources.every(s=>s.stopped&&s.disconnected));assert.equal(sound.play('beat'),undefined);
  muted=false;volume=0;listener();assert.equal(sound.play('beat'),undefined);
  volume=.35;sound.play('beat');c.state='suspended';c.dispatchEvent(new Event('statechange'));assert.equal(sound.getState().activeVoices,0);
  c.state='running';sound.play('match-win');sound.destroy();assert(unsubscribed);assert.equal(sound.getState().activeVoices,0);assert(sound.getState().disposed);assert.equal(sound.play('lock'),undefined);
});
