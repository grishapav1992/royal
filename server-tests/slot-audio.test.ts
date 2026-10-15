import test from 'node:test';
import assert from 'node:assert/strict';
import {SlotAudio,type SlotCue,type SlotAudioGame} from '../src/game/SlotAudio';
import {GameAudio} from '../src/game/GameAudio';

class Parameter {
  value=0;
  events:{kind:string;value?:number;at:number}[]=[];
  setValueAtTime(value:number,at:number){this.value=value;this.events.push({kind:'set',value,at});}
  linearRampToValueAtTime(value:number,at:number){this.events.push({kind:'linear',value,at});}
  exponentialRampToValueAtTime(value:number,at:number){this.events.push({kind:'exponential',value,at});}
  setTargetAtTime(value:number,at:number){this.value=value;this.events.push({kind:'target',value,at});}
  cancelAndHoldAtTime(at:number){this.events.push({kind:'hold',at});}
  cancelScheduledValues(at:number){this.events.push({kind:'cancel',at});}
}
class Node {
  disconnected=false;
  target?:unknown;
  connect(target:unknown){this.target=target;}
  disconnect(){this.disconnected=true;}
}
class Gain extends Node {gain=new Parameter();}
class Source extends Node {
  type='sine';frequency=new Parameter();loop=false;buffer:unknown;
  startAt?:number;stopAt:number[]=[];onended?:()=>void;
  start(at=0){this.startAt=at;}
  stop(at:number){this.stopAt.push(at);}
  setPeriodicWave(_wave:unknown){this.type='custom';}
}
class Context extends EventTarget {
  currentTime=0;sampleRate=8000;state='running';destination=new Node();resumeCount=0;
  sources:Source[]=[];
  createGain(){return new Gain();}
  createOscillator(){const source=new Source();this.sources.push(source);return source;}
  createBufferSource(){const source=new Source();this.sources.push(source);return source;}
  createBuffer(_channels:number,length:number,_sampleRate:number){const data=new Float32Array(length);return {getChannelData:()=>data};}
  createPeriodicWave(real:Float32Array,imag:Float32Array){return {real,imag};}
  createBiquadFilter(){return Object.assign(new Node(),{type:'lowpass',frequency:new Parameter(),Q:new Parameter()});}
  createStereoPanner(){return Object.assign(new Node(),{pan:new Parameter()});}
  createDelay(){return Object.assign(new Node(),{delayTime:new Parameter()});}
  createDynamicsCompressor(){return Object.assign(new Node(),{threshold:new Parameter(),ratio:new Parameter()});}
  createAnalyser(){return Object.assign(new Node(),{fftSize:256,getFloatTimeDomainData:(data:Float32Array)=>data.fill(0)});}
  async resume(){this.resumeCount++;this.state='running';this.dispatchEvent(new Event('statechange'));}
  async suspend(){this.state='suspended';this.dispatchEvent(new Event('statechange'));}
  advance(at:number){this.currentTime=at;for(const source of this.sources)if(source.stopAt.at(-1)!<=at&&source.onended){const ended=source.onended;source.onended=undefined;ended();}}
}
async function flush(){await Promise.resolve();await Promise.resolve();}
function fixture(unlock:()=>Promise<void>=()=>Promise.resolve(),game:SlotAudioGame='studio-neon-crown') {
  const context=new Context(),output=new Gain(),played:SlotCue[]=[],duck:boolean[]=[];
  let enabled=true,canceled=0,disposed=0;
  const slot=new SlotAudio({context:()=>context as unknown as BaseAudioContext,output:()=>output as unknown as AudioNode,
    enabled:()=>enabled,unlock,reducedMotion:()=>false,duck:value=>duck.push(value),played:cue=>played.push(cue),
    canceled:()=>{canceled++;},disposed:()=>{disposed++;}},game);
  return {slot,context,played,duck,setEnabled:(value:boolean)=>{enabled=value;},canceled:()=>canceled,disposed:()=>disposed};
}

