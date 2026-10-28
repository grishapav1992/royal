import {readGameHost} from '../../src/modules/GameHostContract';
export type CaribbeanCue='click'|'stop'|'giant'|'cannon'|'line'|'bonus'|'loss'|'partial'|'return'|'win'|'bigwin';
type Voice={source:AudioScheduledSourceNode;gain:GainNode;filter:BiquadFilterNode;music:boolean;at:number;end:number};
type Graph={context:AudioContext;master:GainNode;music:GainNode;musicInput:GainNode;fxInput:GainNode;nodes:AudioNode[]};
const hz=(midi:number)=>440*2**((midi-69)/12);
const eighth=.26;
/** An original 6/8 phrase. It is presentation only and never uses game randomness. */
const melody=[[74,0,77,81,0,77],[76,0,74,72,0,69],[79,0,82,81,0,79],[77,0,74,72,0,70],[76,0,79,81,0,79],[73,0,76,81,0,85],[81,0,77,74,0,72],[73,0,76,74,0,0]];
/** Owns its sources and short room tails. The audio context, volume and mute belong to the host. */
export class CaribbeanAudio{
 private host=readGameHost().gameAudio;
 private voices=new Set<Voice>();private timer?:ReturnType<typeof setInterval>;
 private entered=false;private dead=false;private tick=0;private next=0;private graph?:Graph;
 private music=true;private unsubscribe:()=>void;private buffers=new Map<string,AudioBuffer>();
 private retiring=new Map<ReturnType<typeof setTimeout>,Graph>();
 private counts:Partial<Record<CaribbeanCue,number>>={};
 constructor(){
  try{this.music=localStorage.getItem('royal-caribbean-music')!=='0';}catch{}
  this.unsubscribe=this.host.onPreferences(()=>{if(!this.enabled())this.cancel();else this.startMusic();});
 }
 private enabled(){const p=this.host.getPreferences();return !this.dead&&this.entered&&!document.hidden&&!p.muted&&p.volume>0&&this.host.context?.state==='running';}
 async enter(scheduleMusic=true){if(this.dead)return;this.entered=true;await this.host.unlock();if(scheduleMusic)this.startMusic();}
 musicEnabled(){return this.music;}
 setMusic(value:boolean){
  this.music=value;try{localStorage.setItem('royal-caribbean-music',value?'1':'0');}catch{}
  const c=this.host.context;if(c&&this.graph){this.graph.music.gain.cancelScheduledValues(c.currentTime);this.graph.music.gain.setTargetAtTime(value?1:0,c.currentTime,value ? .02 : .008);}
  if(!value){clearInterval(this.timer);this.timer=undefined;for(const v of this.voices)if(v.music)this.stopVoice(v);}
  else this.startMusic();
 }
 private audioGraph(){
  const c=this.host.context,out=this.host.output;if(!c||!out||!this.enabled())return;
  if(this.graph?.context===c)return this.graph;
  if(this.graph)this.disconnect(this.graph);
  const master=c.createGain();master.gain.value=.85;master.connect(out);const nodes:AudioNode[]=[master];
  const branch=()=>{const input=c.createGain(),level=c.createGain(),verb=c.createConvolver(),wet=c.createGain();verb.normalize=false;verb.buffer=this.impulse(c);wet.gain.value=.24;input.connect(level);input.connect(verb);verb.connect(wet);wet.connect(level);level.connect(master);nodes.push(input,level,verb,wet);return{input,level};};
  const music=branch(),fx=branch();music.level.gain.value=this.music?1:0;
  return this.graph={context:c,master,music:music.level,musicInput:music.input,fxInput:fx.input,nodes};
 }
 private impulse(c:AudioContext){
  const key='room:'+c.sampleRate,cached=this.buffers.get(key);if(cached)return cached;
  const buffer=c.createBuffer(1,Math.ceil(c.sampleRate*.65),c.sampleRate),data=buffer.getChannelData(0);let seed=47129;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=(seed/2147483648-1)*.003*Math.exp(-i/c.sampleRate*10);}
  for(const [t,v] of [[.022,.13],[.053,.09],[.081,.05]])data[Math.round(t*c.sampleRate)]+=v;
  this.buffers.set(key,buffer);return buffer;
 }
 private source(source:AudioScheduledSourceNode,at:number,duration:number,level:number,frequency:number,music=false,attack=.008,filterType:BiquadFilterType='lowpass'){
  const g=this.audioGraph(),overlap=[...this.voices].filter(v=>v.at<=at&&v.end>at).length;
  if(!g||overlap>=48||(music&&overlap>=24)){source.disconnect();source.start(at);source.stop(at);return;}
  const c=g.context,gain=c.createGain(),filter=c.createBiquadFilter();gain.gain.value=0;filter.type=filterType;filter.frequency.setValueAtTime(frequency,at);filter.Q.value=.6;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+attack);gain.gain.exponentialRampToValueAtTime(.00001,at+duration);
  source.connect(filter);filter.connect(gain);gain.connect(music?g.musicInput:g.fxInput);
  const voice={source,gain,filter,music,at,end:at+duration+.02};this.voices.add(voice);
  source.onended=()=>this.release(voice);source.start(at);source.stop(at+duration+.02);
 }
 private note(midi:number,at:number,duration:number,level:number,type:OscillatorType='sine',slide=0,music=false){
  const c=this.host.context;if(!c||!this.enabled())return;
  const source=c.createOscillator();source.type=type;source.frequency.setValueAtTime(hz(midi),at);if(slide)source.frequency.exponentialRampToValueAtTime(hz(midi+slide),at+duration);
  this.source(source,at,duration,level,type==='sine'?3000:1450,music,.012);
 }
 private pluck(midi:number,at:number,level:number,music=false){
  const c=this.host.context;if(!c||!this.enabled())return;const key='string:'+c.sampleRate+':'+midi;let buffer=this.buffers.get(key);
  if(!buffer){buffer=c.createBuffer(1,Math.ceil(c.sampleRate*1.2),c.sampleRate);const samples=buffer.getChannelData(0),f=hz(midi);
   // Decaying complex rotation avoids hundreds of thousands of sin/exp calls
   // while preparing a cold timbre immediately before a synchronized accent.
   for(let h=1;h<=8;h++){
    const angle=2*Math.PI*f*h/c.sampleRate,decay=Math.exp(-(2.8+h*.9)/c.sampleRate),real=decay*Math.cos(angle),imaginary=decay*Math.sin(angle);
    let x=.5/h**1.5,y=0;
    for(let i=0;i<samples.length;i++){samples[i]+=y;const nextX=x*real-y*imaginary;y=x*imaginary+y*real;x=nextX;}
   }
   if(this.buffers.size>48)this.buffers.delete(this.buffers.keys().next().value!);this.buffers.set(key,buffer);
  }
  const source=c.createBufferSource();source.buffer=buffer;this.source(source,at,1.15,level,4200,music,.004);
 }
 private noise(at:number,duration:number,level:number,frequency:number,filter:BiquadFilterType='lowpass',music=false){
  const c=this.host.context;if(!c||!this.enabled())return;const key='air:'+c.sampleRate;let buffer=this.buffers.get(key);
  if(!buffer){buffer=c.createBuffer(1,c.sampleRate,c.sampleRate);const samples=buffer.getChannelData(0);let seed=19273;for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=seed/2147483648-1;}this.buffers.set(key,buffer);}
  const source=c.createBufferSource();source.buffer=buffer;this.source(source,at,duration,level,frequency,music,.007,filter);
 }
 /** Shared by the live scheduler and the offline mix verification. */
 scoreStep(tick:number,at:number){
  const step=tick%6,bar=Math.floor(tick/6)%8,root=[50,50,55,55,57,57,50,50][bar],third=bar===4||bar===5?4:3;
  this.pluck(root+[12,19,12+third,24,19,12+third][step],at,.041,true);
  if(step===0||step===3){this.pluck(root-12,at,.045,true);this.note(39,at,.14,.015,'sine',-5,true);}
  if(step===2||step===5)this.noise(at,.065,.012,1700,'highpass',true);
  const note=melody[bar][step];if(note){this.note(note,at+.01,.43,.012,'sine',0,true);this.note(note+12,at+.01,.34,.0018,'sine',0,true);this.noise(at+.02,.2,.002,2300,'bandpass',true);}
 }
 private startMusic(){
  if(!this.music||!this.enabled()||this.timer)return;this.next=this.host.context!.currentTime+.06;
  const schedule=()=>{if(!this.enabled()||!this.music){this.cancel();return;}const c=this.host.context!;if(this.next<c.currentTime)this.next=c.currentTime+.035;while(this.next<c.currentTime+.16){this.scoreStep(this.tick++,this.next);this.next+=eighth;}};
  schedule();this.timer=setInterval(schedule,80);
 }
 private metal(midi:number,at:number,level:number){this.note(midi,at,.25,level);this.note(midi+19,at,.11,level*.3);this.note(midi+28,at,.07,level*.15);}
 private duck(at:number,duration=.7){const music=this.graph?.music;if(!music||!this.music)return;music.gain.cancelScheduledValues(at);music.gain.setTargetAtTime(.3,at,.025);music.gain.setTargetAtTime(1,at+duration,.14);}
 /** Returns the estimated physical-output timestamp on the performance clock. */
 cue(kind:CaribbeanCue,variant=0){
  const c=this.host.context;if(!c||!this.enabled())return performance.now();
  const at=c.currentTime+.07;this.counts[kind]=(this.counts[kind]??0)+1;
  if(kind==='click'){this.noise(at,.055,.028,1100,'bandpass');this.pluck(62,at,.025);}
  else if(kind==='stop'){this.noise(at,.065,.042,600+variant*80,'bandpass');this.note(42+variant,at,.085,.025,'triangle',-9);this.metal(77+variant,at+.006,.005);}
  else if(kind==='giant'){this.pluck(38,at,.085);this.pluck(50,at+.015,.045);this.noise(at,.24,.045,480);this.metal(69,at+.025,.015);this.duck(at,.4);}
  else if(kind==='cannon'){this.note(36,at,.47,.09,'sine',-17);this.noise(at,.38,.15,320);this.noise(at+.012,.16,.025,950,'highpass');this.metal(52,at+.04,.024);this.duck(at,.6);}
  else if(kind==='line'){this.metal(86,at,.018);this.metal(93,at+.055,.01);}
  else if(kind==='bonus'){[74,77,81,86].forEach((n,i)=>{this.pluck(n,at+i*.085,.065);this.note(n+12,at+i*.085,.32,.009);});this.duck(at,.7);}
  else if(kind==='loss'||kind==='partial'){this.pluck(50,at,.018);this.noise(at,.08,.01,500,'bandpass');}
  else if(kind==='return'){this.pluck(62,at,.026);this.pluck(69,at+.1,.022);}
  else{[62,65,69,74].forEach((n,i)=>this.pluck(n,at+i*.065,.07));this.duck(at,kind==='bigwin'?1.15:.75);if(kind==='bigwin'){this.note(38,at,.55,.045);[81,86,89,93].forEach((n,i)=>this.metal(n,at+.22+i*.085,.019));}}
  const stamp=c.getOutputTimestamp?.();
  const estimate=stamp&&typeof stamp.contextTime==='number'&&typeof stamp.performanceTime==='number'&&stamp.contextTime>0&&stamp.performanceTime>0?stamp.performanceTime+(at-stamp.contextTime)*1000:performance.now()+(at-c.currentTime+(c.outputLatency||c.baseLatency||0))*1000;
  return Math.max(performance.now(),Math.min(performance.now()+1000,estimate));
 }
 private release(v:Voice){v.source.disconnect();v.gain.disconnect();v.filter.disconnect();this.voices.delete(v);}
 private stopVoice(v:Voice){const c=this.host.context;try{if(c?.state==='running'&&!document.hidden&&!this.dead){v.gain.gain.cancelScheduledValues(c.currentTime);v.gain.gain.setTargetAtTime(0,c.currentTime,.006);v.source.stop(c.currentTime+.025);}else{v.source.stop();this.release(v);}}catch{this.release(v);}}
 private disconnect(g:Graph){g.nodes.forEach(node=>node.disconnect());}
 cancel(){
  clearInterval(this.timer);this.timer=undefined;const c=this.host.context,g=this.graph;this.graph=undefined;
  for(const v of this.voices)this.stopVoice(v);
  if(g){if(c?.state==='running'&&!document.hidden&&!this.dead){g.master.gain.setTargetAtTime(0,c.currentTime,.006);const timer=setTimeout(()=>{this.disconnect(g);this.retiring.delete(timer);},40);this.retiring.set(timer,g);}else this.disconnect(g);}
 }
 pause(){this.entered=false;this.cancel();}
 state(){return{activeSources:this.voices.size,music:!!this.timer,musicEnabled:this.music,counts:{...this.counts},ownedGraphs:(this.graph?1:0)+this.retiring.size};}
 destroy(){this.dead=true;this.pause();for(const [timer,g] of this.retiring){clearTimeout(timer);this.disconnect(g);}this.retiring.clear();this.buffers.clear();this.unsubscribe();}
}
