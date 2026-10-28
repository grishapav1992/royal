import test from 'node:test';
import assert from 'node:assert/strict';
import { FlagAudio, type FlagAudioPorts } from '../games/flag-battle/FlagAudio';
import { flagSoundTimeline, type FlagSoundEvent } from '../games/flag-battle/FlagSoundTimeline';
import { planFlagPhysics } from '../games/flag-battle/FlagPhysics';
import { FLAG_COUNTRIES } from '../src/shared/flagBattle';
class Param { value=0;setValueAtTime(){return this;}linearRampToValueAtTime(){return this;}exponentialRampToValueAtTime(){return this;} }
class AudioNodeStub {
  gain=new Param();pan=new Param();frequency=new Param();Q=new Param();threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  onended:(()=>void)|null=null; stopped=false;disconnected=false;at=0;endAt=0;loop=false;type='sine';buffer:unknown;
  connect(node:AudioNodeStub){return node;}disconnect(){this.disconnected=true;}start(at:number){this.at=at;}stop(at?:number){if(at===undefined)this.stopped=true;else this.endAt=at;}
}
function fixture(){
  let allowed=true,now=1000,listener=()=>{},unsubscribed=false;
  const sources:AudioNodeStub[]=[];
  const context=Object.assign(new EventTarget(),{currentTime:1,sampleRate:48000,state:'running',baseLatency:.01,outputLatency:.03,
    createGain:()=>new AudioNodeStub(),createDynamicsCompressor:()=>new AudioNodeStub(),createStereoPanner:()=>new AudioNodeStub(),createBiquadFilter:()=>new AudioNodeStub(),
    createOscillator:()=>{const node=new AudioNodeStub();sources.push(node);return node;},createBufferSource:()=>{const node=new AudioNodeStub();sources.push(node);return node;},
    createBuffer:(_c:number,length:number)=>({getChannelData:()=>new Float32Array(length)}),getOutputTimestamp:()=>({contextTime:now/1000-.04,performanceTime:now})});
  const ports:FlagAudioPorts={context:()=>context as unknown as BaseAudioContext,output:()=>new AudioNodeStub() as unknown as AudioNode,allowed:()=>allowed,unlock:async()=>{},subscribe:cb=>{listener=cb;return()=>{unsubscribed=true;};},now:()=>now};
  const audio=new FlagAudio(ports);
  return {audio,context,sources,set:(seconds:number)=>{now=seconds*1000;context.currentTime=seconds;},mute:(value:boolean)=>{allowed=!value;listener();},unsubscribed:()=>unsubscribed};
}
const event=(cue:FlagSoundEvent['cue'],at:number):FlagSoundEvent=>({cue,at,strength:1,pan:0,variant:0});

