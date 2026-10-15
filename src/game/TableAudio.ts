export type TableSoundSet='hockey'|'pool'|'chess';

/** Short material resonances and a quiet room reflection, made in Web Audio. */
export class TableAudio {
  private input:GainNode;
  private noise:AudioBuffer;
  private voices=new Set<AudioScheduledSourceNode>();
  private played:Record<string,number>={};
  constructor(private context:BaseAudioContext,output:AudioNode){
    const c=context;this.input=c.createGain();this.input.gain.value=.82;
    const soften=c.createBiquadFilter();soften.type='lowpass';soften.frequency.value=4800;soften.Q.value=.5;
    this.input.connect(soften);soften.connect(output);
    const reflection=c.createDelay(.1),wet=c.createGain();reflection.delayTime.value=.027;wet.gain.value=.055;
    soften.connect(reflection);reflection.connect(wet);wet.connect(output);
    this.noise=c.createBuffer(1,Math.ceil(c.sampleRate*.3),c.sampleRate);
    const data=this.noise.getChannelData(0);let seed=723;
    for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=seed/2147483648-1;}
  }
  private voice(source:AudioScheduledSourceNode,nodes:AudioNode[],gain:GainNode,at:number,duration:number,level:number){
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.002);
    gain.gain.exponentialRampToValueAtTime(.00001,at+duration);
    gain.connect(this.input);this.voices.add(source);source.start(at);source.stop(at+duration+.01);
    source.onended=()=>{source.disconnect();gain.disconnect();nodes.forEach(n=>n.disconnect());this.voices.delete(source);};
  }
  private tone(frequency:number,duration:number,level:number,delay=0){
    const c=this.context,source=c.createOscillator(),gain=c.createGain(),at=c.currentTime+delay;
    source.frequency.setValueAtTime(frequency,at);source.frequency.exponentialRampToValueAtTime(frequency*.97,at+duration);
    source.connect(gain);this.voice(source,[],gain,at,duration,level);
  }
  private tap(frequency:number,duration:number,level:number,delay=0){
    const c=this.context,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
    source.buffer=this.noise;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.7;
    source.connect(filter);filter.connect(gain);this.voice(source,[filter],gain,c.currentTime+delay,duration,level);
  }
  play(game:TableSoundSet,kind:string,level=1){
    if(!['hit','cue','rail','pocket','goal','foul','win','lose','coin'].includes(kind)||this.voices.size>36)return false;
    const v=Math.min(1,Math.max(0,level)),tone=(f:number,d:number,l:number,at=0)=>this.tone(f,d,l*v,at),tap=(f:number,d:number,l:number,at=0)=>this.tap(f,d,l*v,at);
    if(kind==='win'||kind==='goal'){
      (kind==='goal'?[392,494,587]:[262,330,392,524]).forEach((f,i)=>{tone(f,.28,.075,i*.09);tone(f*2,.13,.013,i*.09);});
    }else if(kind==='foul'||kind==='lose'){
      tone(220,.13,.055);tone(174,.19,.045,.13);
    }else if(game==='chess'){
      tap(1150,.03,.065);tone(185,.065,.07);tone(710,.025,.022);
      if(kind==='coin'){tap(800,.025,.055,.04);tone(260,.055,.045,.04);}
    }else if(kind==='pocket'){
      tap(380,.075,.13);tone(105,.1,.11);tap(680,.035,.055,.045);
    }else if(game==='hockey'){
      tap(kind==='rail'?1050:2200,.024,.105);tone(kind==='rail'?310:650,.045,.065);tone(155,.035,.025);
    }else if(kind==='rail'){
      tap(650,.035,.075);tone(160,.065,.065);
    }else if(kind==='cue'){
      tap(1550,.019,.16);tone(340,.038,.085);tone(960,.019,.018);
    }else{
      tap(1900,.015,.12);tone(760,.027,.075);tone(280,.024,.035);
    }
    const key=game+':'+kind;this.played[key]=(this.played[key]||0)+1;return true;
  }
  getState(){return{active:this.voices.size,played:{...this.played}};}
}