test('live spin plays each stop, winning line and outcome once in presentation order',async()=>{
  const f=fixture();try{
    f.slot.begin('round-1');await flush();f.slot.begin('round-1');await flush();
    assert.equal(f.slot.getState().looping,true);assert.deepEqual(f.played,['click']);
    f.slot.outcome('round-1','bigwin');assert.equal(f.slot.getState().finished,false);
    for(const index of [0,0,1,2,2,-1,3])f.slot.stopReel('round-1',index);
    assert.equal(f.slot.getState().looping,false);
    f.slot.line('round-1',0);f.slot.line('round-1',0);f.slot.line('round-1',4);
    f.slot.outcome('round-1','win');f.slot.outcome('round-1','bigwin');f.slot.line('round-1',1);
    assert.deepEqual(f.played,['click','reel-stop','reel-stop','reel-stop','line','line','win']);
    assert.equal(f.slot.getState().finished,true);
    for(const source of f.context.sources){assert.equal(source.type,'sine');for(const event of source.frequency.events)assert.ok(event.value!<=523.25);}
  }finally{f.slot.dispose();}
});

test('cancel silences already scheduled future melody notes and stale handles cannot stop a new round',async()=>{
  const f=fixture();try{
    f.slot.begin('old');await flush();for(let i=0;i<3;i++)f.slot.stopReel('old',i);f.slot.outcome('old','bigwin');
    const old=f.context.sources.slice();assert.ok(old.some(source=>source.startAt!>.5));
    f.context.currentTime=.08;f.slot.cancel('old');
    assert.equal(f.slot.getState().activeSources,0);assert.equal(f.slot.getState().looping,false);assert.equal(f.canceled(),1);
    for(const source of old)assert.ok(source.stopAt.at(-1)!<=.111,'future voices must also stop within the cancel fade');
    f.slot.begin('fresh');await flush();const fresh=f.context.sources.slice(old.length);
    f.slot.cancel('old');assert.equal(f.slot.getState().token,'fresh');assert.equal(f.slot.getState().looping,true);
    assert.ok(fresh.some(source=>!source.stopAt.length));
    f.slot.dispose();f.slot.dispose();assert.equal(f.disposed(),1);assert.equal(f.slot.getState().activeSources,0);
  }finally{f.slot.dispose();}
});

test('cancel during browser unlock cannot create sounds later',async()=>{
  let resume!:()=>void;const f=fixture(()=>new Promise<void>(resolve=>{resume=resolve;}));
  try{f.slot.begin('pending');f.slot.cancel();resume();await flush();assert.equal(f.context.sources.length,0);assert.deepEqual(f.played,[]);}
  finally{f.slot.dispose();}
});

test('a future note starting inside the cancel fade is muted immediately without a default-gain spike',async()=>{
  const f=fixture(undefined,'studio-caramel-carnival');try{
    f.slot.beginCascade('refill');await flush();f.slot.confirmCascade('refill');f.slot.effect('refill','refill','frame:refill');
    f.context.currentTime=.04;const future=f.context.sources.filter(source=>source.startAt!>.04);
    assert.ok(future.some(source=>source.startAt!<.065));f.slot.cancel('refill');
    for(const source of future){assert.equal(source.stopAt.at(-1),.04);assert.ok((source.target as Gain).gain.events.some(event=>event.kind==='set'&&event.at===.04&&event.value===0));}
  }finally{f.slot.dispose();}
});

test('muted spins do not replay on unmute and static presentation has no motor, stop or line cues',async()=>{
  const f=fixture();try{
    f.setEnabled(false);f.slot.begin('silent');await flush();assert.deepEqual(f.played,[]);
    f.setEnabled(true);f.slot.begin('silent');await flush();assert.deepEqual(f.played,[]);
    f.slot.begin('static',{motion:false});await flush();assert.equal(f.slot.getState().looping,false);
    for(let i=0;i<3;i++)f.slot.stopReel('static',i);f.slot.line('static',0);f.slot.outcome('static','return');
    assert.deepEqual(f.played,['click','return']);
  }finally{f.slot.dispose();}
});

function gameFixture(initial:Record<string,string>={}) {
  const original=new Map<string,PropertyDescriptor|undefined>(),keys=['document','localStorage','AudioContext','matchMedia'];
  for(const key of keys)original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  const document=Object.assign(new EventTarget(),{hidden:false}),store=new Map(Object.entries(initial));
  const context=new Context();
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)}});
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:class {constructor(){return context;}}});
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:false})});
  const audio=new GameAudio();audio.install();audio.setGame('studio-neon-crown');
  const restore=()=>{audio.setMuted(true);for(const key of keys){const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}};
  return {audio,context,document,store,restore};
}

