import { forestMusicNotes } from './ForestMusic';

export type ForestCue = 'land' | 'turn' | 'flow' | 'flower' | 'choice' | 'bonus' | 'win' | 'big';
type Group = 'music' | 'effects';
type Instrument = 'wood' | 'creak' | 'water' | 'glass' | 'leaves' | 'harp' | 'flute' | 'pad' | 'drum' | 'gong';
type Voice = { source: AudioBufferSourceNode; nodes: AudioNode[]; group: Group; at: number; end: number };
type Bank = { samples: Record<Instrument, AudioBuffer>; room: AudioBuffer };
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const banks = new WeakMap<BaseAudioContext, Bank>();
const basePitch: Record<Instrument, number> = {wood:50,creak:50,water:50,glass:81,leaves:50,harp:60,flute:74,pad:50,drum:42,gong:50};

/** Original sampled synthesis, with independent textures and no use of the game's RNG. */
function makeBank(c: BaseAudioContext): Bank {
  const existing = banks.get(c); if (existing) return existing;
  let seed = 161803;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const make = (seconds: number, sample: (t: number, noise: number) => number) => {
    const buffer = c.createBuffer(1,Math.ceil(c.sampleRate * seconds),c.sampleRate), data = buffer.getChannelData(0);
    let peak = 0;
    for (let i=0;i<data.length;i++) { const t=i/c.sampleRate; data[i]=sample(t,random()); peak=Math.max(peak,Math.abs(data[i])); }
    for (let i=0;i<data.length;i++) data[i] *= .9 / Math.max(.01,peak);
    return buffer;
  };
  const sin = (frequency: number,t: number) => Math.sin(2*Math.PI*frequency*t);
  let friction = 0, water = 0, breath = 0;
  const samples: Record<Instrument,AudioBuffer> = {
    wood:make(.22,(t,n)=>(sin(174,t)+.54*sin(327,t)+.2*sin(718,t))*Math.exp(-t*32)+n*.5*Math.exp(-t*180)),
    creak:make(.34,(t,n)=>{
      friction=.7*friction+.3*n;
      return (friction*.8+Math.sin(2*Math.PI*(143*t+.19*Math.sin(t*67)))*.22)*Math.sin(Math.PI*t/.34)**2*(.75+.25*sin(37,t));
    }),
    water:make(1.05,(t,n)=>{
      water=.92*water+.08*n;
      let drops=0;
      for(const start of [.025,.14,.31,.54,.73]) {const d=t-start;if(d>=0&&d<.12)drops+=Math.sin(2*Math.PI*(950*d+18*(1-Math.exp(-d*45))))*Math.exp(-d*40)*.17;}
      return (water*.7+drops)*Math.sin(Math.PI*Math.min(1,t/1.05))**.7;
    }),
    glass:make(2.1,(t)=>{
      const f=hz(81);
      return sin(f,t)*Math.exp(-t*3.3)+.4*sin(f*2.71,t)*Math.exp(-t*8)+.18*sin(f*5.41,t)*Math.exp(-t*15);
    }),
    leaves:make(.38,(t,n)=>n*(.35+.65*Math.sin(t*47)**2)*Math.sin(Math.PI*t/.38)**2),
    harp:make(2.7,(t,n)=>{
      const f=hz(60);
      return sin(f,t)*Math.exp(-t*2.5)+.25*sin(f*2,t)*Math.exp(-t*5.5)+.1*sin(f*3,t)*Math.exp(-t*9)+n*.06*Math.exp(-t*75);
    }),
    flute:make(3.2,(t,n)=>{
      breath=.72*breath+.28*n;
      const phase=2*Math.PI*hz(74)*t+.055*Math.sin(t*31);
      return (Math.sin(phase)+.17*Math.sin(phase*2)+.065*Math.sin(phase*3)+breath*.08)*(.94+.06*sin(3.1,t));
    }),
    pad:make(7.8,(t)=>{
      const f=hz(50);
      return (sin(f*.998,t)+sin(f*1.002,t))*.48+.12*sin(f*2,t)+.035*sin(f*3,t);
    }),
    drum:make(.36,(t,n)=>Math.sin(2*Math.PI*(53*t+3.5*(1-Math.exp(-t*21))))*Math.exp(-t*15)+n*.075*Math.exp(-t*90)),
    gong:make(3.1,(t)=>{
      const f=hz(50);
      return sin(f,t)*Math.exp(-t*1.5)+.45*sin(f*1.52,t)*Math.exp(-t*2)+.25*sin(f*2.23,t)*Math.exp(-t*3)+.13*sin(f*3.77,t)*Math.exp(-t*5);
    }),
  };
  const room=c.createBuffer(2,Math.ceil(c.sampleRate*.85),c.sampleRate);
  for(let channel=0;channel<2;channel++){
    const data=room.getChannelData(channel);let low=0;
    for(let i=0;i<data.length;i++){
      const t=i/c.sampleRate;low=.55*low+.45*random();
      data[i]=t<.018+channel*.009?0:low*Math.exp(-t*7)*.15;
    }
  }
  const bank={samples,room};banks.set(c,bank);return bank;
}

