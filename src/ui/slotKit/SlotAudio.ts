import {gameAudio} from '../../game/GameAudio';

import type {SlotAudioProfile} from './SlotDefinition';

type Voice={oscillator:OscillatorNode;gain:GainNode};
/** Shared synth transport; each game supplies its own musical profile. */
export class SlotAudio {
  private voices=new Set<Voice>();
  private spinTimer?:ReturnType<typeof setInterval>;
  private musicTimer?:ReturnType<typeof setInterval>;
  private token='';
  private spinGeneration=0;
  private entered=false;
  private destroyed=false;
  private generation=0;
  private beat=0;
  private music=true;
  private counts:Record<string,number>={};
  private unsubscribe:()=>void;
  constructor(private profile: SlotAudioProfile){
    try{this.music=localStorage.getItem(this.profile.musicStorageKey)!=='0';}catch{}
    this.unsubscribe=gameAudio.onPreferences(()=>{if(!this.enabled())this.silence();else this.startMusic();});
  }
  private enabled(){const prefs=gameAudio.getPreferences();return !this.destroyed&&!document.hidden&&!prefs.muted&&prefs.volume>0&&gameAudio.context?.state==='running';}
  async enter(){const generation=++this.generation;this.entered=true;await gameAudio.unlock();if(generation===this.generation&&this.entered)this.startMusic();}
  musicEnabled(){return this.music;}
  setMusic(value:boolean){this.music=value;try{localStorage.setItem(this.profile.musicStorageKey,value?'1':'0');}catch{}if(value)this.startMusic();else{clearInterval(this.musicTimer);this.musicTimer=undefined;}}
  protected audioOutput():GainNode|undefined{return gameAudio.output;}
  protected note(frequency:number,duration:number,level:number,offset=0,type:OscillatorType='sine',slide=0){
    const context=gameAudio.context,output=this.audioOutput();
    if(!this.enabled()||!context||!output||this.voices.size>=40)return;
    const oscillator=context.createOscillator(),gain=context.createGain(),at=context.currentTime+offset;
    oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,at);
    if(slide)oscillator.frequency.exponentialRampToValueAtTime(frequency*slide,at+duration);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    oscillator.connect(gain);gain.connect(output);const voice={oscillator,gain};this.voices.add(voice);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.voices.delete(voice);};oscillator.start(at);oscillator.stop(at+duration+.03);
  }
  protected cue(name:string){if(this.enabled())this.counts[name]=(this.counts[name]??0)+1;}
  private startMusic(){
    if(!this.entered||!this.music||!this.enabled()||this.musicTimer)return;
    const chords=this.profile.musicChords;
    const melody=this.profile.melody;
    const play=()=>{if(!this.enabled()||!this.entered||!this.music){clearInterval(this.musicTimer);this.musicTimer=undefined;return;}const chord=chords[Math.floor(this.beat/8)%chords.length];this.note(chord[melody[this.beat%8]]*2,.9,.006,0,'triangle');if(this.beat%4===0){this.note(chord[0]/2,1.7,.012);this.note(chord[1],1.5,.004);this.note(chord[2],1.5,.004);}this.beat++;this.cue('music');};
    play();this.musicTimer=setInterval(play,this.profile.musicIntervalMs);
  }
  async begin(token:string){
    this.stopSpin();this.token=token;const generation=this.generation,spinGeneration=this.spinGeneration;await gameAudio.unlock();
    if(generation!==this.generation||spinGeneration!==this.spinGeneration||this.token!==token||!this.enabled())return;
    this.cue('spin');let tick=0;
    const play=()=>{if(this.token!==token||!this.enabled()){this.stopSpin();return;}const notes=this.profile.spinNotes;this.note(notes[tick++%notes.length],.135,.014,0,'triangle');if(tick%4===0)this.note(110,.18,.014);};
    play();this.spinTimer=setInterval(play,this.profile.spinIntervalMs);this.startMusic();
  }
  stopReel(column:number){this.cue('reel-stop');this.note(440*2**(column/12),.2,.024,0,'triangle');this.note(110*2**(column/12),.1,.011);}
  stopSpin(){this.spinGeneration++;this.token='';clearInterval(this.spinTimer);this.spinTimer=undefined;}
  cascade(index:number){this.cue('cascade');[440,554.37,659.26,880].forEach((frequency,i)=>this.note(frequency*2**(Math.min(index,3)/12),.4,.018,i*.075,'triangle'));}
  energy(){this.cue('energy');[329.63,440,554.37,659.26,880,1108.73].forEach((frequency,i)=>this.note(frequency,.45,.018,i*.075,'sine'));}
  tickets(){this.cue('tickets');[440,659.26,880,1108.73].forEach((frequency,i)=>this.note(frequency,.6,.024,i*.13,'triangle'));}
  drop(){this.note(440,.2,.016,0,'sine',.5);}
  feature(kind:string){
    this.cue(kind);
    const sound=this.profile.featureCues[kind];
    if(sound==='expand'){this.note(164.81,.75,.026,0,'sine',4);this.note(329.63,.9,.014,.1,'triangle',2);}
    else if(sound==='silent')return;
    else if(sound==='echo'){this.note(880,.45,.022,0,'triangle',.5);this.note(440,.6,.018,.15,'triangle',2);}
    else if(sound==='tickets')this.tickets();else if(sound==='drop')this.drop();else this.cascade(1);
  }
  outcome(won:boolean){this.cue(won?'win':'settle');if(won)[440,554.37,659.26,880].forEach((frequency,i)=>this.note(frequency,.62,.023,i*.075,'triangle'));else this.note(329.63,.23,.008);}
  pause(){this.generation++;this.entered=false;this.silence();}
  private silence(){this.stopSpin();clearInterval(this.musicTimer);this.musicTimer=undefined;for(const voice of this.voices){try{voice.oscillator.stop();}catch{}voice.oscillator.disconnect();voice.gain.disconnect();}this.voices.clear();}
  state(){return{activeSources:this.voices.size,spinning:!!this.spinTimer,music:!!this.musicTimer,counts:{...this.counts}};}
  destroy(){this.destroyed=true;this.pause();this.unsubscribe();}
}
