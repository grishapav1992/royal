import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialCascadeState} from '../src/shared/floodedTempleCascadeMath';
import {generateCascadeOperation,replayCascadeOperations,type TempleCascadeView} from '../src/shared/floodedTempleCascade';
import {cascadePlan,cascadeMoves,cascadeCounter,cascadeLandMs,cascadeCharacter} from '../games/flooded-temple/cascadePresentation';
import {templeReaction} from '../games/flooded-temple/character';
import {renderCascadeCue,cascadeCueSpecs} from '../scripts/design/temple-cascade-audio.mjs';
import {renderCue,wav,rate,metrics} from '../scripts/design/temple-audio.mjs';
import {CascadeTimeline} from '../games/flooded-temple/CascadeTimeline';
import type {TempleAudio} from '../games/flooded-temple/TempleAudio';
import {TempleMusic} from '../games/flooded-temple/TempleMusic';

function* views(seed:number,stake='1000'){
  const state=initialCascadeState(),ops:number[][][]=[];
  const draw=(max:number)=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%max;};
  while(state.next!=='done'){ops.push(generateCascadeOperation(state,draw));yield replayCascadeOperations(stake,ops);}
}

test('output latency never makes a confirmed cue late behind a short silent evaluation beat',t=>{
  const bank={...JSON.parse(readFileSync('games/flooded-temple/sounds.json','utf8')).cues,...JSON.parse(readFileSync('games/flooded-temple/cascadeSounds.json','utf8')).cues};
  const previousRaf=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;
  const callbacks=new Map<number,FrameRequestCallback>();let now=0,id=0;
  t.mock.method(performance,'now',()=>now);
  globalThis.requestAnimationFrame=callback=>{callbacks.set(++id,callback);return id;};globalThis.cancelAnimationFrame=handle=>{callbacks.delete(handle);};
  try{
    for(const latency of[.02,.3,.7]){
      now=0;callbacks.clear();const scheduled:{cue:string;leadMs:number}[]=[];
      const audio={audible:true,lead:()=>latency*1000+200,cancelEffects(){},duck(){},schedule(cue:string,target:number){scheduled.push({cue,leadMs:target-now-latency*1000-bank[cue].accent*1000});}} as unknown as TempleAudio;
      const plan=cascadePlan('latency-'+latency,Array.from(views(15)).at(-1)!);
      const timeline=new CascadeTimeline(audio,()=>{},()=>{});timeline.start(plan);
      while(callbacks.size&&now<plan.duration+latency*1000+1000){now+=10;const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(now);}
      assert.equal(scheduled.length,4);assert(scheduled.every(a=>a.leadMs>=2),JSON.stringify({latency,scheduled}));assert.equal(timeline.active,false);timeline.destroy();
    }
  }finally{globalThis.requestAnimationFrame=previousRaf;globalThis.cancelAnimationFrame=previousCancel;}
});

