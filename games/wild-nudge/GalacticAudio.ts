import {readGameHost} from '../../src/modules/GameHostContract';
/** Event cues. 'stop' and 'nudge' keep their one-cue-per-reel and one-cue-per-step meaning. */
export type GalacticCue='start'|'stop'|'nudge'|'bonus'|'partial'|'return'|'win'|'line'|'big'|'vortex'|'segment'|'flip'|'side'|'finale';
type Voice={oscillators:OscillatorNode[];filter:BiquadFilterNode;gain:GainNode;cut:number};
/**
 * Original synthesized saber, Force and hangar sounds on the host AudioContext.
 * Nothing is sampled. Every source is owned, so pause, hide, skip and close silence it at once.
 */
export class GalacticAudio {
  private host=readGameHost().gameAudio;
  private sources=new Set<AudioScheduledSourceNode>();
  private musicSource?:AudioBufferSourceNode;private musicGain?:GainNode;
  private musicBuffer?:AudioBuffer;
  private musicOffset=0;private musicAt=0;private dead=false;private entered=false;private paused=false;
  private loading?:Promise<void>;private lifetime=new AbortController();private unsubscribe:()=>void;
  private counts:Partial<Record<GalacticCue,number>>={};
  private bus?:GainNode;private wet?:GainNode;private busContext?:BaseAudioContext;
  private hum?:Voice;private noiseCache=new Map<string,AudioBuffer>();
  side:'light'|'dark'='light';
  music=true;effects=true;
  constructor(){
    try{this.music=localStorage.getItem('gn-music')!=='0';this.effects=localStorage.getItem('gn-effects')!=='0';}catch{}
    this.unsubscribe=this.host.onPreferences(()=>{if(!this.enabled())this.cancel();else this.startMusic();});
  }
  private enabled(){const pref=this.host.getPreferences();return !this.dead&&this.entered&&!this.paused&&!document.hidden&&!pref.muted&&pref.volume>0&&this.host.context?.state==='running';}
  async unlock(){
    if(this.dead||this.paused||document.hidden)return;this.entered=true;await this.host.unlock();
    if(!this.musicBuffer&&!this.loading&&this.host.context){
      const context=this.host.context;
      this.loading=(async()=>{const r=await fetch('/assets/wild-nudge/score.wav',{signal:this.lifetime.signal});if(!r.ok)throw Error('Score unavailable');const buffer=await context.decodeAudioData(await r.arrayBuffer());if(!this.dead)this.musicBuffer=buffer;})().catch(()=>{}).finally(()=>{this.loading=undefined;this.startMusic();});
    }
    this.startMusic();
  }
  setMusic(value:boolean){this.music=value;try{localStorage.setItem('gn-music',value?'1':'0');}catch{}if(value){void this.unlock();this.startMusic();}else this.stopMusic();}
  setEffects(value:boolean){this.effects=value;try{localStorage.setItem('gn-effects',value?'1':'0');}catch{}if(!value)this.cancelEffects();}
  private startMusic(){
    const c=this.host.context,out=this.host.output;if(!this.enabled()||!this.music||!this.musicBuffer||this.musicSource||!c||!out)return;
    const source=c.createBufferSource(),gain=c.createGain();source.buffer=this.musicBuffer;source.loop=true;gain.gain.value=.42;source.connect(gain);gain.connect(out);source.onended=()=>{source.disconnect();gain.disconnect();};
    source.start(0,this.musicOffset%this.musicBuffer.duration);this.musicSource=source;this.musicGain=gain;this.musicAt=c.currentTime;
  }
  private stopMusic(){if(!this.musicSource)return;this.musicOffset+=Math.max(0,(this.host.context?.currentTime??0)-this.musicAt);try{this.musicSource.stop();}catch{}this.musicSource=undefined;this.musicGain=undefined;}
  /** The score steps back under the loudest moments and returns afterwards. */
  private duck(seconds:number){const c=this.host.context,g=this.musicGain;if(!c||!g)return;const t=c.currentTime;g.gain.cancelScheduledValues(t);g.gain.setTargetAtTime(.15,t,.08);g.gain.setTargetAtTime(.42,t+seconds,.6);}