test('global preferences persist and mute or zero volume cancels the current owner without replay',async()=>{
  const f=gameFixture({'royal-volume':'.42','royal-muted':'0','royal-casino-ambience':'0'});
  const owner=f.audio.createSlotAudio('studio-neon-crown');try{
    assert.deepEqual(f.audio.getPreferences(),{muted:false,volume:.42,casinoEnabled:false});
    const changes:{muted:boolean;volume:number}[]=[];const unsubscribe=f.audio.onPreferences(value=>changes.push(value));
    owner.begin('a');await flush();assert.equal(f.audio.getState().slot.loopOwners,1);
    f.audio.setMuted(true);assert.equal(f.audio.getState().slot.activeSources,0);assert.equal(f.store.get('royal-muted'),'1');
    f.audio.setMuted(false);owner.begin('a');await flush();assert.equal(f.audio.getState().slot.played.click,1);
    owner.begin('b');await flush();f.audio.setVolume(0);assert.equal(f.audio.getState().slot.loopOwners,0);
    assert.equal(f.store.get('royal-volume'),'0');assert.equal(f.store.get('royal-casino-ambience'),'0');
    f.audio.setVolume(.28);assert.equal(f.audio.output!.gain.value,.28);assert.equal(f.audio.getPreferences().volume,.28);
    const count=changes.length;unsubscribe();f.audio.setVolume(.3);assert.equal(changes.length,count);
    for(const value of [-1,2,NaN,Infinity])assert.throws(()=>f.audio.setVolume(value),RangeError);
  }finally{owner.dispose();f.restore();}
});

test('hidden and interrupted contexts cancel the owner, resume is silent until a fresh spin',async()=>{
  const f=gameFixture(),owner=f.audio.createSlotAudio('studio-neon-crown');try{
    owner.begin('a');await flush();assert.equal(f.audio.getState().slot.loopOwners,1);
    f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));await flush();
    assert.equal(f.context.state,'suspended');assert.equal(f.audio.getState().slot.activeSources,0);
    f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));await flush();
    assert.equal(f.context.state,'running');assert.equal(f.context.resumeCount,1);assert.equal(f.audio.getState().slot.played.click,1);
    owner.begin('b');await flush();f.context.state='interrupted';f.context.dispatchEvent(new Event('statechange'));
    assert.equal(f.audio.getState().slot.loopOwners,0);await f.audio.unlock();assert.equal(f.context.resumeCount,2);
    assert.equal(f.audio.getState().slot.played.click,2);assert.equal(f.audio.getState().slot.activeSources,0);
  }finally{owner.dispose();f.restore();}
});

test('Neon ducks hall noise only while the owner is active and disposal restores existing game levels',async()=>{
  const f=gameFixture(),owner=f.audio.createSlotAudio('studio-neon-crown');try{
    await f.audio.unlock();assert.equal(f.audio.getState().casino.level,.2);
    owner.begin('a');await flush();assert.ok(Math.abs(f.audio.getState().casino.level-.044)<1e-8);
    owner.cancel();assert.equal(f.audio.getState().casino.level,.2);
    owner.begin('b');await flush();f.audio.setGame('fruits');assert.equal(f.audio.getState().casino.level,.2);
    assert.equal(f.audio.getState().slot.loopOwners,0);owner.dispose();assert.equal(f.audio.getState().slot.owners,0);
    assert.throws(()=>f.audio.createSlotAudio('fruits' as 'studio-neon-crown'),RangeError);
  }finally{owner.dispose();f.restore();}
});