test('a failed streamed score releases its voice reservation and retries only on a later gesture',async()=>{
  let broken=true,loads=0,sources=0;
  const audio={paused:true,ended:false,readyState:0,error:null as object|null,currentTime:0,
    async play(){this.paused=false;if(broken){this.error={code:2};throw Error('Unavailable recording');}this.readyState=4;},
    pause(){this.paused=true;},load(){loads++;broken=false;this.error=null;this.readyState=0;this.paused=true;},removeAttribute(){},
  };
  const context={currentTime:0,createMediaElementSource(){sources++;return {connect(){},disconnect(){}};},createGain(){return {gain:{value:0,setTargetAtTime(){},cancelScheduledValues(){},setValueAtTime(){}},connect(){},disconnect(){}};}} as unknown as AudioContext;
  const music=new TempleMusic({createElement:()=>audio} as unknown as Document,()=>true);
  music.attach(context,{} as AudioNode);music.gesture();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(music.playing,false);assert.equal(music.reserved,false);assert.notEqual(music.getState().error,'');assert.equal(loads,0);
  music.sync();await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,0);
  music.gesture();await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,1);assert.equal(music.playing,true);assert.equal(music.reserved,true);assert.equal(music.getState().error,'');assert.equal(sources,1);
  music.destroy();assert.equal(music.reserved,false);
});
test('cascade presentation preserves all confirmed frames, integer counters and stable gravity through free spins and operation boundaries',()=>{
  let falls=0,returns=0,bonuses=0,continued=0;
  for(let sample=1;sample<=2048;sample++){
    const seed=(sample*2654435761)>>>0;
    let prior:TempleCascadeView|undefined;
    for(const view of views(seed)){
      if(prior)continued++;
      const immutable=JSON.stringify(view),plan=cascadePlan(seed+':'+view.revision,view,prior);
      assert.deepEqual(plan.beats.filter(b=>b.kind==='drop').map(b=>b.frame),view.frames);
      let total=prior?.state.totalPoints??0;
      for(const beat of plan.beats){
        assert.equal(beat.fromPoints,total);assert.equal(cascadeCounter(beat,0),total);assert.equal(cascadeCounter(beat,beat.duration),beat.toPoints);
        assert(beat.toPoints>=total);total=beat.toPoints;
        if(beat.kind==='drop'){
          falls++;assert.equal(beat.moves.length,15);assert.equal(beat.accentMs,Math.max(...beat.moves.filter(m=>m.rows).map(m=>cascadeLandMs(m.cell))));
          for(const move of beat.moves)if(move.from!==null){assert.equal(Math.floor(move.from/3),Math.floor(move.cell/3));assert(move.cell>=move.from);assert.equal(move.rows,move.cell-move.from);}
        }
        if(beat.kind==='break'){const before=plan.beats[beat.id-1];assert(beat.grid);assert(beat.removeMask);if(before?.kind!=='base-return')assert.equal(beat.frame.mode,before?.frame.mode??prior?.frames.at(-1)?.mode);}
        if(beat.kind==='base-return'){returns++;assert.equal(beat.frame.mode,'base');assert(beat.grid);assert.equal(plan.beats[beat.id+1].kind,'break');}
        if(beat.kind==='bonus'){bonuses++;assert(beat.frame.addedFreeSpins>0);assert.equal(templeReaction(cascadeCharacter(beat)).pose,'discover');}
        if(beat.kind!=='outcome')assert.notEqual(templeReaction(cascadeCharacter(beat)).pose,'celebrate');
      }
      assert.equal(total,view.state.totalPoints);assert.equal(JSON.stringify(view),immutable);prior=view;
    }
  }
  assert(falls>2048&&returns>0&&bonuses>0&&continued>0,JSON.stringify({falls,returns,bonuses,continued}));
});
test('gravity mapping retains survivors in order and creates exactly the union vacancies',()=>{
  const source={grid:[0,1,2,3,4,5,6,1,2,3,4,5,6,0,1],removeMask:(1<<0)|(1<<2)|(1<<7)};
  const grid=[4,5,1,3,4,5,0,6,2,3,4,5,6,0,1],moves=cascadeMoves(source,grid);
  assert.deepEqual(moves.filter(m=>m.from===null).map(m=>m.cell),[0,1,6]);assert.deepEqual(moves.find(m=>m.from===1),{cell:2,from:1,rows:1});assert.deepEqual(moves.find(m=>m.from===6),{cell:7,from:6,rows:1});
  assert.throws(()=>cascadeMoves(source,Array(15).fill(0)),/survivor/);
});
test('quick and reduced feedback preserve the full result and never celebrate partial returns or recovery',()=>{
  const view=Array.from(views(15)).at(-1)!;assert.equal(view.totalPayoutUnits,'250');
  for(const [quick,reduced]of[[true,false],[false,true],[true,true]]){
    const plan=cascadePlan('quiet',view,undefined,quick,reduced);assert.equal(plan.beats.length,1);assert.equal(plan.final,view.frames.at(-1));assert.equal(plan.beats[0].outcome,'partial');assert.equal(plan.beats[0].cue,'neutral');assert.equal(templeReaction(cascadeCharacter(plan.beats[0])).pose,'reflect');assert.equal(plan.beats[0].toPoints,view.state.totalPoints);
  }
  assert.equal(templeReaction(undefined).pose,'idle');
});
test('cascade Foley is reproducible licensed PCM, has soft boundaries and measured main transients',()=>{
  const manifest=JSON.parse(readFileSync('games/flooded-temple/cascadeSounds.json','utf8'));
  for(const name of Object.keys(cascadeCueSpecs)){
    const audio=renderCascadeCue(name),spec=manifest.cues[name],bytes=readFileSync('public/assets/flooded-temple/audio/'+spec.file);
    assert(bytes.equals(wav(audio.channels)));assert.equal(bytes.readUInt32LE(24),48000);assert.equal(audio.accent,spec.accent);assert.deepEqual(metrics(audio.channels),{peak:spec.peak,rms:spec.rms});assert(spec.peak<=.241&&spec.rms>.001);
    for(const channel of audio.channels){assert(Math.abs(channel[0])<.0001);assert(Math.abs(channel.at(-1)!)<.001);assert(channel.every(Number.isFinite));}
  }
});
test('representative dense cascade mixes retain headroom with bounded overlapping voices',()=>{
  let highest=0;
  const bank=new Map(Object.keys(cascadeCueSpecs).map(name=>[name,renderCascadeCue(name)]));for(const name of['neutral','return','win','big'])bank.set(name,renderCue(name));
  for(const seed of[15,118,351])for(const view of views(seed)){
    const plan=cascadePlan('mix',view),mix=[new Float32Array(Math.ceil((plan.duration/1000+3)*rate)),new Float32Array(Math.ceil((plan.duration/1000+3)*rate))];
    const intervals:number[][]=[];
    for(const beat of plan.beats){if(!beat.cue)continue;const audio=bank.get(beat.cue)!;const start=.3+(beat.at+beat.accentMs)/1000-audio.accent;intervals.push([start,start+audio.duration]);
      for(let c=0;c<2;c++)for(let i=0;i<audio.channels[c].length;i++){const at=Math.floor(start*rate)+i;if(at>=0&&at<mix[c].length)mix[c][at]+=audio.channels[c][i]*.9;}
    }
    const water=renderCue('ambience');for(let c=0;c<2;c++)for(let i=0;i<mix[c].length;i++)mix[c][i]+=water.channels[c][i%water.channels[c].length]*.24*.9;
    highest=Math.max(highest,metrics(mix).peak);for(const [start]of intervals)assert(intervals.filter(([a,b])=>a<=start&&b>start).length<=3);
  }
  assert(highest<.65);
});
