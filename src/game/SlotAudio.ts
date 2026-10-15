export type SlotOutcome = 'loss'|'return'|'win'|'bigwin';
export const SLOT_AUDIO_GAMES=['studio-neon-crown','studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-starfall-oracle','studio-lumen-grove','studio-prism-atelier','studio-stormforge-duel','studio-saffron-cipher','studio-beacon-bay'] as const;
export type SlotAudioGame=typeof SLOT_AUDIO_GAMES[number];
export type SlotEffect='expand'|'sticky'|'multiplier'|'free-stage'|'collapse'|'drop'|'refill'|'orb'|'collect'|'cell-values'|'chosen'|'beam';
export type SlotCue = 'click'|'reel-stop'|'line'|'group'|SlotEffect|SlotOutcome;
export type SlotAudioEnvironment = {
  context:()=>BaseAudioContext|undefined;
  output:()=>AudioNode|undefined;
  enabled:()=>boolean;
  unlock:()=>Promise<void>;
  reducedMotion:()=>boolean;
  duck:(enabled:boolean)=>void;
  played:(cue:SlotCue)=>void;
  canceled:()=>void;
  disposed:()=>void;
};
type Voice = {source:AudioScheduledSourceNode;gain:GainNode;nodes:AudioNode[];startAt:number};
const PROFILES={
  'studio-neon-crown':{reels:3,lines:5,motorFrequency:82.41,motorLevel:.006,filter:510,airLevel:.043},
  'studio-cosmic-escape':{reels:5,lines:20,motorFrequency:73.42,motorLevel:.003,filter:360,airLevel:.016},
  'studio-velvet-reign':{reels:5,lines:14,motorFrequency:87.31,motorLevel:.0028,filter:310,airLevel:.016},
  'studio-caramel-carnival':{reels:6,lines:0,motorFrequency:98,motorLevel:.0026,filter:350,airLevel:.014},
  'studio-starfall-oracle':{reels:6,lines:0,motorFrequency:73.42,motorLevel:.0024,filter:290,airLevel:.013},
  'studio-lumen-grove':{reels:6,lines:0,motorFrequency:164.81,motorLevel:.0022,filter:300,airLevel:.01},
  'studio-prism-atelier':{reels:6,lines:0,motorFrequency:110,motorLevel:.002,filter:340,airLevel:.01},
  'studio-stormforge-duel':{reels:5,lines:16,motorFrequency:61.735,motorLevel:.0018,filter:320,airLevel:.009},
  'studio-saffron-cipher':{reels:5,lines:15,motorFrequency:92.5,motorLevel:.0017,filter:380,airLevel:.009},
  'studio-beacon-bay':{reels:5,lines:20,motorFrequency:73.415,motorLevel:.0018,filter:290,airLevel:.0085},
} satisfies Record<SlotAudioGame,{reels:number;lines:number;motorFrequency:number;motorLevel:number;filter:number;airLevel:number}>;

/** Original procedural palettes. Each playback owns all its sources, including future notes. */
export class SlotAudio {
  private token='';
  private seen=new Set<string>();
  private stopped=new Set<number>();
  private lines=new Set<number>();
  private effects=new Set<string>();
  private groups=new Set<number>();
  private collections=0;
  private voices=new Set<Voice>();
  private loop:Voice[]=[];
  private noise?:{context:BaseAudioContext;buffer:AudioBuffer};
  private color?:{context:BaseAudioContext;wave:PeriodicWave};
  private motion=true;
  private finished=false;
  private mode:'reels'|'cascade'='reels';
  private cascadeConfirmed=false;
  private cascadeSettled=false;
  private dead=false;
  private release?:ReturnType<typeof setTimeout>;
  constructor(private environment:SlotAudioEnvironment,readonly gameId:SlotAudioGame='studio-neon-crown'){}