test('five-reel slots wait for the fifth stop, deduplicate effects and preserve semantic presentation order',async()=>{
  for(const game of ['studio-cosmic-escape','studio-velvet-reign'] as const){
    const f=fixture(undefined,game);try{
      f.slot.begin('confirmed-stage');await flush();
      f.slot.effect('confirmed-stage','free-stage','unconfirmed');
      for(let index=0;index<4;index++){f.context.advance((index+1)*.3);f.slot.stopReel('confirmed-stage',index);}
      f.slot.stopReel('confirmed-stage',3);f.slot.stopReel('confirmed-stage',5);f.slot.outcome('confirmed-stage','win');
      assert.equal(f.slot.getState().looping,true);assert.equal(f.slot.getState().finished,false);assert.equal(f.played.includes('free-stage'),false);
      f.context.advance(1.5);f.slot.stopReel('confirmed-stage',4);assert.equal(f.slot.getState().looping,false);
      for(const [index,kind] of (['free-stage','expand','sticky','multiplier'] as const).entries()){
        f.context.advance(1.9+index*.5);f.slot.effect('confirmed-stage',kind,'event-'+index);f.slot.effect('confirmed-stage',kind,'event-'+index);
      }
      f.context.advance(4);f.slot.line('confirmed-stage',game==='studio-cosmic-escape'?19:13);
      f.slot.line('confirmed-stage',game==='studio-cosmic-escape'?20:14);
      f.context.advance(4.4);f.slot.outcome('confirmed-stage','win');f.slot.effect('confirmed-stage','expand','finished');
      assert.deepEqual(f.played,['click','reel-stop','reel-stop','reel-stop','reel-stop','reel-stop','free-stage','expand','sticky','multiplier','line','win']);
      f.slot.cancel();assert.equal(f.slot.getState().activeSources,0);
    }finally{f.slot.dispose();}
  }
});

test('five-reel static, cancellation and reused effect identities are scoped to a fresh visual stage',async()=>{
  const f=fixture(undefined,'studio-velvet-reign');try{
    f.slot.begin('static',{motion:false});await flush();f.slot.effect('static','sticky','saved-cell');f.slot.outcome('static','return');
    assert.deepEqual(f.played,['click','return']);
    for(const token of ['bonus-1','bonus-2']){
      f.slot.begin(token);await flush();for(let index=0;index<5;index++){f.context.advance(f.context.currentTime+.3);f.slot.stopReel(token,index);}
      f.context.advance(f.context.currentTime+.3);f.slot.effect(token,'sticky','same-cell');
      f.slot.cancel(token);assert.equal(f.slot.getState().looping,false);assert.equal(f.slot.getState().activeSources,0);
    }
    assert.equal(f.played.filter(cue=>cue==='sticky').length,2);f.slot.effect('bonus-1','sticky','stale');
    assert.equal(f.played.filter(cue=>cue==='sticky').length,2);
  }finally{f.slot.dispose();}
});

test('diagnostics separate the games and switching slot ownership cancels only the old palette',async()=>{
  const f=gameFixture(),neon=f.audio.createSlotAudio('studio-neon-crown'),cosmic=f.audio.createSlotAudio('studio-cosmic-escape');
  try{
    neon.begin('neon');await flush();assert.equal(f.audio.getState().slot.byGame['studio-neon-crown'].played.click,1);
    f.audio.setGame('studio-cosmic-escape');assert.equal(neon.getState().looping,false);
    cosmic.begin('cosmic');await flush();f.audio.setGame('studio-cosmic-escape');assert.equal(cosmic.getState().looping,true);
    const state=f.audio.getState().slot;assert.equal(state.played.click,2);assert.equal(state.byGame['studio-cosmic-escape'].played.click,1);
    assert.equal(state.byGame['studio-neon-crown'].canceled,1);assert.equal(state.byGame['studio-velvet-reign'].owners,0);
    f.audio.setMuted(true);assert.equal(cosmic.getState().activeSources,0);assert.equal(f.audio.getState().slot.byGame['studio-cosmic-escape'].canceled,1);
  }finally{neon.dispose();cosmic.dispose();f.restore();}
});

test('presentation effects consume no outcome randomness and send no money or network operation',async()=>{
  const originalRandom=Math.random,originalFetch=globalThis.fetch;
  Math.random=()=>{throw Error('Outcome randomness must not be requested by presentation');};
  globalThis.fetch=()=>{throw Error('Presentation must not send a monetary operation');};
  const f=fixture(undefined,'studio-cosmic-escape');try{
    f.slot.begin('stage');await flush();for(let index=0;index<5;index++){f.context.advance((index+1)*.3);f.slot.stopReel('stage',index);}
    for(const [index,kind] of (['free-stage','expand','multiplier'] as const).entries()){
      f.context.advance(2+index*.5);f.slot.effect('stage',kind,'saved-event-'+index);
    }
    f.context.advance(4);f.slot.outcome('stage','return');assert.equal(f.played.at(-1),'return');
  }finally{f.slot.dispose();Math.random=originalRandom;globalThis.fetch=originalFetch;}
});