  /* Graph helpers. Every chain ends in the owned bus, which feeds the host output and a short hangar reverb. */
  private route(c:BaseAudioContext,out:AudioNode){
    if(this.bus&&this.busContext===c)return this.bus;
    const bus=c.createGain(),wet=c.createGain(),verb=c.createConvolver(),len=Math.floor(c.sampleRate*2),ir=c.createBuffer(2,len,c.sampleRate);
    for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3.2);}
    verb.buffer=ir;wet.gain.value=.22;bus.gain.value=.9;bus.connect(out);bus.connect(wet);wet.connect(verb);verb.connect(out);
    this.bus=bus;this.wet=wet;this.busContext=c;return bus;
  }
  private own<T extends AudioScheduledSourceNode>(node:T,start:number,stop:number,tail:AudioNode[]){this.sources.add(node);node.onended=()=>{this.sources.delete(node);node.disconnect();tail.forEach(n=>n.disconnect());};node.start(start);node.stop(stop);return node;}
  private noiseBuffer(c:BaseAudioContext,seconds:number,crackle=false){
    const key=c.sampleRate+':'+seconds+':'+crackle;let buffer=this.noiseCache.get(key);if(buffer)return buffer;
    const n=Math.floor(c.sampleRate*seconds);buffer=c.createBuffer(1,n,c.sampleRate);const d=buffer.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=crackle?(Math.random()<.05*(1-i/n*.7)?Math.random()*2-1:0):Math.random()*2-1;this.noiseCache.set(key,buffer);return buffer;
  }
  private osc(c:BaseAudioContext,bus:AudioNode,at:number,freq:number,{type='sine' as OscillatorType,d=.3,gain=.05,attack=.008,to=0,lp=0}={}){
    const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,at);if(to)o.frequency.exponentialRampToValueAtTime(to,at+d*.9);
    g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+attack);g.gain.exponentialRampToValueAtTime(.0001,at+d);
    const tail:AudioNode[]=[g];if(lp){const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=lp;o.connect(f);f.connect(g);tail.push(f);}else o.connect(g);
    g.connect(bus);this.own(o,at,at+d+.03,tail);
  }
  private noise(c:BaseAudioContext,bus:AudioNode,at:number,d:number,{type='bandpass' as BiquadFilterType,from=800,to=2400,q=1,gain=.05,attack=.01,crackle=false}={}){
    const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();s.buffer=this.noiseBuffer(c,Math.ceil(d*10)/10,crackle);
    f.type=type;f.Q.value=q;f.frequency.setValueAtTime(from,at);f.frequency.exponentialRampToValueAtTime(Math.max(20,to),at+d);
    g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+attack);g.gain.exponentialRampToValueAtTime(.0001,at+d);
    s.connect(f);f.connect(g);g.connect(bus);this.own(s,at,at+d+.03,[f,g]);
  }
  /** Two detuned saws through a resonant filter with a buzz layer. The Dark side blade is lower and driven. */
  private saber(c:BaseAudioContext,bus:AudioNode,at:number,level:number,seconds:number):Voice{
    const dark=this.side==='dark',f0=dark?74:104,cut=dark?520:680;
    const a=c.createOscillator(),b=c.createOscillator(),sub=c.createOscillator(),buzz=c.createOscillator();
    a.type='sawtooth';b.type='sawtooth';sub.type='sine';buzz.type='square';
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.Q.value=5;
    const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1600;bp.Q.value=3;const bg=c.createGain();bg.gain.value=.12;
    const gain=c.createGain();gain.gain.setValueAtTime(0,at);
    a.connect(filter);b.connect(filter);sub.connect(filter);buzz.connect(bp);bp.connect(bg);bg.connect(filter);
    const tail:AudioNode[]=[filter,bp,bg,gain];let last:AudioNode=filter;
    if(dark){const ws=c.createWaveShaper(),curve=new Float32Array(512);for(let i=0;i<512;i++)curve[i]=Math.tanh((i/256-1)*3.2);ws.curve=curve;filter.connect(ws);last=ws;tail.push(ws);}
    last.connect(gain);gain.connect(bus);
    const base=[f0,f0*1.013,f0/2,f0*2];[a,b,sub,buzz].forEach((o,i)=>{o.frequency.setValueAtTime(base[i]*.45,at);o.frequency.exponentialRampToValueAtTime(base[i],at+.32);});
    filter.frequency.setValueAtTime(180,at);filter.frequency.exponentialRampToValueAtTime(2600,at+.18);filter.frequency.exponentialRampToValueAtTime(cut,at+.55);
    gain.gain.linearRampToValueAtTime(level*1.3,at+.12);gain.gain.exponentialRampToValueAtTime(level,at+.6);
    const oscillators=[a,b,sub,buzz];oscillators.forEach((o,i)=>this.own(o,at,at+seconds,i===0?tail:[]));
    return {oscillators,filter,gain,cut};
  }
  private retract(c:BaseAudioContext,bus:AudioNode,voice:Voice,at:number){
    voice.oscillators.forEach(o=>{o.frequency.cancelScheduledValues(at);o.frequency.setValueAtTime(Math.max(10,o.frequency.value),at);o.frequency.exponentialRampToValueAtTime(Math.max(10,o.frequency.value*.35),at+.42);try{o.stop(at+.48);}catch{}});
    voice.filter.frequency.cancelScheduledValues(at);voice.filter.frequency.setValueAtTime(voice.cut,at);voice.filter.frequency.exponentialRampToValueAtTime(140,at+.42);
    voice.gain.gain.cancelScheduledValues(at);voice.gain.gain.setValueAtTime(Math.max(.0001,voice.gain.gain.value),at);voice.gain.gain.exponentialRampToValueAtTime(.0001,at+.45);
    this.noise(c,bus,at,.35,{from:2600,to:400,q:1.2,gain:.03});
  }
  private swing(c:BaseAudioContext,bus:AudioNode,at:number,amount=1,d=.48){
    const v=this.saber(c,bus,at,.0001,d+.1),f=this.side==='dark'?74:104;
    v.oscillators.slice(0,2).forEach((o,i)=>{const base=i?f*1.013:f;o.frequency.cancelScheduledValues(at);o.frequency.setValueAtTime(base,at);o.frequency.linearRampToValueAtTime(base*1.32,at+d*.42);o.frequency.linearRampToValueAtTime(base*.92,at+d);});
    v.filter.frequency.cancelScheduledValues(at);v.filter.frequency.setValueAtTime(v.cut,at);v.filter.frequency.exponentialRampToValueAtTime(2800,at+d*.42);v.filter.frequency.exponentialRampToValueAtTime(v.cut,at+d);
    v.gain.gain.cancelScheduledValues(at);v.gain.gain.setValueAtTime(.0001,at);v.gain.gain.linearRampToValueAtTime(.1*amount,at+d*.42);v.gain.gain.exponentialRampToValueAtTime(.0001,at+d);
    this.noise(c,bus,at,d,{from:350,to:1900,q:1.6,gain:.045*amount});
  }
  private clash(c:BaseAudioContext,bus:AudioNode,at:number,amount=1){
    this.noise(c,bus,at,.16,{type:'highpass',from:2400,to:5000,q:.8,gain:.12*amount,attack:.001});
    [1340,1912,2733,3517,4410].forEach((f,i)=>this.osc(c,bus,at,f,{type:'triangle',d:.25+i*.09,gain:.03*amount,attack:.001}));
    this.osc(c,bus,at,68,{d:.25,gain:.14*amount,to:40});
    this.noise(c,bus,at+.02,.4,{type:'highpass',from:1800,to:4000,q:.7,gain:.07*amount,attack:.002,crackle:true});
  }
  private force(c:BaseAudioContext,bus:AudioNode,at:number,d=1.4,amount=1){
    this.osc(c,bus,at,42,{d,gain:.16*amount,to:30,attack:d*.4});
    this.noise(c,bus,at,d,{type:'lowpass',from:180,to:1400,q:.5,gain:.09*amount,attack:d*.55});
    this.noise(c,bus,at+d*.3,d*.8,{from:900,to:300,q:2,gain:.03*amount});
  }
  private brass(c:BaseAudioContext,bus:AudioNode,at:number,notes:number[][],{d=.42,gain=.05,gap=.14}={}){
    notes.forEach((chord,i)=>chord.forEach(f=>{
      const t=at+i*gap,len=i===notes.length-1?d*2.6:d,o=c.createOscillator(),o2=c.createOscillator(),lp=c.createBiquadFilter(),g=c.createGain();
      o.type='sawtooth';o2.type='sawtooth';o.frequency.value=f;o2.frequency.value=f*1.004;lp.type='lowpass';lp.Q.value=1.2;
      lp.frequency.setValueAtTime(350,t);lp.frequency.exponentialRampToValueAtTime(2800,t+.06);lp.frequency.exponentialRampToValueAtTime(1100,t+len);
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain/chord.length*1.6,t+.035);g.gain.exponentialRampToValueAtTime(.0001,t+len);
      o.connect(lp);o2.connect(lp);lp.connect(g);g.connect(bus);this.own(o,t,t+len+.05,[lp,g]);this.own(o2,t,t+len+.05,[]);
    }));
  }
  private choir(c:BaseAudioContext,bus:AudioNode,at:number,chord:number[],d=2,gain=.06){
    chord.forEach(f=>{const o=c.createOscillator(),v=c.createOscillator(),vg=c.createGain(),f1=c.createBiquadFilter(),f2=c.createBiquadFilter(),g=c.createGain();
      o.type='sawtooth';o.frequency.value=f;v.frequency.value=5.2;vg.gain.value=f*.012;v.connect(vg);vg.connect(o.frequency);
      f1.type='bandpass';f2.type='bandpass';f1.frequency.value=730;f1.Q.value=6;f2.frequency.value=1090;f2.Q.value=7;
      g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+d*.4);g.gain.exponentialRampToValueAtTime(.0001,at+d);
      o.connect(f1);o.connect(f2);f1.connect(g);f2.connect(g);g.connect(bus);this.own(o,at,at+d+.05,[f1,f2,g,vg]);this.own(v,at,at+d+.05,[]);});
  }
  private hyperspace(c:BaseAudioContext,bus:AudioNode,at:number){
    const o=c.createOscillator(),f=c.createBiquadFilter(),g=c.createGain();o.type='sawtooth';o.frequency.setValueAtTime(55,at);o.frequency.exponentialRampToValueAtTime(880,at+1.05);
    f.type='lowpass';f.frequency.setValueAtTime(200,at);f.frequency.exponentialRampToValueAtTime(5000,at+1.05);g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.07,at+.9);g.gain.exponentialRampToValueAtTime(.0001,at+1.25);
    o.connect(f);f.connect(g);g.connect(bus);this.own(o,at,at+1.3,[f,g]);
    this.noise(c,bus,at,1.1,{from:200,to:9000,q:.8,gain:.08,attack:.9});
    this.osc(c,bus,at+1.05,48,{d:1.6,gain:.2,to:28});this.noise(c,bus,at+1.05,.9,{type:'lowpass',from:2000,to:120,gain:.12,attack:.005});
    [1568,2093,2637].forEach((x,i)=>this.osc(c,bus,at+1.1+i*.05,x,{d:1.4,gain:.012,attack:.02}));
  }
  private holo(c:BaseAudioContext,bus:AudioNode,at:number,f:number,d=.09,gain=.025){this.osc(c,bus,at,f,{d,gain,to:f*.85,attack:.002});this.osc(c,bus,at,f*2,{d:d*.7,gain:gain*.3,attack:.002});}
  private humStop(at?:number){const c=this.host.context,bus=this.bus;const hum=this.hum;this.hum=undefined;if(!hum||!c||!bus)return;this.retract(c,bus,hum,at??c.currentTime+.02);}

  /** Schedules one cue and reports its output-timeline target, so visuals land on the audible accent. */
  schedule(cue:GalacticCue,index=0){
    const c=this.host.context,out=this.host.output;
    if(!this.enabled()||!this.effects||!c||!out)return {delayMs:0,target:performance.now(),mode:'silent'};
    const bus=this.route(c,out),at=c.currentTime+.035;
    switch(cue){
      case 'start':this.humStop(at);this.hum=this.saber(c,bus,at,.06,20);this.noise(c,bus,at,.42,{from:500,to:3600,q:1.4,gain:.05});this.osc(c,bus,at,55,{d:.3,gain:.08,to:90});break;
      case 'stop':this.osc(c,bus,at,58,{d:.2,gain:.12,to:38});this.osc(c,bus,at,1200+index*90,{type:'triangle',d:.12,gain:.02,attack:.001});this.noise(c,bus,at,.07,{type:'highpass',from:3000,to:2000,gain:.03,attack:.001});if(index===4)this.humStop(at+.05);break;
      case 'nudge':this.clash(c,bus,at,1);this.noise(c,bus,at,.3,{from:300,to:2400,q:1.5,gain:.04});break;
      case 'line':this.swing(c,bus,at,.9);[880,1174.66,1318.51].forEach((f,k)=>this.osc(c,bus,at+.18+k*.05,f,{d:.5,gain:.012,attack:.01}));break;
      case 'partial':this.humStop(at);this.holo(c,bus,at,330,.12,.02);break;
      case 'return':this.humStop(at);this.holo(c,bus,at,523.25,.14,.022);this.holo(c,bus,at,659.25,.14,.016);break;
      case 'win':this.swing(c,bus,at,1.1);this.brass(c,bus,at+.18,[[293.66],[440],[587.33,739.99,880]],{gain:.055});break;
      case 'big':this.duck(4.2);this.hyperspace(c,bus,at);for(let i=0;i<10;i++)this.osc(c,bus,at+.4+i*.06,73.42,{d:.35,gain:.05+i*.008,to:65});this.clash(c,bus,at+1.1,.9);this.brass(c,bus,at+1.15,[[293.66],[392],[440],[587.33,739.99,880,1174.66]],{gain:.07,gap:.16});break;
      case 'vortex':this.duck(3);this.force(c,bus,at,1.6,1.1);this.choir(c,bus,at+.4,[146.83,220,293.66],2,.06);break;
      case 'bonus':this.clash(c,bus,at,.7);this.choir(c,bus,at,[293.66,349.23,440,659.25],2.2,.07);this.brass(c,bus,at+.25,[[220],[293.66,440]],{gain:.05,gap:.22});break;
      case 'finale':this.swing(c,bus,at,1);this.brass(c,bus,at+.2,[[293.66],[369.99],[440,587.33,739.99]],{gain:.055,gap:.16});break;
      case 'segment':this.holo(c,bus,at,880+index*70,.07,.02);break;
      case 'flip':this.holo(c,bus,at,1320,.05,.016);break;
      case 'side':{const old=this.saber(c,bus,at,.05,1.2);this.retract(c,bus,old,at+.2);this.force(c,bus,at,.7,.6);break;}
    }
    this.counts[cue]=(this.counts[cue]??0)+1;
    const stamp=c.getOutputTimestamp?.();const target=stamp&&stamp.performanceTime&&stamp.contextTime?stamp.performanceTime+(at-stamp.contextTime)*1000:performance.now()+(at-c.currentTime+(c.outputLatency||c.baseLatency||0))*1000;
    return {delayMs:Math.max(0,Math.min(160,target-performance.now())),target,mode:stamp?.performanceTime?'output-timestamp':'latency-estimate'};
  }
  /** The new side's blade ignites after the old one retracts; call after the side has changed. */
  igniteSide(){const c=this.host.context,out=this.host.output;if(!this.enabled()||!this.effects||!c||!out)return;const bus=this.route(c,out),at=c.currentTime+.03,voice=this.saber(c,bus,at,.08,2);this.retract(c,bus,voice,at+1);}
  /** Ends the spin hum without a new cue, for an interrupted or recovered round. */
  release(){this.humStop();}
  private cancelEffects(){this.hum=undefined;for(const source of this.sources)try{source.stop();}catch{}this.sources.clear();}
  cancel(){this.cancelEffects();this.stopMusic();}
  pause(){this.paused=true;this.cancel();}
  resume(){this.paused=false;if(this.enabled())this.startMusic();}
  getState(){return {music:this.music,effects:this.effects,activeEffects:this.sources.size,musicPlaying:!!this.musicSource,loaded:!!this.musicBuffer,counts:{...this.counts}};}
  destroy(){this.dead=true;this.lifetime.abort();this.unsubscribe();this.cancel();this.bus?.disconnect();this.wet?.disconnect();}
}