test('sound timeline follows every physical exit and limits the density of impacts',()=>{
  const plan=planFlagPhysics(93),labels=FLAG_COUNTRIES.map(c=>c.id),selected=labels[plan.order[3]];
  const events=flagSoundTimeline(plan,labels,selected,false,20),exits=events.filter(e=>e.cue==='eliminate');
  assert.equal(exits.length,11);assert.equal(exits.filter(e=>e.variant===-1).length,1);
  assert(events.some(e=>e.cue==='collision'));assert(events.some(e=>e.cue==='wall'));assert.equal(events.filter(e=>e.cue==='final-two').length,1);
  assert.equal(events.at(-1)!.cue,'lose');assert(!events.some(e=>e.cue==='win'));
  const impacts=events.filter(e=>e.cue==='wall'||e.cue==='collision');
  assert.equal(new Set(impacts.map(e=>Math.floor(e.at/.18))).size,impacts.length);
  assert(impacts.every(e=>exits.every(exit=>Math.abs(e.at-exit.at)>=.12)));
  for(let i=1;i<impacts.length;i++)assert(impacts[i].at-impacts[i-1].at>=.16-1e-9);
  const finalTwo=events.find(e=>e.cue==='final-two')!;
  assert(impacts.every(e=>Math.abs(e.at-finalTwo.at)>=.15));
  for(let i=1;i<events.length;i++)assert(events[i].at>=events[i-1].at);
  assert.equal(flagSoundTimeline(plan,labels,selected,true,20).at(-1)!.cue,'win');
});
test('effects use short non-looping simultaneous layers without a melody sequence',async()=>{
  const cues:FlagSoundEvent['cue'][]=['select','start','collision','wall','eliminate','final-two','win','lose'];
  for(const cue of cues){
    const f=fixture();await f.audio.unlock();f.audio.playAt(event(cue,0),1.01);
    assert(f.sources.length>0&&f.sources.length<=2,cue);
    assert(f.sources.every(s=>!s.loop&&s.at===1.01&&s.endAt>s.at&&s.endAt-s.at<=.31),cue);
    f.audio.destroy();
  }
});
test('lookahead uses the host output timestamp to align the audible impact with the visual frame',async()=>{
  const f=fixture();await f.audio.unlock();f.audio.begin('a',[event('wall',.1)]);f.audio.advance(0,1000);
  assert.equal(f.sources.length,1);assert(Math.abs(f.sources[0].at-1.06)<1e-9);
  assert.equal(f.audio.state().timing,'output-timestamp');assert(Math.abs(f.audio.state().outputDelayMs-40)<1e-6);
  assert.equal(f.audio.state().maxScheduleErrorMs,0);f.audio.destroy();
});
test('mute cancels queued voices and unmute skips missed cues',async()=>{
  const f=fixture();await f.audio.unlock();f.audio.begin('a',[event('wall',.04),event('collision',.2),event('eliminate',.5)]);
  f.audio.advance(0,1000);assert.equal(f.audio.state().voices,1);f.mute(true);
  assert.equal(f.audio.state().voices,0);assert(f.sources.every(s=>s.stopped&&s.disconnected));
  f.set(1.3);f.audio.advance(.3,1300);f.mute(false);f.set(1.4);f.audio.advance(.4,1400);
  assert.equal(f.audio.state().scheduled.collision,undefined);assert.equal(f.audio.state().scheduled.eliminate,1);f.audio.destroy();
});
test('a slow audio unlock preserves a newly accepted timeline without replaying past effects',async()=>{
  const f=fixture();f.audio.begin('a',[event('start',.04),event('wall',.4)]);await f.audio.unlock();
  f.set(1.3);f.audio.advance(.3,1300);assert.equal(f.audio.state().scheduled.start,undefined);assert.equal(f.audio.state().scheduled.wall,1);f.audio.destroy();
});
test('skip, repeated result IDs and destroy cannot replay a prize cue or leave owned voices',async()=>{
  const f=fixture();await f.audio.unlock();f.audio.begin('a',[event('wall',.04),event('win',.5)]);f.audio.advance(0,1000);
  f.audio.silence();f.set(2);f.audio.advance(1,2000);assert.equal(f.audio.state().scheduled.win,undefined);
  f.audio.instantResult('b',true);assert.equal(f.audio.state().scheduled.win,1);f.audio.instantResult('b',true);assert.equal(f.audio.state().scheduled.win,1);
  f.audio.destroy();assert.equal(f.audio.state().voices,0);assert.equal(f.audio.state().ready,false);assert(f.unsubscribed());
  const count=f.sources.length;f.audio.cue('select');await f.audio.unlock();assert.equal(f.sources.length,count);
});
test('repeated contacts have a fixed voice cap and use only the provided host context',async()=>{
  const f=fixture();await f.audio.unlock();for(let i=0;i<100;i++)f.audio.cue('collision');
  assert.equal(f.audio.state().voices,16);assert.equal(f.audio.state().maxVoices,16);f.audio.destroy();assert(f.sources.every(s=>s.stopped));
});
