import { t as translateText } from '../i18n/index';
import { CasinoAudio } from './CasinoAudio';
import { TableAudio, type TableSoundSet } from './TableAudio';
import {SlotAudio,SLOT_AUDIO_GAMES,type SlotCue,type SlotAudioGame} from './SlotAudio';
export type Sound='step'|'cabinet'|'start'|'bounce'|'block'|'laser'|'explosion'|'coin'|'maze'|'crash'|'win'|'lose'|'cue'|'hit'|'rail'|'pocket'|'goal'|'foul';
export type AudioPreferences={muted:boolean;volume:number;casinoEnabled:boolean};
export class GameAudio {
  context?:AudioContext;
  output?:GainNode;
  private ambience?:GainNode;
  private analyser?:AnalyserNode;
  private engine?:{osc:OscillatorNode;gain:GainNode};
  private muted=false;
  private volume=.35;
  private game='';
  private hall='arcade';
  private casino?:CasinoAudio;
  private tables?:TableAudio;
  private casinoEnabled=true;
  private slotOwners=new Set<SlotAudio>();
  private slotDucks=new Set<SlotAudio>();
  private slotPlayed:Partial<Record<SlotCue,number>>={};
  private slotCanceled=0;
  private slotPlayedByGame:Partial<Record<SlotAudioGame,Partial<Record<SlotCue,number>>>>={};
  private slotCanceledByGame:Partial<Record<SlotAudioGame,number>>={};
  private preferences=new Set<(value:AudioPreferences)=>void>();
  getPreferences():AudioPreferences{return {muted:this.muted,volume:this.volume,casinoEnabled:this.casinoEnabled};}
  onPreferences(listener:(value:AudioPreferences)=>void){this.preferences.add(listener);listener(this.getPreferences());return ()=>{this.preferences.delete(listener);};}
  setMuted(value:boolean){this.muted=value;this.applyPreferences();}
  setVolume(value:number){if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('Invalid game volume');this.volume=value;this.applyPreferences();}
  private applyPreferences(){
    if(this.context&&this.output)this.output.gain.setTargetAtTime(this.muted?0:this.volume,this.context.currentTime,.04);
    if(this.muted||this.volume===0)this.cancelSlots();this.syncAmbience();
    try{localStorage.setItem('royal-muted',this.muted?'1':'0');localStorage.setItem('royal-volume',String(this.volume));localStorage.setItem('royal-casino-ambience',this.casinoEnabled?'1':'0');}catch{}
    const value=this.getPreferences();for(const listener of this.preferences)listener(value);
  }
  createSlotAudio(game:SlotAudioGame):SlotAudio {
    if(!SLOT_AUDIO_GAMES.includes(game))throw new RangeError('Slot audio is not configured for this game');
    const owner=new SlotAudio({context:()=>this.context,output:()=>this.output,
      enabled:()=>!this.muted&&this.volume>0&&!document.hidden&&this.context?.state==='running',unlock:()=>this.unlock(),
      reducedMotion:()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false,
      duck:active=>{if(active)this.slotDucks.add(owner);else this.slotDucks.delete(owner);this.syncAmbience();},
      played:cue=>{this.slotPlayed[cue]=(this.slotPlayed[cue]??0)+1;const counts=this.slotPlayedByGame[game]??={};counts[cue]=(counts[cue]??0)+1;},
      canceled:()=>{this.slotCanceled++;this.slotCanceledByGame[game]=(this.slotCanceledByGame[game]??0)+1;},
      disposed:()=>{this.slotOwners.delete(owner);this.slotDucks.delete(owner);this.syncAmbience();}},game);
    this.slotOwners.add(owner);return owner;
  }
  private cancelSlots(){for(const owner of this.slotOwners)owner.cancel();}
  setHall(hall:string){this.hall=hall;this.syncAmbience();}
  private syncAmbience(){
    const enabled=!this.muted&&this.volume>0&&!document.hidden&&this.context?.state==='running';
    const duck=this.slotDucks.size?.22:1;
    this.casino?.update(this.hall,this.game,enabled&&this.casinoEnabled,duck);
    if(this.context&&this.ambience)this.ambience.gain.setTargetAtTime((this.game==='demo'?0:this.game?.004:.012)*duck,this.context.currentTime,.2);
  }
  private buffer?:AudioBuffer;
  private last=new Map<string,number>();
  private counts:Record<string,number>={};
  private active=0;
  private installed=false;
  async unlock(){
    if(document.hidden)return;
    try{
      if(!this.context){
        this.context=new AudioContext();const c=this.context;
        this.output=c.createGain();this.output.gain.value=this.muted?0:this.volume;const limiter=c.createDynamicsCompressor();limiter.threshold.value=-12;limiter.ratio.value=5;this.analyser=c.createAnalyser();this.analyser.fftSize=256;this.output.connect(this.analyser);this.analyser.connect(limiter);limiter.connect(c.destination);
        this.buffer=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const data=this.buffer.getChannelData(0);let brown=0;for(let i=0;i<data.length;i++){brown=(brown+(Math.random()*2-1)*.025)/1.025;data[i]=brown*5;}
        const noise=c.createBufferSource();noise.buffer=this.buffer;noise.loop=true;
        const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=700;
        this.ambience=c.createGain();this.ambience.gain.value=0;noise.connect(filter);filter.connect(this.ambience);this.ambience.connect(this.output);noise.start();
        this.casino=new CasinoAudio(c,this.output,kind=>{const key='casino-'+kind;this.counts[key]=(this.counts[key]||0)+1;});
        this.tables=new TableAudio(c,this.output);
        c.addEventListener('statechange',()=>{if(c.state!=='running')this.cancelSlots();this.syncAmbience();});
      }
      if(this.context.state==='suspended'||String(this.context.state)==='interrupted')await this.context.resume();
      this.syncAmbience();
    }catch{/* A later gesture can resume audio when the browser permits it. */}
  }
  install(){
    if(this.installed)return;this.installed=true;
    try{this.volume=Number(localStorage.getItem('royal-volume')??.35);if(!Number.isFinite(this.volume))this.volume=.35;this.volume=Math.max(0,Math.min(1,this.volume));this.muted=localStorage.getItem('royal-muted')==='1';this.casinoEnabled=localStorage.getItem('royal-casino-ambience')!=='0';}catch{}
    for(const event of ['pointerdown','pointerup','keydown'])document.addEventListener(event,()=>{void this.unlock();},{capture:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.cancelSlots();this.syncAmbience();void this.context?.suspend();}else if(this.context)void this.unlock();});
    const value=this.getPreferences();for(const listener of this.preferences)listener(value);
  }
  createSettings(){
    const panel=document.createElement('fieldset');panel.className='audio-preferences';panel.innerHTML=translateText('<legend>Звук</legend><label><input id="sound-enabled" type="checkbox"> Звуки игры</label><label><input id="casino-ambience" type="checkbox"> Атмосфера казино</label><label for="sound-volume">Громкость <output id="sound-volume-value"></output></label><input id="sound-volume" type="range" min="0" max="100" aria-label="Громкость игры"><div id="piano-sound-setting"></div><small>Изменения звука сохраняются сразу.</small>');
    const enabled=panel.querySelector<HTMLInputElement>('#sound-enabled')!,volume=panel.querySelector<HTMLInputElement>('#sound-volume')!;enabled.checked=!this.muted;volume.value=String(Math.round(this.volume*100));
    const casino=panel.querySelector<HTMLInputElement>('#casino-ambience')!;casino.checked=this.casinoEnabled;
    const apply=()=>{this.muted=!enabled.checked;this.volume=Number(volume.value)/100;this.casinoEnabled=casino.checked;this.applyPreferences();};
    this.onPreferences(value=>{enabled.checked=!value.muted;volume.value=String(Math.round(value.volume*100));casino.checked=value.casinoEnabled;panel.querySelector('output')!.textContent=volume.value+'%';});
    panel.querySelector('output')!.textContent=volume.value+'%';
    enabled.addEventListener('change',apply);volume.addEventListener('input',apply);casino.addEventListener('change',apply);
    return panel;
  }
  addSettingsButton(parent:HTMLElement){
    const button=document.createElement('button');button.type='button';button.className='settings-shortcut text-button';button.textContent=translateText('Настройки');button.setAttribute('aria-label',translateText('Открыть настройки'));parent.append(button);
    button.addEventListener('click',()=>document.querySelector<HTMLButtonElement>(translateText('.profile [aria-label="Настройки игрока"]'))?.click());
  }
  setGame(game:string){
    for(const owner of this.slotOwners)if(owner.gameId!==game)owner.cancel();
    this.game=game;this.engine?.osc.stop();this.engine=undefined;
    this.syncAmbience();
    if(game==='drift'&&this.context&&this.output){const c=this.context,osc=c.createOscillator(),gain=c.createGain();osc.type='sawtooth';osc.frequency.value=48;gain.gain.value=.032;const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=170;osc.connect(filter);filter.connect(gain);gain.connect(this.output);osc.start();osc.onended=()=>{osc.disconnect();filter.disconnect();gain.disconnect();};this.engine={osc,gain};}
  }
  engineSpeed(speed:number){if(this.engine&&this.context)this.engine.osc.frequency.setTargetAtTime(48+Math.min(1,speed)*55,this.context.currentTime,.2);}
  private tone(frequency:number,end:number,duration:number,level:number,type:OscillatorType='sine',delay=0){
    const c=this.context!;const osc=c.createOscillator(),gain=c.createGain(),at=c.currentTime+delay;
    osc.type=type;osc.frequency.setValueAtTime(frequency,at);osc.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+duration);gain.gain.setValueAtTime(.001,at);gain.gain.linearRampToValueAtTime(level,at+.005);gain.gain.exponentialRampToValueAtTime(.001,at+duration);osc.connect(gain);gain.connect(this.output!);osc.start(at);osc.stop(at+duration+.02);this.active++;osc.onended=()=>{osc.disconnect();gain.disconnect();this.active--;};
  }
  private noise(duration:number,level:number,frequency:number){const c=this.context!,source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter();source.buffer=this.buffer!;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.6;gain.gain.setValueAtTime(level,c.currentTime);gain.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);source.connect(filter);filter.connect(gain);gain.connect(this.output!);source.start();source.stop(c.currentTime+duration+.01);this.active++;source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();this.active--;};}
  effect(kind:Sound,level=1,table?:TableSoundSet){
    if(this.context?.state!=='running'||this.muted||this.volume===0||document.hidden||this.active+(this.tables?.getState().active??0)>40)return;
    const set=table??(['hockey','pool','chess'].includes(this.game)?this.game as TableSoundSet:undefined),key=(set?set+':':'')+kind;
    const now=performance.now();if(now-(this.last.get(key)??-1000)<(kind==='step'?65:kind==='laser'?100:35))return;this.last.set(key,now);this.counts[kind]=(this.counts[kind]||0)+1;
    const v=Math.min(1,Math.max(0,level))*(this.game&&kind==='step'?.22:1)*(this.slotDucks.size&&kind==='step'?.22:1);
    if(set&&this.tables?.play(set,kind,v))return;
    if(kind==='step'){this.noise(.065,.11*v,240);this.tone(92,55,.075,.055*v);}
    else if(kind==='cabinet'||kind==='coin'||kind==='win'||kind==='start')this.casino?.play(kind,v);
    else if(kind==='laser')this.tone(1200,180,.09,.045*v,'triangle');
    else if(kind==='crash'||kind==='explosion'){this.noise(.28,.34*v,430);this.tone(90,32,.3,.12*v);}
    else if(kind==='goal'){[523,659,784].forEach((f,i)=>this.tone(f,f,.22,.09*v,'triangle',i*.11));}
    else if(kind==='lose'||kind==='foul'){this.tone(240,75,.4,.12*v,'triangle');}
    else if(kind==='maze'){this.noise(.055,.075*v,650);this.tone(240,200,.055,.025*v);}
    else if(kind==='pocket'){this.noise(.12,.17*v,190);this.tone(140,60,.13,.12*v);}
    else if(kind==='cue'||kind==='hit'||kind==='rail'){this.noise(.035,.3*v,kind==='rail'?500:1600);this.tone(kind==='cue'?600:420,180,.055,.07*v);}
    else this.tone(kind==='block'?750:440,kind==='block'?980:300,.085,.085*v,'triangle');
  }
  getState(){const data=new Float32Array(256);this.analyser?.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);const owned=[...this.slotOwners].map(owner=>owner.getState());
    const byGame=Object.fromEntries(SLOT_AUDIO_GAMES.map(game=>{const owners=[...this.slotOwners].filter(owner=>owner.gameId===game).map(owner=>owner.getState());return[game,{activeSources:owners.reduce((sum,owner)=>sum+owner.activeSources,0),loopOwners:owners.filter(owner=>owner.looping).length,owners:owners.length,played:{...this.slotPlayedByGame[game]},canceled:this.slotCanceledByGame[game]??0}];}));
    const slot={activeSources:owned.reduce((sum,value)=>sum+value.activeSources,0),loopOwners:owned.filter(value=>value.looping).length,owners:owned.length,played:{...this.slotPlayed},canceled:this.slotCanceled,byGame};return{rms,engine:!!this.engine,context:this.context?.state||'locked',muted:this.muted,volume:this.volume,game:this.game,hall:this.hall,casinoEnabled:this.casinoEnabled,casino:this.casino?.getState()??{active:0,scheduled:false,level:0},table:this.tables?.getState()??{active:0,played:{}},active:this.active+(this.tables?.getState().active??0)+slot.activeSources,counts:{...this.counts},slot};}
}
export const gameAudio=new GameAudio();