test('six-reel bases reveal groups only after the sixth real stop, without invented paylines',async()=>{
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
    const f=fixture(undefined,game);try{
      f.slot.begin('base');await flush();for(let i=0;i<5;i++){f.context.advance((i+1)*.3);f.slot.stopReel('base',i);}
      f.slot.group('base',0);f.slot.outcome('base','win');assert.equal(f.slot.getState().looping,true);assert.equal(f.slot.getState().finished,false);
      f.context.advance(1.8);f.slot.stopReel('base',5);f.slot.stopReel('base',5);f.slot.stopReel('base',6);assert.equal(f.slot.getState().looping,false);
      for(let index=0;index<3;index++){f.context.advance(2.2+index*.4);f.slot.group('base',index);f.slot.group('base',index);}
      f.slot.group('base',3);f.slot.line('base',0);f.context.advance(3.5);f.slot.outcome('base','win');
      assert.deepEqual(f.played,['click',...Array(6).fill('reel-stop'),...Array(3).fill('group'),'win']);
    }finally{f.slot.dispose();}
  }
});

test('a cascade is silent while waiting, has no fake spin and requires confirmation plus final refill',async()=>{
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
    const f=fixture(undefined,game);try{
      f.slot.beginCascade('cascade');await flush();assert.equal(f.context.sources.length,0);assert.equal(f.slot.getState().looping,false);
      f.slot.effect('cascade','collapse','old');f.slot.group('cascade',0);f.slot.outcome('cascade','win');for(let i=0;i<6;i++)f.slot.stopReel('cascade',i);
      assert.deepEqual(f.played,[]);assert.equal(f.slot.getState().finished,false);
      f.slot.confirmCascade('cascade');
      for(const [index,kind] of (['collapse','drop','refill'] as const).entries()){
        f.context.advance(index*.4);f.slot.effect('cascade',kind,'frame:'+index);f.slot.effect('cascade',kind,'frame:'+index);
      }
      f.slot.group('cascade',0);f.slot.outcome('cascade','return');assert.equal(f.slot.getState().finished,false);
      f.slot.settleCascade('cascade');f.context.advance(1.5);f.slot.group('cascade',0);f.slot.group('cascade',0);
      f.slot.effect('cascade','collapse','finished-transform');f.slot.effect('cascade','orb','factor16');f.context.advance(1.9);f.slot.outcome('cascade','return');
      assert.deepEqual(f.played,['collapse','drop','refill','group',...(game==='studio-starfall-oracle'?['orb']:[]),'return']);
      assert.equal(f.played.includes('click'),false);assert.equal(f.played.includes('reel-stop'),false);assert.equal(f.played.includes('bigwin'),false);
    }finally{f.slot.dispose();}
  }
});

test('static cascade fallback and canceled pending metadata never replay transformations',async()=>{
  const f=fixture(undefined,'studio-starfall-oracle');try{
    f.slot.beginCascade('static',{motion:false});await flush();f.slot.confirmCascade('static');f.slot.effect('static','collapse','remove');f.slot.group('static',0);
    f.slot.outcome('static','return');assert.deepEqual(f.played,[]);f.slot.settleCascade('static');f.slot.outcome('static','return');assert.deepEqual(f.played,['return']);
    f.slot.beginCascade('pending');await flush();f.slot.cancel('pending');f.slot.confirmCascade('pending');f.slot.settleCascade('pending');f.slot.effect('pending','refill','stale');f.slot.outcome('pending','win');
    assert.deepEqual(f.played,['return']);assert.equal(f.slot.getState().activeSources,0);
    f.slot.beginCascade('fresh');await flush();f.slot.settleCascade('fresh');f.slot.group('fresh',0);f.slot.outcome('fresh','return');
    assert.deepEqual(f.played,['return','group','return']);
  }finally{f.slot.dispose();}
});