  begin(token:string,options:{motion?:boolean;click?:boolean}={}) {
    if(!this.open(token,options,'reels'))return;
    const click=options.click!==false;
    void this.environment.unlock().then(()=>{
      if(!this.accepts(token)||this.finished||!this.ready())return;
      this.environment.duck(true);if(click){this.playClick();this.environment.played('click');}
      if(this.motion&&!this.stopped.size)this.startLoop();
    }).catch(()=>{});
  }
  beginCascade(token:string,options:{motion?:boolean}={}){
    if(!this.isCascadeGame()||!this.open(token,options,'cascade'))return;
    void this.environment.unlock().then(()=>{if(this.accepts(token)&&!this.finished&&this.ready())this.environment.duck(true);}).catch(()=>{});
  }
  confirmCascade(token:string){if(this.accepts(token)&&!this.finished&&this.mode==='cascade')this.cascadeConfirmed=true;}
  settleCascade(token:string){if(this.accepts(token)&&!this.finished&&this.mode==='cascade'){this.cascadeConfirmed=true;this.cascadeSettled=true;}}
  private open(token:string,options:{motion?:boolean},mode:'reels'|'cascade'){
    if(this.dead||!token||this.seen.has(token))return false;
    this.abort(false);this.token=token;this.finished=false;this.stopped.clear();this.lines.clear();this.effects.clear();
    this.groups.clear();this.collections=0;this.mode=mode;this.cascadeConfirmed=false;this.cascadeSettled=false;
    this.motion=options.motion??!this.environment.reducedMotion();this.seen.add(token);
    if(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  stopReel(token:string,index:number) {
    if(!this.accepts(token)||this.finished||this.mode!=='reels'||!Number.isInteger(index)||index<0||index>=PROFILES[this.gameId].reels||this.stopped.has(index))return;
    this.stopped.add(index);
    if(this.motion&&this.ready()){
      if(this.gameId==='studio-neon-crown'){
        this.tone(88,.07,.018);this.tone([196,246.94,293.66][index],.19,.025,.012);this.tap(520,.055,.016);
      }else if(this.gameId==='studio-cosmic-escape'){
        const note=[196,246.94,293.66,369.99,440][index];
        this.tone(73.42,.065,.007);this.music(note,.23,.028,.008);this.tap(450,.05,.009);
      }else if(this.gameId==='studio-velvet-reign'){
        const note=[174.61,220,261.63,329.63,392][index];
        this.tone(87.31,.09,.01);this.music(note,.25,.029,.012);this.tap(440,.07,.009);
      }else if(this.isElementGame()){
        const forge=this.gameId==='studio-stormforge-duel',cipher=this.gameId==='studio-saffron-cipher';
        const note=(forge?[246.94,293.66,369.99,440,493.88]:cipher?[185,220,277.18,329.63,369.99]:[293.66,369.99,440,493.88,587.33])[index];
        this.tone(forge?123.47:cipher?92.5:146.83,.07,.005);this.music(note,.27,.028,.012);this.tap(forge?400:cipher?510:330,.055,.006);
      }else if(this.isClusterGame()){
        const forest=this.gameId==='studio-lumen-grove',note=(forest?[164.81,196,220,246.94,293.66,329.63]:[220,277.18,329.63,369.99,440,554.37])[index];
        this.tone(forest?82.41:110,.07,.006);this.music(note,.24,.027,.012);this.tap(forest?370:490,.055,.007);
      }else{
        const candy=this.gameId==='studio-caramel-carnival',note=(candy?[196,261.63,329.63,392,440,523.25]:[174.61,220,261.63,293.66,349.23,440])[index];
        this.tone(candy?98:73.42,.07,.007);this.music(note,.23,.028,.012);this.tap(candy?480:350,.055,.008);
      }
      this.environment.played('reel-stop');
    }
    if(this.stopped.size===PROFILES[this.gameId].reels)this.stopLoop();
  }
  line(token:string,index:number) {
    if(!this.accepts(token)||this.finished||!this.motion||this.stopped.size!==PROFILES[this.gameId].reels||!Number.isInteger(index)||index<0||index>=PROFILES[this.gameId].lines||this.lines.has(index))return;
    this.lines.add(index);
    if(this.ready()){
      if(this.gameId==='studio-neon-crown')this.tone([261.63,329.63,392,440,523.25][index],.22,.018);
      else if(this.isElementGame()){
        const notes=this.gameId==='studio-stormforge-duel'?[293.66,369.99,440,493.88,587.33]:this.gameId==='studio-saffron-cipher'?[220,277.18,329.63,369.99,440]:[369.99,440,493.88,587.33,659.25];
        this.music(notes[index%5],.24,.02);
      }
      else this.music((this.gameId==='studio-cosmic-escape'?[293.66,369.99,440,493.88,587.33]:[220,261.63,329.63,392,440])[index%5],.24,.021);
      this.environment.played('line');
    }
  }
  group(token:string,index:number){
    if(!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>=this.groupLimit()||this.groups.has(index))return;
    this.groups.add(index);if(!this.ready())return;
    if(this.isClusterGame()){
      const note=(this.gameId==='studio-lumen-grove'?[329.63,392,440]:[277.18,329.63,369.99,440])[index];
      this.music(note,.25,.024);this.music(note*1.5,.18,.006,.03);
    }else{
      const note=(this.gameId==='studio-caramel-carnival'?[261.63,329.63,392]:[293.66,349.23,440])[index];
      this.music(note,.28,.025);this.music(note*1.5,.18,.005,.035);
    }
    this.environment.played('group');
  }
  effect(token:string,kind:SlotEffect,eventId:string){
    if(!this.accepts(token)||this.finished||!this.motion||this.gameId==='studio-neon-crown'||typeof eventId!=='string'||!eventId||eventId.length>192)return;
    if(this.isCascadeGame()){
      if(!['collapse','drop','refill','orb'].includes(kind)||kind==='orb'&&(this.gameId!=='studio-starfall-oracle'||!this.stageReady())
        ||kind!=='orb'&&(this.mode!=='cascade'||!this.cascadeConfirmed||this.cascadeSettled))return;
    }else if(this.isClusterGame()){
      if(!this.stageReady()||!['collect','cell-values','free-stage'].includes(kind)
        ||kind==='collect'&&(this.gameId!=='studio-lumen-grove'||this.collections>=2)
        ||kind==='cell-values'&&this.gameId!=='studio-prism-atelier')return;
    }else if(this.isElementGame()){
      const allowed=this.gameId==='studio-stormforge-duel'?['expand','multiplier','free-stage']:this.gameId==='studio-saffron-cipher'?['chosen','free-stage']:['beam','free-stage'];
      if(!this.stageReady()||!allowed.includes(kind))return;
    }else if(this.stopped.size!==PROFILES[this.gameId].reels||!['expand','sticky','multiplier','free-stage'].includes(kind))return;
    const key=kind+':'+eventId;if(this.effects.has(key))return;this.effects.add(key);
    if(!this.ready())return;
    if(this.isClusterGame()){this.clusterEffect(kind);this.environment.played(kind);return;}
    if(this.isCascadeGame()){this.cascadeEffect(kind);this.environment.played(kind);return;}
    if(this.isElementGame()){this.elementEffect(kind);this.environment.played(kind);return;}
    const cosmic=this.gameId==='studio-cosmic-escape';
    if(kind==='expand'){
      (cosmic?[196,369.99,587.33]:[174.61,261.63,440]).forEach((note,i)=>this.music(note,.28,.022,i*.08));
    }else if(kind==='sticky'){
      (cosmic?[196,293.66]:[174.61,261.63]).forEach(note=>this.music(note,.34,.021));
      this.tap(cosmic?410:310,.08,.008);
    }else if(kind==='multiplier'){
      (cosmic?[293.66,369.99,440]:[261.63,329.63,392]).forEach((note,i)=>this.music(note,.22,.02,i*.075));
    }else{
      (cosmic?[246.94,369.99,493.88]:[220,329.63,440]).forEach((note,i)=>this.music(note,.34,.024,i*.11));
    }
    this.environment.played(kind);
  }
  private elementEffect(kind:SlotEffect){
    const forge=this.gameId==='studio-stormforge-duel',cipher=this.gameId==='studio-saffron-cipher';
    if(kind==='expand'){
      [246.94,369.99,493.88].forEach((note,i)=>this.music(note,.29,.021,i*.075));
    }else if(kind==='multiplier'){
      [369.99,440,587.33].forEach((note,i)=>this.music(note,.23,.019,i*.065));
    }else if(kind==='chosen'){
      [185,277.18,369.99].forEach((note,i)=>this.music(note,.23,.017,i*.07));
    }else if(kind==='beam'){
      [293.66,440,587.33].forEach((note,i)=>this.music(note,.31,.021,i*.085));
    }else{
      (forge?[293.66,369.99,493.88]:cipher?[220,277.18,369.99]:[369.99,493.88,587.33]).forEach((note,i)=>this.music(note,.31,.022,i*.085));
    }
  }
  private cascadeEffect(kind:SlotEffect){
    const candy=this.gameId==='studio-caramel-carnival';
    if(kind==='collapse'){
      this.tap(candy?620:420,.1,.015);this.music(candy?392:349.23,.16,.013);this.music(candy?261.63:220,.18,.012,.065);
    }else if(kind==='drop'){
      this.tap(candy?430:310,.075,.012);this.music(candy?196:146.83,.2,.014);
    }else if(kind==='refill'){
      (candy?[261.63,329.63,392]:[220,293.66,349.23]).forEach((note,i)=>this.music(note,.25,.019,i*.055));
    }else{
      [293.66,440,587.33].forEach((note,i)=>this.music(note,.28,.019,i*.085));
    }
  }
  private clusterEffect(kind:SlotEffect){
    const forest=this.gameId==='studio-lumen-grove';
    if(kind==='collect'){
      const notes=this.collections++===0?[196,246.94,329.63]:[220,293.66,440];
      notes.forEach((note,i)=>this.music(note,.27,.021,i*.075));this.tap(410,.09,.007);
    }else if(kind==='cell-values'){
      [277.18,329.63,440].forEach((note,i)=>this.music(note,.23,.021,i*.055));
    }else{
      (forest?[196,293.66,392]:[220,329.63,554.37]).forEach((note,i)=>this.music(note,.3,.023,i*.075));
    }
  }
  outcome(token:string,kind:SlotOutcome) {
    if(!this.accepts(token)||this.finished||(this.motion&&!this.stageReady())||(this.mode==='cascade'&&!this.cascadeSettled))return;
    this.finished=true;this.stopLoop();
    if(this.ready()){
      if(this.isClusterGame())this.playClusterOutcome(kind);
      else if(this.isCascadeGame())this.playCascadeOutcome(kind);
      else if(this.isElementGame())this.playElementOutcome(kind);
      else if(this.gameId!=='studio-neon-crown')this.playThemedOutcome(kind);
      else if(kind==='bigwin'){
        [196,261.63,329.63,392,523.25,392,329.63,523.25].forEach((f,i)=>this.tone(f,.36,.03,i*.105));
        [261.63,329.63,392].forEach(f=>this.tone(f,.58,.021,.86));
      }else if(kind==='win'){
        [261.63,329.63,392].forEach((f,i)=>this.tone(f,.36,.028,i*.14));
        this.tone(523.25,.4,.022,.43);
      }else if(kind==='return'){
        this.tone(261.63,.24,.017);this.tone(329.63,.27,.014,.09);
      }else{
        this.tone(130.81,.16,.013);this.tone(164.81,.19,.01,.06);
      }
      this.environment.played(kind);
    }
    clearTimeout(this.release);
    const release=(this.isClusterGame()||this.isElementGame())&&!this.motion?500:this.gameId==='studio-neon-crown'?(kind==='bigwin'?1500:kind==='win'?900:400):(kind==='bigwin'?2000:kind==='win'?1250:500);
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},release);
  }
  private playElementOutcome(kind:SlotOutcome){
    const forge=this.gameId==='studio-stormforge-duel',cipher=this.gameId==='studio-saffron-cipher';
    const root=forge?123.47:cipher?92.5:146.83,tonic=forge?246.94:cipher?185:293.66,third=forge?293.66:cipher?220:369.99,fifth=forge?369.99:cipher?277.18:440;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.17,.007);return;}
      this.music(tonic,.24,.01);this.music(kind==='return'?third:fifth,.26,.007,.075);
      if(kind==='bigwin')this.music(tonic*2,.28,.005,.075);
      return;
    }
    if(kind==='bigwin'){
      const notes=forge?[246.94,293.66,369.99,493.88,440,369.99,587.33,493.88,440,739.99]:cipher?[185,220,277.18,369.99,329.63,440,369.99,554.37,440,739.99]:[293.66,369.99,440,587.33,493.88,659.25,587.33,739.99,659.25,880];
      const rhythm=forge?[0,.11,.22,.43,.54,.65,.86,.97,1.08,1.29]:cipher?[0,.12,.24,.42,.54,.66,.84,.96,1.08,1.27]:[0,.105,.21,.42,.525,.63,.84,.945,1.05,1.28];
      notes.forEach((note,i)=>this.music(note,i===9?.55:.32,i===9?.04:.033,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.56,i===0?.01:.017,rhythm[9]));
    }else if(kind==='win'){
      const notes=forge?[246.94,293.66,369.99,440,493.88,369.99,587.33]:cipher?[185,220,277.18,329.63,369.99,277.18,440]:[293.66,369.99,440,493.88,587.33,493.88,659.25];
      const rhythm=forge?[0,.11,.22,.36,.47,.61,.78]:cipher?[0,.12,.24,.39,.51,.66,.78]:[0,.1,.2,.35,.45,.6,.76];
      notes.forEach((note,i)=>this.music(note,i===6?.42:.28,.029,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.5,i===0?.009:.013,.62));
    }else if(kind==='return'){
      this.music(tonic,.23,.01);this.music(third,.26,.007,.09);
    }else{
      this.tone(root,.16,.007);this.tone(root*1.5,.19,.005,.06);
    }
  }
  private playClusterOutcome(kind:SlotOutcome){
    const forest=this.gameId==='studio-lumen-grove';
    if(!this.motion){
      const note=forest?196:220;
      if(kind==='loss'){this.tone(forest?82.41:110,.18,.008);return;}
      this.music(note,.26,.012);this.music(kind==='return'?(forest?246.94:277.18):(forest?329.63:440),.28,.008,.08);
      if(kind==='bigwin')this.music(forest?392:554.37,.3,.006,.08);
      return;
    }
    if(kind==='bigwin'){
      const notes=forest?[164.81,196,220,293.66,329.63,392,440,493.88,440,659.25]:[220,277.18,329.63,440,369.99,554.37,493.88,440,369.99,659.25];
      const rhythm=[0,.11,.22,.44,.55,.66,.88,.99,1.1,1.28];
      notes.forEach((note,i)=>this.music(note,i===9?.58:.33,i===9?.041:.034,rhythm[i]));
      (forest?[82.41,196,329.63,392]:[110,220,277.18,329.63]).forEach((note,i)=>this.music(note,.57,i===0?.012:.018,1.28));
    }else if(kind==='win'){
      const notes=forest?[164.81,196,220,329.63,293.66,392,440,329.63]:[220,277.18,329.63,440,369.99,493.88,554.37,440];
      const rhythm=[0,.1,.2,.35,.45,.55,.67,.78];
      notes.forEach((note,i)=>this.music(note,i===7?.42:.27,.03,rhythm[i]));
      (forest?[82.41,196,329.63]:[110,277.18,329.63]).forEach((note,i)=>this.music(note,.52,i===0?.01:.014,.62));
    }else if(kind==='return'){
      this.music(forest?196:220,.24,.011);this.music(forest?246.94:277.18,.27,.008,.1);
    }else{
      this.tone(forest?82.41:110,.16,.008);this.tone(forest?123.47:164.81,.2,.005,.06);
    }
  }
  private playCascadeOutcome(kind:SlotOutcome){
    const candy=this.gameId==='studio-caramel-carnival';
    if(kind==='bigwin'){
      const notes=candy?[261.63,329.63,392,523.25,440,392,523.25,659.25,587.33,523.25]:[146.83,220,293.66,349.23,440,587.33,523.25,440,349.23,587.33];
      const rhythm=[0,.105,.21,.42,.525,.63,.84,.945,1.05,1.26];
      notes.forEach((note,i)=>this.music(note,i===9?.58:.34,i===9?.042:.035,rhythm[i]));
      (candy?[130.81,261.63,329.63,392]:[73.42,220,293.66,349.23]).forEach((note,i)=>this.music(note,.58,i===0?.012:.019,1.26));
    }else if(kind==='win'){
      const notes=candy?[261.63,329.63,392,523.25,440,523.25]:[146.83,220,293.66,349.23,440,587.33];
      const rhythm=candy?[0,.11,.22,.42,.55,.7]:[0,.14,.28,.45,.61,.75];
      notes.forEach((note,i)=>this.music(note,i===5?.42:.3,.032,rhythm[i]));
      (candy?[130.81,261.63,329.63]:[73.42,220,293.66]).forEach((note,i)=>this.music(note,.52,i===0?.012:.015,.55));
    }else if(kind==='return'){
      this.music(candy?261.63:220,.24,.012);this.music(candy?329.63:293.66,.28,.008,.1);
    }else{
      this.tone(candy?130.81:110,.17,.008);this.tone(candy?196:146.83,.2,.006,.06);
    }
  }
  private playThemedOutcome(kind:SlotOutcome){
    const cosmic=this.gameId==='studio-cosmic-escape';
    if(kind==='bigwin'){
      const notes=cosmic?[196,246.94,293.66,440,369.99,587.33,493.88,440,369.99,587.33]:[174.61,220,261.63,349.23,440,392,329.63,261.63,349.23,523.25];
      const rhythm=cosmic?[0,.105,.21,.42,.525,.63,.84,.945,1.05,1.26]:[0,.11,.22,.44,.55,.66,.88,.99,1.1,1.32];
      notes.forEach((note,i)=>this.music(note,i===9?.58:.34,i===9?.043:.037,rhythm[i]));
      (cosmic?[98,196,293.66,369.99]:[87.31,174.61,220,261.63]).forEach((note,i)=>this.music(note,.58,i===0?.014:.021,rhythm[9]));
    }else if(kind==='win'){
      const notes=cosmic?[196,246.94,293.66,440,369.99,587.33]:[174.61,261.63,329.63,392,349.23];
      const rhythm=cosmic?[0,.1,.24,.34,.5,.64]:[0,.14,.28,.48,.7];
      notes.forEach((note,i)=>this.music(note,i===notes.length-1?.44:.31,.033,rhythm[i]));
      this.music(cosmic?98:87.31,1.05,.012);
      (cosmic?[196,293.66,369.99]:[174.61,220,261.63]).forEach(note=>this.music(note,.5,.014,.52));
    }else if(kind==='return'){
      this.music(cosmic?196:174.61,.25,.012);this.music(cosmic?246.94:220,.28,.009,.09);
    }else{
      this.tone(cosmic?98:87.31,.16,.009);this.tone(cosmic?146.83:130.81,.19,.006,.06);
    }
  }
  cancel(token?:string) {if(token!==undefined&&token!==this.token)return;this.abort(true);}
  dispose() {if(this.dead)return;this.abort(true);this.dead=true;this.environment.disposed();}
  private accepts(token:string){return !this.dead&&!!token&&token===this.token;}
  private isCascadeGame(){return this.gameId==='studio-caramel-carnival'||this.gameId==='studio-starfall-oracle';}
  private isClusterGame(){return this.gameId==='studio-lumen-grove'||this.gameId==='studio-prism-atelier';}
  private isElementGame(){return this.gameId==='studio-stormforge-duel'||this.gameId==='studio-saffron-cipher'||this.gameId==='studio-beacon-bay';}
  private groupLimit(){return this.gameId==='studio-prism-atelier'?4:this.isCascadeGame()||this.isClusterGame()?3:0;}
  private stageReady(){return this.mode==='cascade'?this.cascadeSettled:this.stopped.size===PROFILES[this.gameId].reels;}
  private ready(){return this.environment.enabled()&&!!this.environment.context()&&!!this.environment.output()&&this.voices.size<28;}
  private abort(report:boolean) {
    const wasActive=!!this.token||this.voices.size>0;
    this.token='';this.finished=true;clearTimeout(this.release);this.release=undefined;
    for(const voice of this.voices)this.stopVoice(voice,.025);
    this.voices.clear();this.loop=[];this.environment.duck(false);
    if(report&&wasActive)this.environment.canceled();
  }
  private connect(source:AudioScheduledSourceNode,gain:GainNode,nodes:AudioNode[]=[],startAt=this.environment.context()!.currentTime):Voice {
    gain.connect(this.environment.output()!);
    const voice={source,gain,nodes,startAt};this.voices.add(voice);
    source.onended=()=>{source.disconnect();gain.disconnect();nodes.forEach(node=>node.disconnect());this.voices.delete(voice);};
    return voice;
  }
  private stopVoice(voice:Voice,fade:number) {
    const context=this.environment.context();if(!context)return;
    const now=context.currentTime;
    try{
      if(voice.startAt>now){voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(0,now);voice.source.stop(now);}
      else{voice.gain.gain.cancelAndHoldAtTime(now);voice.gain.gain.linearRampToValueAtTime(0,now+fade);voice.source.stop(now+fade+.005);}
    }catch{}
  }
  private music(frequency:number,duration:number,level:number,delay=0){return this.tone(frequency,duration,level,delay,true);}
  private timbre(c:BaseAudioContext){
    if(this.color?.context===c)return this.color.wave;
    const partials=this.gameId==='studio-cosmic-escape'?[0,1,.1,.024,.008]:this.gameId==='studio-caramel-carnival'?[0,1,.12,.023,.008]:this.gameId==='studio-starfall-oracle'?[0,1,.04,.1,.015]:this.gameId==='studio-lumen-grove'?[0,1,.08,.034,.01,.004]:this.gameId==='studio-prism-atelier'?[0,1,.04,.07,.012,.005]:this.gameId==='studio-stormforge-duel'?[0,1,.14,.047,.009,.004]:this.gameId==='studio-saffron-cipher'?[0,1,.085,.024,.015,.006]:this.gameId==='studio-beacon-bay'?[0,1,.045,.095,.012,.002]:[0,1,.07,.085,.012];
    const wave=c.createPeriodicWave(new Float32Array(partials.length),new Float32Array(partials));this.color={context:c,wave};return wave;
  }
  private tone(frequency:number,duration:number,level:number,delay=0,musical=false):Voice {
    const c=this.environment.context()!,source=c.createOscillator(),gain=c.createGain(),at=c.currentTime+delay;
    source.type='sine';source.frequency.setValueAtTime(frequency,at);
    if(musical)source.setPeriodicWave(this.timbre(c));
    const attack=musical?(this.gameId==='studio-cosmic-escape'?.022:this.gameId==='studio-caramel-carnival'?.022:this.gameId==='studio-starfall-oracle'?.03:this.gameId==='studio-lumen-grove'?.025:this.gameId==='studio-stormforge-duel'?.025:this.gameId==='studio-saffron-cipher'?.018:this.gameId==='studio-beacon-bay'?.026:.028):.012;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+attack);
    gain.gain.exponentialRampToValueAtTime(.00001,at+duration);
    source.connect(gain);const voice=this.connect(source,gain,[],at);
    source.start(at);source.stop(at+duration+.02);return voice;
  }
  private noiseBuffer(c:BaseAudioContext):AudioBuffer {
    if(this.noise?.context===c)return this.noise.buffer;
    const buffer=c.createBuffer(1,Math.ceil(c.sampleRate*2),c.sampleRate),data=buffer.getChannelData(0);let seed=19517,brown=0;
    for(let i=0;i<data.length;i++){
      seed=(seed*1664525+1013904223)>>>0;brown=(brown+(seed/2147483648-1)*.035)/1.035;
      const edge=Math.min(1,i/(c.sampleRate*.015),(data.length-1-i)/(c.sampleRate*.015));data[i]=brown*3*edge;
    }
    this.noise={context:c,buffer};return buffer;
  }
  private tap(frequency:number,duration:number,level:number) {
    const c=this.environment.context()!,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain(),at=c.currentTime;
    source.buffer=this.noiseBuffer(c);filter.type='lowpass';filter.frequency.value=frequency;filter.Q.value=.4;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.008);gain.gain.exponentialRampToValueAtTime(.00001,at+duration);
    source.connect(filter);filter.connect(gain);this.connect(source,gain,[filter]);source.start(at);source.stop(at+duration+.02);
  }
  private playClick(){
    if(this.gameId==='studio-neon-crown'){this.tone(174.61,.08,.018);this.tap(650,.06,.026);}
    else if(this.gameId==='studio-cosmic-escape'){this.tone(196,.08,.013);this.tap(560,.055,.014);}
    else if(this.gameId==='studio-velvet-reign'){this.tone(174.61,.095,.013);this.tap(420,.07,.014);}
    else if(this.gameId==='studio-caramel-carnival'){this.tone(261.63,.08,.012);this.tap(580,.06,.012);}
    else if(this.gameId==='studio-lumen-grove'){this.tone(196,.08,.011);this.tap(420,.06,.011);}
    else if(this.gameId==='studio-prism-atelier'){this.tone(220,.085,.011);this.tap(520,.06,.011);}
    else if(this.gameId==='studio-stormforge-duel'){this.tone(246.94,.09,.01);this.tap(400,.06,.009);}
    else if(this.gameId==='studio-saffron-cipher'){this.tone(185,.075,.01);this.tap(510,.05,.009);}
    else if(this.gameId==='studio-beacon-bay'){this.tone(293.66,.085,.01);this.tap(330,.06,.009);}
    else{this.tone(220,.095,.012);this.tap(350,.07,.012);}
  }
  private startLoop() {
    const c=this.environment.context()!,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
    const profile=PROFILES[this.gameId];
    source.buffer=this.noiseBuffer(c);source.loop=true;filter.type='lowpass';filter.frequency.value=profile.filter;filter.Q.value=.5;
    gain.gain.setValueAtTime(0,c.currentTime);gain.gain.linearRampToValueAtTime(profile.airLevel,c.currentTime+.12);
    source.connect(filter);filter.connect(gain);const air=this.connect(source,gain,[filter]);source.start();
    const hum=c.createOscillator(),humGain=c.createGain();hum.type='sine';hum.frequency.value=profile.motorFrequency;
    humGain.gain.setValueAtTime(0,c.currentTime);humGain.gain.linearRampToValueAtTime(profile.motorLevel,c.currentTime+.14);
    hum.connect(humGain);const motor=this.connect(hum,humGain);hum.start();this.loop=[air,motor];
  }
  private stopLoop(){for(const voice of this.loop)this.stopVoice(voice,.055);this.loop=[];}
  getState(){return {activeSources:this.voices.size,looping:this.loop.length>0,token:this.token,finished:this.finished,mode:this.mode,cascadeConfirmed:this.cascadeConfirmed,cascadeSettled:this.cascadeSettled};}
}
