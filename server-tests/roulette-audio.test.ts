import test from 'node:test';
import assert from 'node:assert/strict';
import {roulettePcm} from '../games/royal-roulette/RouletteAudioBank';
import {rouletteAudioTime,rouletteClock,rouletteContacts} from '../games/royal-roulette/RouletteSoundTimeline';
import {landingPlan,landingPose,launchPose,SPIN_TIMING,type SpinPose} from '../games/royal-roulette/SpinTimeline';

test('roulette samples are deterministic, finite, bounded and have shaped endpoints',()=>{
 for(const rate of [8000,44100,48000,96000]){
  const bank=roulettePcm(rate);
  for(const [cue,sample]of Object.entries(bank)){
   assert(sample.data.length>0);let peak=0,index=0;
   sample.data.forEach((v,i)=>{assert(Number.isFinite(v));if(Math.abs(v)>peak){peak=Math.abs(v);index=i;}});
   assert(peak>.4&&peak<=.681,cue);assert.equal(sample.peakSeconds,index/rate);
   if(sample.loopStart){
    const at=Math.round(rate*sample.loopStart);let step=0;
    for(let i=at+1;i<sample.data.length;i++)step=Math.max(step,Math.abs(sample.data[i]-sample.data[i-1]));
    assert(Math.abs(sample.data[sample.data.length-1]-sample.data[at])<=step,cue+' loop adds no larger step than its texture');
   }else{assert.equal(Math.abs(sample.data[0]),0);assert.equal(Math.abs(sample.data[sample.data.length-1]),0);}
  }
  assert.deepEqual(bank.chip.data,roulettePcm(rate).chip.data);
  assert.notDeepEqual(bank.chip.data,bank['chip-alt'].data);
 }
 for(const rate of [0,7999,192001,NaN,Infinity])assert.throws(()=>roulettePcm(rate));
});
test('contact accents coincide with the visual ball contacts for every pocket',()=>{
 const base:SpinPose={wheel:130,ball:-352,wheelVelocity:0,ballVelocity:0,radius:148,hop:0,phase:'idle'};
 for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose(base,650),pocket),contacts=rouletteContacts(plan);
  assert.equal(contacts.length,6);assert.equal(contacts.at(-1)!.cue,'landing');assert.equal(contacts.at(-1)!.ms,SPIN_TIMING.landing);
  for(const [i,c]of contacts.entries()){
   assert(landingPose(plan,c.ms).hop<1e-10);assert(c.pan>=-.28&&c.pan<=.28);assert(c.gain>0&&c.gain<=.43);
   if(i)assert(c.ms>contacts[i-1].ms);
  }
 }
});
test('output timestamp maps audible sample peaks onto the performance clock',()=>{
 const clock={currentTime:12.1,getOutputTimestamp:()=>({contextTime:12,performanceTime:4000})};
 assert.equal(rouletteClock(clock,4020).method,'output-timestamp');
 const when=rouletteAudioTime(clock,4020,4500,.008);
 assert(Math.abs(when.at-12.492)<1e-9);assert.equal(when.audiblePeak,4500);assert.equal(when.errorMs,0);
});
test('latency fallback rejects stale or incomplete timestamps and reports unavoidable late peaks',()=>{
 for(const stamp of [{},{contextTime:10},{contextTime:10,performanceTime:0},{contextTime:0,performanceTime:1000}]){
  const clock={currentTime:10,baseLatency:.01,outputLatency:.08,getOutputTimestamp:()=>stamp};
  assert.equal(rouletteClock(clock,1000).method,'latency-estimate');
  const when=rouletteAudioTime(clock,1000,1250,.012);assert(Math.abs(when.errorMs)<1e-8);
  assert(Math.abs(when.at-10.148)<1e-8);
 }
 const late=rouletteAudioTime({currentTime:1,outputLatency:.15},1000,1000,.01);
 assert.equal(late.at,1.004);assert.equal(late.errorMs,164);
});

test('impact intervals and bounce heights shrink instead of repeating equally spaced hops',()=>{
 const plan=landingPlan(launchPose({wheel:0,ball:0,wheelVelocity:0,ballVelocity:0,radius:148,hop:0,phase:'idle'},650),0);
 const contacts=rouletteContacts(plan);let previousHeight=Infinity,previousDuration=Infinity;
 for(let i=0;i<contacts.length-1;i++){
  const a=contacts[i].ms,b=contacts[i+1].ms,height=landingPose(plan,(a+b)/2).hop,duration=b-a;
  assert(duration<previousDuration);assert(height<previousHeight);assert(height>0);
  if(i){assert(Math.abs(duration/previousDuration-.68)<1e-10);assert(Math.abs(height/previousHeight-.68**2)<1e-10);}
  previousHeight=height;previousDuration=duration;
 }
});