test('global mute and account-style owner disposal cancel cascade accents and deferred melodies',async()=>{
  const f=gameFixture(),owner=f.audio.createSlotAudio('studio-caramel-carnival');try{
    f.audio.setGame('studio-caramel-carnival');owner.beginCascade('cascade');await flush();assert.equal(f.audio.getState().slot.byGame['studio-caramel-carnival'].loopOwners,0);
    owner.confirmCascade('cascade');owner.effect('cascade','refill','new-cells');owner.settleCascade('cascade');owner.outcome('cascade','win');
    const started=f.context.sources.slice();assert.ok(started.some(source=>source.startAt!>.5));f.audio.setMuted(true);
    assert.equal(owner.getState().activeSources,0);assert.equal(f.audio.getState().slot.byGame['studio-caramel-carnival'].canceled,1);
    owner.dispose();assert.equal(f.audio.getState().slot.byGame['studio-caramel-carnival'].owners,0);
  }finally{owner.dispose();f.restore();}
});

test('cluster paid and free spins keep six real stops while only paid begin plays a click',async()=>{
  const f=fixture(undefined,'studio-prism-atelier');try{
    f.slot.begin('paid');await flush();for(let i=0;i<5;i++){f.context.advance(.3+i*.3);f.slot.stopReel('paid',i);}
    f.slot.group('paid',3);f.slot.effect('paid','cell-values','cells');f.slot.outcome('paid','win');assert.equal(f.played.includes('group'),false);assert.equal(f.slot.getState().finished,false);
    f.context.advance(1.8);f.slot.stopReel('paid',5);f.context.advance(2.2);f.slot.effect('paid','cell-values','cells');f.slot.effect('paid','cell-values','cells');
    f.slot.effect('paid','collect','not-prism');f.slot.effect('paid','collapse','not-a-cascade');f.slot.effect('paid','expand','not-a-wild');
    for(const index of [0,1,2,3,3,4,-1]){f.context.advance(f.context.currentTime+.35);f.slot.group('paid',index);}
    f.slot.outcome('paid','bigwin');f.slot.effect('paid','cell-values','late');assert.deepEqual(f.played,['click',...Array(6).fill('reel-stop'),'cell-values',...Array(4).fill('group'),'bigwin']);
    f.slot.begin('free',{click:false});await flush();assert.equal(f.slot.getState().looping,true);assert.equal(f.played.filter(cue=>cue==='click').length,1);
    for(let i=0;i<6;i++){f.context.advance(f.context.currentTime+.3);f.slot.stopReel('free',i);}f.context.advance(f.context.currentTime+.3);f.slot.effect('free','free-stage','saved:1');f.slot.outcome('free','return');
    assert.equal(f.played.filter(cue=>cue==='reel-stop').length,12);assert.equal(f.played.filter(cue=>cue==='free-stage').length,1);assert.equal(f.played.at(-1),'return');
  }finally{f.slot.dispose();}
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){const old=fixture(undefined,game);try{old.slot.beginCascade('old');await flush();old.slot.settleCascade('old');old.slot.group('old',3);assert.deepEqual(old.played,[]);}finally{old.slot.dispose();}}
});

test('forest collectors have distinct deduplicated accents and never play prism or cascade effects',async()=>{
  const f=fixture(undefined,'studio-lumen-grove');try{
    f.slot.begin('forest',{click:false});await flush();for(let i=0;i<6;i++){f.context.advance(.3+i*.3);f.slot.stopReel('forest',i);}f.context.advance(2.2);
    const start=f.context.sources.length;f.slot.effect('forest','collect','collector:7');const first=f.context.sources.slice(start).filter(source=>source.type==='custom').map(source=>source.frequency.events[0].value);
    const next=f.context.sources.length;f.slot.effect('forest','collect','collector:7');assert.equal(f.context.sources.length,next);f.slot.effect('forest','collect','collector:9');const second=f.context.sources.slice(next).filter(source=>source.type==='custom').map(source=>source.frequency.events[0].value);
    assert.notDeepEqual(first,second);f.slot.effect('forest','collect','third-invalid');f.slot.effect('forest','cell-values','invalid');f.slot.effect('forest','drop','invalid');f.slot.group('forest',3);
    assert.equal(f.played.filter(cue=>cue==='collect').length,2);assert.equal(f.played.includes('cell-values'),false);assert.equal(f.played.includes('group'),false);
    f.slot.begin('next',{click:false});await flush();for(let i=0;i<6;i++){f.context.advance(f.context.currentTime+.3);f.slot.stopReel('next',i);}f.context.advance(f.context.currentTime+.3);f.slot.effect('next','collect','collector:7');assert.equal(f.played.filter(cue=>cue==='collect').length,3);
  }finally{f.slot.dispose();}
});