/** All voices and reverberation belong to this module; the context and output belong to Royal. */
export class ForestScore {
  private voices=new Set<Voice>();
  private bank:Bank;
  private master:GainNode;
  private music:GainNode;
  private effects:GainNode;
  private rooms:Record<Group,ConvolverNode>;
  private wet:GainNode[]=[];
  private duckUntil=0;
  private disposed=false;
  constructor(readonly context:BaseAudioContext,output:AudioNode){
    const c=context;this.bank=makeBank(c);
    this.master=c.createGain();this.master.gain.value=.7;this.master.connect(output);
    this.music=c.createGain();this.music.gain.value=1;this.music.connect(this.master);
    this.effects=c.createGain();this.effects.connect(this.master);
    this.rooms={music:c.createConvolver(),effects:c.createConvolver()};
    for(const group of ['music','effects'] as const){
      const room=this.rooms[group],wet=c.createGain();room.buffer=this.bank.room;wet.gain.value=group==='music'?.17:.12;
      this[group].connect(room);room.connect(wet);wet.connect(this.master);this.wet.push(wet);
    }
  }
  private play(instrument:Instrument,midi:number,at:number,duration:number,level:number,pan:number,group:Group){
    if(this.disposed)return;
    const rate=2**((midi-basePitch[instrument])/12),buffer=this.bank.samples[instrument];
    const loop=instrument==='pad'||instrument==='flute';
    const end=at+Math.min(duration,loop?duration:buffer.duration/rate);
    if([...this.voices].filter(v=>v.at<end&&v.end>at).length>=48)return;
    const c=this.context,source=c.createBufferSource(),gain=c.createGain(),panner=c.createStereoPanner();
    source.buffer=buffer;source.playbackRate.value=rate;source.loop=loop;panner.pan.value=pan;
    const attack=instrument==='pad'?.3:instrument==='flute'?.065:.003;
    const release=instrument==='pad'?.5:instrument==='flute'?.15:.035;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+Math.min(attack,duration*.3));
    gain.gain.setValueAtTime(level,at+Math.max(attack,duration-release));gain.gain.linearRampToValueAtTime(0,at+duration);
    source.connect(gain);gain.connect(panner);panner.connect(this[group]);
    const voice={source,nodes:[gain,panner],group,at,end};this.voices.add(voice);
    source.onended=()=>this.remove(voice);source.start(at);source.stop(at+duration+.01);
  }
  private remove(voice:Voice){
    voice.source.onended=null;voice.source.disconnect();voice.nodes.forEach(n=>n.disconnect());this.voices.delete(voice);
  }
  private duck(at:number,hold:number){
    this.duckUntil=Math.max(this.duckUntil,at+hold);
    this.music.gain.cancelScheduledValues(at);this.music.gain.setTargetAtTime(.42,at,.018);
    this.music.gain.setTargetAtTime(1,this.duckUntil,.24);
  }
  cue(cue:ForestCue,at:number,variant=0){
    const effect=(instrument:Instrument,midi:number,delay:number,duration:number,level:number,pan=0)=>this.play(instrument,midi,at+delay,duration,level,pan,'effects');
    this.duck(at,cue==='big'?2.6:cue==='bonus'?1.4:cue==='win'?1.1:cue==='flow'?.7:.4);
    switch(cue){
      case 'land':effect('wood',45,0,.2,.2);effect('drum',40,.008,.2,.05);break;
      case 'turn':effect('wood',64,0,.12,.12);effect('creak',50,.005,.34,.11,-.12);break;
      case 'flow':effect('water',50,0,1.05,.17,-.12);break;
      case 'flower':effect('glass',[81,86,88][((variant%3)+3)%3],0,1.05,.13,(variant-1)*.2);break;
      case 'choice':
        effect('leaves',50,0,.32,.075,-.35);effect('flute',81,.025,.35,.08,.2);effect('flute',76,.25,.46,.065,.2);break;
      case 'bonus':
        effect('gong',62,0,1.4,.065);effect('drum',42,0,.28,.1);
        [62,69,74].forEach((midi,i)=>effect('pad',midi,i*.09,1.4,.09,i%2?.4:-.4));
        effect('harp',86,.48,1.1,.1,.3);break;
      case 'win':
        [62,65,69,74].forEach((midi,i)=>effect('harp',midi,i*.045,1.5,.12,i%2?.35:-.35));
        effect('glass',86,.16,.9,.045,.15);break;
      case 'big':
        effect('gong',38,0,2.7,.11);[0,.3,.65].forEach(delay=>effect('drum',42,delay,.3,.085));
        [50,57,65].forEach((midi,i)=>effect('pad',midi,.03+i*.025,2.6,.095,i%2?.4:-.4));
        [74,77,81,86].forEach((midi,i)=>effect('harp',midi,.43+i*.12,1.6,.13,i%2?.45:-.45));break;
    }
  }
  tick(index:number,at:number,bonus:boolean){
    for(const note of forestMusicNotes(index,bonus))this.play(note.instrument,note.midi,at+note.delay,note.duration,note.level,note.pan,'music');
  }
  private clearRoom(group:Group){this.rooms[group].buffer=null;if(!this.disposed)this.rooms[group].buffer=this.bank.room;}
  cancelMusic(){
    for(const voice of [...this.voices])if(voice.group==='music'){try{voice.source.stop();}catch{}this.remove(voice);}
    this.clearRoom('music');
  }
  cancel(){
    for(const voice of [...this.voices]){try{voice.source.stop();}catch{}this.remove(voice);}
    this.clearRoom('music');this.clearRoom('effects');
    this.music.gain.cancelScheduledValues(this.context.currentTime);this.music.gain.value=1;this.duckUntil=0;
  }
  get active(){return this.voices.size;}
  get activeMusic(){return [...this.voices].filter(v=>v.group==='music').length;}
  get activeEffects(){return [...this.voices].filter(v=>v.group==='effects').length;}
  destroy(){this.disposed=true;this.cancel();this.music.disconnect();this.effects.disconnect();Object.values(this.rooms).forEach(n=>n.disconnect());this.wet.forEach(n=>n.disconnect());this.master.disconnect();}
}
