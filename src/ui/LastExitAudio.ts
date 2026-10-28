import {gameAudio} from '../game/GameAudio';
import type {RacePhase} from './lastExitModel';
import {clamp,ease,pickStunt,cargoTiming,explosionAt,rolloverImpacts} from './lastExitStunts';

/** Original V8 harmonics, filtered road noise, pursuit siren and impact effects. */
export class LastExitAudio {
 private static owners=new Set<LastExitAudio>();
 static inspect(){return {owners:this.owners.size,sources:[...this.owners].reduce((sum,owner)=>sum+owner.sources.size,0)};}
 private bus?:GainNode;private engine?:GainNode;private road?:GainNode;private siren?:GainNode;private analyser?:AnalyserNode;
 private oscillators:OscillatorNode[]=[];private sources=new Set<AudioScheduledSourceNode>();private noise?:AudioBuffer;private sirenOsc?:OscillatorNode;
 private phase:RacePhase='idle';private enabled=true;private disposed=false;private played:Record<string,number>={};
 private rotor?:GainNode;private phaseAt=0;private runId='';private cueKeys=new Set<string>();private cuePlayed:string[]=[];private gear=-1;
 private unsubscribe:()=>void;private preferenceMuted=false;private cueUntil=0;
 constructor(){LastExitAudio.owners.add(this);try{this.enabled=localStorage.getItem('royal-last-exit-sound')!=='0';}catch{}this.unsubscribe=gameAudio.onPreferences(p=>{this.preferenceMuted=p.muted||p.volume===0;if(this.preferenceMuted)this.silence();});}
 isEnabled(){return this.enabled;}
 setEnabled(value:boolean){this.enabled=value;try{localStorage.setItem('royal-last-exit-sound',value?'1':'0');}catch{}if(!value)this.silence();else void this.unlock();}
 async unlock(){if(this.disposed)return;await gameAudio.unlock();if(this.disposed||!gameAudio.context||!gameAudio.output||this.bus)return;this.create(gameAudio.context,gameAudio.output);}
 private own<T extends AudioScheduledSourceNode>(s:T){this.sources.add(s);s.onended=()=>{this.sources.delete(s);s.disconnect();};return s;}
 private create(c:AudioContext,output:GainNode){
  this.bus=c.createGain();this.bus.gain.value=.62;const limiter=c.createDynamicsCompressor();limiter.threshold.value=-16;limiter.ratio.value=6;this.bus.connect(limiter);this.analyser=c.createAnalyser();this.analyser.fftSize=512;limiter.connect(this.analyser);this.analyser.connect(output);
  this.engine=c.createGain();this.engine.gain.value=0;const low=c.createBiquadFilter();low.type='lowpass';low.frequency.value=1300;this.engine.connect(low);low.connect(this.bus);
  for(const [i,level] of [.24,.12,.06,.028].entries()){const o=this.own(c.createOscillator()),g=c.createGain();o.type=i===0?'sawtooth':'triangle';o.frequency.value=42*(i+1);g.gain.value=level;o.connect(g);g.connect(this.engine);o.start();this.oscillators.push(o);}
  this.noise=c.createBuffer(1,c.sampleRate*3,c.sampleRate);const a=this.noise.getChannelData(0);let prev=0;for(let i=0;i<a.length;i++){prev=(prev+(Math.random()*2-1)*.035)/1.035;a[i]=prev*4;}
  const n=this.own(c.createBufferSource());n.buffer=this.noise;n.loop=true;const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=160;this.road=c.createGain();this.road.gain.value=0;n.connect(f);f.connect(this.road);this.road.connect(this.bus);n.start();
  this.siren=c.createGain();this.siren.gain.value=0;this.siren.connect(this.bus);this.sirenOsc=this.own(c.createOscillator());this.sirenOsc.type='sine';this.sirenOsc.frequency.value=520;this.sirenOsc.connect(this.siren);this.sirenOsc.start();
  this.rotor=c.createGain();this.rotor.gain.value=0;this.rotor.connect(this.bus);
  for(const [frequency,level] of [[37,.24],[74,.11],[111,.035]]){const o=this.own(c.createOscillator()),g=c.createGain();o.type='triangle';o.frequency.value=frequency;g.gain.value=level;o.connect(g);g.connect(this.rotor);o.start();}
 }
 private allowed(){return this.enabled&&!this.disposed&&!document.hidden&&!this.preferenceMuted&&gameAudio.context?.state==='running';}
 private tone(from:number,to:number,duration:number,gain:number,type:OscillatorType='sine'){
  const c=gameAudio.context;if(!c||!this.bus||!this.allowed())return;const o=this.own(c.createOscillator()),g=c.createGain(),t=c.currentTime;o.type=type;o.frequency.setValueAtTime(from,t);o.frequency.exponentialRampToValueAtTime(to,t+duration);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(this.bus);o.start();o.stop(t+duration+.03);this.cueUntil=Math.max(this.cueUntil,t+duration);
 }
 private burst(duration:number,gain:number,frequency:number){
  const c=gameAudio.context;if(!c||!this.bus||!this.noise||!this.allowed())return;const n=this.own(c.createBufferSource()),f=c.createBiquadFilter(),g=c.createGain(),t=c.currentTime;n.buffer=this.noise;f.type='lowpass';f.frequency.setValueAtTime(frequency,t);f.frequency.exponentialRampToValueAtTime(90,t+duration);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);n.connect(f);f.connect(g);g.connect(this.bus);n.start();n.stop(t+duration+.02);this.cueUntil=Math.max(this.cueUntil,t+duration);
 }
 update(phase:RacePhase,value:number,seconds:number,quiet=false,runId='',presentationAge?:number,restored=false){
  const old=this.phase;this.phase=phase;const c=gameAudio.context;
  // Reopened runs reuse the unlocked shared context, respecting mute and visibility.
  if(c&&!this.bus&&gameAudio.output&&this.allowed()&&!restored&&phase!=='idle')this.create(c,gameAudio.output);
  if(!c||!this.bus)return;
  const changed=old!==phase||runId!==this.runId;if(changed){this.phaseAt=c.currentTime;this.runId=runId;this.cueKeys.clear();this.cuePlayed=[];this.gear=-1;}
  const age=presentationAge===undefined?c.currentTime-this.phaseAt:Math.max(0,presentationAge),on=this.allowed()&&!restored,running=phase==='racing',waiting=phase==='waiting';
  this.bus.gain.setTargetAtTime(on?.62:0,c.currentTime,.035);
  this.engine!.gain.setTargetAtTime(on&&(running||waiting||phase==='crashed'&&age<.6)?running?.50:.17:0,c.currentTime,.09);
  const road=running?1:phase==='escaped'?clamp(1-age/4):phase==='crashed'?clamp(1-age):0;
  this.road!.gain.setTargetAtTime(on?road*(.23+Math.min(.10,seconds*.014)):0,c.currentTime,.14);
  this.siren!.gain.setTargetAtTime(on&&running&&!quiet?.04:0,c.currentTime,.13);
  const plane=pickStunt(runId,phase,value)==='cargo-plane';
  const rotor=phase==='escaped'&&!plane?ease(age/1.2)*(1-ease((age-4.1)/2.9)):0;
  this.rotor!.gain.setTargetAtTime(on?rotor*(quiet?.09:.34*(.73+.27*Math.sin(age*38))):0,c.currentTime,.025);
  const rev=running?78+(seconds%1.65)*32+Math.min(45,Math.log(Math.max(1,value))*15):38;
  this.oscillators.forEach((o,i)=>o.frequency.setTargetAtTime(rev*(i+1),c.currentTime,.07));this.sirenOsc!.frequency.setTargetAtTime(620+Math.sin(seconds*2.7)*220,c.currentTime,.06);
  const cue=(key:string,at:number,play:()=>void)=>{if(age>=at&&!this.cueKeys.has(key)){this.cueKeys.add(key);if(on&&!quiet&&age<at+.24){play();this.cuePlayed.push(key);}}};
  if(on&&changed){this.played[phase]=(this.played[phase]??0)+1;if(quiet&&phase==='crashed'&&age<.24)this.burst(.3,.16,900);}
  if(phase==='racing'){
   if(seconds<.24)cue('launch',0,()=>{this.tone(42,105,.9,.17,'sawtooth');this.burst(.35,.14,1600);});
   const gear=Math.floor(seconds/1.65);if(gear>this.gear){if(this.gear>=0&&on&&!quiet)this.burst(.12,.085,2200);this.gear=gear;}
  }
  if(phase==='escaped'&&plane){cue('aircraft-departure',cargoTiming.departure,()=>{this.tone(90,32,2.2,.12,'sawtooth');this.burst(1.4,.08,2400);});cue('cargo-aircraft',cargoTiming.planeAt,()=>this.tone(45,85,4.2,.17,'sawtooth'));cue('ramp-launch',cargoTiming.takeoff,()=>{this.tone(90,280,.65,.16,'sawtooth');this.burst(.65,.19,4400);});cue('cargo-landing',cargoTiming.landing,()=>{this.burst(.5,.24,1800);this.tone(95,36,.6,.16);});}
  if(phase==='escaped'&&!plane){
   cue('helicopter-inbound',0,()=>this.tone(100,43,.8,.13,'sawtooth'));
   cue('winch',1.15,()=>this.tone(310,520,1.1,.04,'triangle'));
   cue('cables-taut',2.25,()=>{this.burst(.18,.17,1600);this.tone(170,360,.65,.035,'triangle');});
   cue('helicopter-departure',4.1,()=>{this.tone(90,42,1.4,.08,'triangle');this.burst(.7,.07,2400);});
  }
  if(phase==='crashed'){
   cue('intercept',.4,()=>{this.tone(130,34,.19,.26);this.tone(1400,350,.45,.07,'sawtooth');this.burst(.18,.42,1700);this.burst(.48,.18,4200);});
   cue('rollover',.72,()=>{this.tone(520,110,.42,.12,'triangle');this.burst(.25,.24,1800);});
   rolloverImpacts.forEach((at,i)=>cue('road-contact-'+i,at,()=>{this.burst(.18,.16-i*.009,1700);if(i%2===0)this.tone(480,140,.15,.035,'square');}));
   cue('explosion',explosionAt,()=>{this.burst(2.6,.62,2400);this.tone(78,22,1.6,.29);});
  }
 }

 silence(){const c=gameAudio.context;if(c&&this.bus)this.bus.gain.setTargetAtTime(0,c.currentTime,.025);}
 state(){const a=new Float32Array(512);this.analyser?.getFloatTimeDomainData(a);return {enabled:this.enabled,context:gameAudio.context?.state??'locked',sources:this.sources.size,phase:this.phase,rms:Math.sqrt(a.reduce((v,n)=>v+n*n,0)/a.length),played:{...this.played},cues:[...this.cuePlayed],phaseAge:(gameAudio.context?.currentTime??0)-this.phaseAt,cueActive:(gameAudio.context?.currentTime??Infinity)<this.cueUntil};}
 destroy(){this.disposed=true;this.unsubscribe();this.silence();for(const s of this.sources){s.onended=null;try{s.stop();}catch{}s.disconnect();}this.sources.clear();this.bus?.disconnect();this.analyser?.disconnect();LastExitAudio.owners.delete(this);}
}