test('reduced cluster presentation keeps one short classified outcome and suppresses every animated cue',async()=>{
  for(const game of ['studio-lumen-grove','studio-prism-atelier'] as const){const f=fixture(undefined,game);try{
    f.slot.begin('static',{motion:false,click:false});await flush();assert.equal(f.context.sources.length,0);
    for(let i=0;i<6;i++)f.slot.stopReel('static',i);f.slot.group('static',0);f.slot.effect('static','collect','collector');f.slot.effect('static','cell-values','cells');f.slot.effect('static','free-stage','free');f.slot.outcome('static','bigwin');f.slot.outcome('static','bigwin');
    assert.deepEqual(f.played,['bigwin']);assert.equal(f.context.sources.length,3);assert.ok(f.context.sources.every(source=>source.startAt!<=.08&&source.stopAt[0]<.41));assert.equal(f.slot.getState().looping,false);
  }finally{f.slot.dispose();}}
});

test('cluster mute, hidden and switching ownership cancel motor and future music without replay',async()=>{
  const f=gameFixture(),owner=f.audio.createSlotAudio('studio-lumen-grove');try{
    f.audio.setGame('studio-lumen-grove');owner.begin('live',{click:false});await flush();assert.equal(f.audio.getState().slot.byGame['studio-lumen-grove'].loopOwners,1);
    f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(owner.getState().activeSources,0);f.document.hidden=false;
    owner.begin('live',{click:false});await flush();assert.equal(owner.getState().activeSources,0);owner.begin('new');await flush();for(let i=0;i<6;i++){f.context.advance(.3+i*.3);owner.stopReel('new',i);}f.context.advance(2.2);owner.outcome('new','bigwin');assert.ok(f.context.sources.some(source=>source.startAt!>3));
    f.audio.setMuted(true);assert.equal(owner.getState().activeSources,0);f.audio.setMuted(false);owner.begin('fresh',{click:false});await flush();assert.equal(owner.getState().looping,true);f.audio.setGame('studio-prism-atelier');assert.equal(owner.getState().activeSources,0);assert.equal(f.audio.getState().slot.byGame['studio-lumen-grove'].loopOwners,0);
  }finally{owner.dispose();f.restore();}
});

test('cluster reduced-motion transition and pending unlock cancel every old voice before a fresh static outcome',async()=>{
  let unlock!:()=>void;const pending=fixture(()=>new Promise<void>(resolve=>{unlock=resolve;}),'studio-prism-atelier');try{
    pending.slot.begin('waiting',{click:false});pending.slot.cancel('waiting');unlock();await flush();assert.equal(pending.context.sources.length,0);
  }finally{pending.slot.dispose();}
  const f=fixture(undefined,'studio-prism-atelier');try{
    f.slot.begin('moving',{click:false});await flush();for(let i=0;i<6;i++){f.context.advance(.3+i*.3);f.slot.stopReel('moving',i);}f.context.advance(2.2);f.slot.effect('moving','cell-values','cells');f.slot.outcome('moving','bigwin');
    f.context.currentTime=2.24;f.slot.cancel('moving');assert.equal(f.slot.getState().activeSources,0);for(const source of f.context.sources.filter(source=>source.startAt!>2.24))assert.equal(source.stopAt.at(-1),2.24);
    f.slot.begin('static',{motion:false,click:false});await flush();f.slot.outcome('static','return');assert.equal(f.played.at(-1),'return');assert.equal(f.played.filter(cue=>cue==='click').length,0);assert.equal(f.slot.getState().looping,false);
  }finally{f.slot.dispose();}
});
