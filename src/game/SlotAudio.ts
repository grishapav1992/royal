export type SlotOutcome = 'loss'|'return'|'win'|'bigwin';
export const SLOT_AUDIO_GAMES=['studio-neon-crown','studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-starfall-oracle','studio-lumen-grove','studio-prism-atelier','studio-stormforge-duel','studio-saffron-cipher','studio-beacon-bay','studio-copperline-express','studio-pulse-district','studio-jade-koi','studio-sky-lanterns','studio-rivet-rally','studio-frostline-courier','studio-deep-current','studio-blazing-orchard','studio-ember-vault','studio-midnight-market','studio-moonlit-mint','studio-petal-parlor','studio-sunbird-trails','royal-fruits','variant-fruits','royal-plinko','variant-plinko','variant-target-plinko','studio-obsidian-drop','studio-saffron-spin','studio-lucky-spotlight','royal-dice','variant-dice','studio-signal-fox','royal-limbo','variant-limbo'] as const;
export type SlotAudioGame=typeof SLOT_AUDIO_GAMES[number];
export type SlotEffect='expand'|'sticky'|'multiplier'|'free-stage'|'collapse'|'drop'|'refill'|'orb'|'collect'|'cell-values'|'chosen'|'beam'|'walking'|'wish-pin'|'synced'|'mystery';
export type ConfirmedWheelSector=Readonly<{sector:number;target:0|1|2|3;segments:readonly (0|1|2|3)[]}>;
export type ConfirmedDiceRoll=Readonly<{rollMinor:number;outcomeCount:100|10000;winRange:Readonly<{minInclusive:number;maxExclusive:number}>;won:boolean}>;
export type ConfirmedLimboRoll=Readonly<{rolledCents:number;stakeUnits:string;returnedUnits:string;targetCents:readonly number[]}>;
export type SlotCue = 'limbo-start'|'limbo-hit'|'limbo-reveal'|'dice-start'|'dice-reveal'|'wheel-start'|'wheel-contact'|'wheel-landing'|'plinko-drop'|'plinko-pin'|'plinko-landing'|'click'|'reel-stop'|'line'|'group'|'ways'|'coin'|'wheel'|'trail'|SlotEffect|SlotOutcome;
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
  'studio-copperline-express':{reels:5,lines:20,motorFrequency:73.415,motorLevel:.0017,filter:310,airLevel:.008},
  'studio-pulse-district':{reels:5,lines:10,motorFrequency:82.405,motorLevel:.0016,filter:340,airLevel:.008},
  'studio-jade-koi':{reels:3,lines:5,motorFrequency:98,motorLevel:.0015,filter:280,airLevel:.0075},
  'studio-sky-lanterns':{reels:6,lines:0,motorFrequency:73.415,motorLevel:.0013,filter:300,airLevel:.007},
  'studio-rivet-rally':{reels:5,lines:0,motorFrequency:87.305,motorLevel:.0014,filter:340,airLevel:.0075},
  'studio-frostline-courier':{reels:5,lines:0,motorFrequency:98,motorLevel:.0013,filter:280,airLevel:.0068},
  'studio-deep-current':{reels:5,lines:20,motorFrequency:110,motorLevel:.00115,filter:270,airLevel:.0063},
  'studio-blazing-orchard':{reels:5,lines:40,motorFrequency:116.54,motorLevel:.0012,filter:330,airLevel:.0065},
  'studio-ember-vault':{reels:5,lines:20,motorFrequency:77.78,motorLevel:.0011,filter:340,airLevel:.006},
  'studio-midnight-market':{reels:5,lines:10,motorFrequency:130.815,motorLevel:.00105,filter:310,airLevel:.0058},
  'studio-moonlit-mint':{reels:3,lines:5,motorFrequency:146.83,motorLevel:.001,filter:260,airLevel:.0055},
  'studio-petal-parlor':{reels:5,lines:10,motorFrequency:110,motorLevel:.001,filter:295,airLevel:.0055},
  'studio-sunbird-trails':{reels:5,lines:10,motorFrequency:82.405,motorLevel:.001,filter:300,airLevel:.0055},
  'royal-fruits':{reels:3,lines:1,motorFrequency:130.815,motorLevel:.00095,filter:300,airLevel:.0048},
  'variant-fruits':{reels:3,lines:3,motorFrequency:146.83,motorLevel:.001,filter:350,airLevel:.0052},
  'royal-plinko':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'variant-plinko':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'variant-target-plinko':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'studio-obsidian-drop':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'studio-saffron-spin':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'studio-lucky-spotlight':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'royal-dice':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'variant-dice':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'studio-signal-fox':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'royal-limbo':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
  'variant-limbo':{reels:0,lines:0,motorFrequency:0,motorLevel:0,filter:0,airLevel:0},
} satisfies Record<SlotAudioGame,{reels:number;lines:number;motorFrequency:number;motorLevel:number;filter:number;airLevel:number}>;

/** Original procedural palettes. Each playback owns all its sources, including future notes. */
export class SlotAudio {
  private limbo?:{click:boolean;confirmation?:ConfirmedLimboRoll;hits:number[];revealed:boolean;revealedAt:number};
  private dice?:{click:boolean;confirmation?:ConfirmedDiceRoll;revealed:boolean};
  private standaloneWheel?:{sectors:12|16;click:boolean;confirmation?:ConfirmedWheelSector;contacts:number;lastContactAt:number;landed:boolean};
  private plinko?:{rows:number;balls:number;click:boolean;dropped:Set<number>;paths:number[][];landed:Set<number>};
  private token='';
  private seen=new Set<string>();
  private stopped=new Set<number>();
  private lines=new Set<number>();
  private effects=new Set<string>();
  private groups=new Set<number>();
  private coins=new Set<number>();
  private holdStage:'base'|'hold'='base';
  private bonusStep:0|1|2=0;
  private wheelPlayed=false;
  private trailPlayed=false;
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
  constructor(private environment:SlotAudioEnvironment,readonly gameId:SlotAudioGame='studio-neon-crown'){
    if(this.isCollectGame())this.line=(token,index)=>this.collectLine(token,index);
    if(this.isHoldGame())this.line=(token,index)=>this.holdLine(token,index);
    if(this.isWheelTrailGame())this.line=(token,index)=>this.wheelTrailLine(token,index);
    if(this.isFruitsGame())this.line=(token,index)=>this.fruitsLine(token,index);
    if(this.isPlinkoGame()){this.begin=()=>{};this.line=()=>{};this.effect=()=>{};this.outcome=(token,kind)=>this.plinkoOutcome(token,kind);}
    if(this.isTargetDropGame()){
      this.begin=()=>{};this.line=()=>{};this.effect=()=>{};
      this.beginPlinko=(token,options)=>this.beginTargetDrop(token,options);
      this.plinkoDrop=(token,ball)=>this.targetDrop(token,ball);
      this.plinkoPin=(token,ball,row,direction)=>this.targetPin(token,ball,row,direction);
      this.plinkoLanding=(token,ball,bucket)=>this.targetLanding(token,ball,bucket);
      this.outcome=(token,kind)=>this.targetOutcome(token,kind);
    }
    if(this.isStandaloneWheel()){
      this.begin=()=>{};this.line=()=>{};this.effect=()=>{};
      this.outcome=(token,kind)=>this.standaloneWheelOutcome(token,kind);
    }
    if(this.isLimboGame()){
      this.begin=()=>{};this.line=()=>{};this.effect=()=>{};
      this.outcome=(token,kind)=>this.limboOutcome(token,kind);
    }
    if(this.isDiceGame()){
      this.begin=()=>{};this.line=()=>{};this.effect=()=>{};
      this.outcome=(token,kind)=>this.diceOutcome(token,kind);
    }
  }

  private isLimboGame(){return this.gameId==='royal-limbo'||this.gameId==='variant-limbo';}
  beginLimbo(token:string,options:{motion?:boolean;click?:boolean}={}){
    if(!this.isLimboGame()||!options||!this.open(token,options,'reels'))return;
    this.limbo={click:options.click!==false,hits:[],revealed:false,revealedAt:Infinity};
    // Pending play is silent. A controller must bind the actual current receipt before confirmation.
    void this.environment.unlock().catch(()=>{});
  }
  private currentLimbo(token:string){
    if(!this.isLimboGame()||!this.accepts(token)||this.finished)return;
    if(this.motion&&this.environment.reducedMotion()){this.cancel(token);return;}
    return this.limbo;
  }
  private limboFacts(value:unknown):ConfirmedLimboRoll|undefined{
    try{
      if(!value||typeof value!=='object'||Array.isArray(value))return;
      const prototype=Object.getPrototypeOf(value),descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
      if(prototype!==Object.prototype&&prototype!==null||keys.some(key=>typeof key!=='string')||keys.sort().join(',')!=='returnedUnits,rolledCents,stakeUnits,targetCents')return;
      if(keys.some(key=>!Object.hasOwn(descriptors[key as string],'value')))return;
      const rolledCents=descriptors.rolledCents.value,stakeUnits=descriptors.stakeUnits.value,returnedUnits=descriptors.returnedUnits.value,targets=descriptors.targetCents.value;
      if(!Number.isSafeInteger(rolledCents)||rolledCents<100||rolledCents>100000000||!['1000','5000','10000','50000'].includes(stakeUnits)||typeof returnedUnits!=='string'||!/^(0|[1-9][0-9]{0,14})$/.test(returnedUnits))return;
      const count=this.gameId==='royal-limbo'?1:2;
      if(!Array.isArray(targets)||Object.getPrototypeOf(targets)!==Array.prototype)return;
      const length=Object.getOwnPropertyDescriptor(targets,'length'),targetKeys=Reflect.ownKeys(targets);
      if(!length||!Object.hasOwn(length,'value')||length.value!==count||targetKeys.length!==count+1)return;
      const copied:number[]=[];
      for(let index=0;index<count;index++){
        const descriptor=Object.getOwnPropertyDescriptor(targets,String(index));
        if(!descriptor||!Object.hasOwn(descriptor,'value')||!Number.isSafeInteger(descriptor.value))return;
        copied.push(descriptor.value);
      }
      if(targetKeys.some(key=>key!=='length'&&(typeof key!=='string'||!copied.some((_target,index)=>key===String(index)))))return;
      if(count===1?(copied[0]<101||copied[0]>100000000):(copied[0]!==150||![300,500,1000].includes(copied[1])))return;
      const allocated=BigInt(stakeUnits)/BigInt(count);
      const total=copied.reduce((sum,target)=>sum+(rolledCents>=target?allocated*BigInt(target)/100n:0n),0n);
      if(returnedUnits!==total.toString())return;
      return Object.freeze({rolledCents,stakeUnits,returnedUnits,targetCents:Object.freeze(copied)});
    }catch{return;}
  }
  confirmLimbo(token:string,confirmation:ConfirmedLimboRoll){
    const state=this.currentLimbo(token);if(!state||state.confirmation)return;
    const facts=this.limboFacts(confirmation);if(!facts)return;state.confirmation=facts;
    if(!this.motion)return;
    void this.environment.unlock().then(()=>{
      if(this.currentLimbo(token)!==state||state.revealed||state.hits.length||!this.ready())return;
      const royal=this.gameId==='royal-limbo',root=royal?261.63:293.66,third=royal?329.63:369.99;
      this.environment.duck(true);
      if(state.click){this.tone(root/2,.065,.0035);this.environment.played('click');}
      this.music(root,.15,.008);this.music(third,.16,.005,.055);this.environment.played('limbo-start');
    }).catch(()=>{});
  }
  limboHit(token:string,ticketIndex:0|1){
    const state=this.currentLimbo(token),facts=state?.confirmation;
    if(!state||!facts||state.revealed||!this.motion||!Number.isInteger(ticketIndex))return;
    const winners=facts.targetCents.map((target,index)=>facts.rolledCents>=target?index:-1).filter(index=>index>=0);
    if(winners[state.hits.length]!==ticketIndex)return;
    state.hits.push(ticketIndex);if(!this.ready())return;
    const royal=this.gameId==='royal-limbo',root=royal?523.25:ticketIndex===0?587.33:739.99;
    this.music(root,.16,.009);this.music(root*1.5,.185,.004,.045);this.environment.played('limbo-hit');
  }
  limboReveal(token:string){
    const state=this.currentLimbo(token),facts=state?.confirmation;
    if(!state||!facts||state.revealed||!this.motion)return;
    const winners=facts.targetCents.filter(target=>facts.rolledCents>=target).length;
    if(state.hits.length!==winners)return;
    const context=this.environment.context();if(!context)return;
    state.revealed=true;state.revealedAt=context.currentTime;
    if(!this.ready())return;
    const root=this.gameId==='royal-limbo'?392:440;
    this.music(root,.22,.008);this.music(root*2,.24,.004,.06);this.environment.played('limbo-reveal');
  }
  private limboOutcome(token:string,kind:SlotOutcome){
    const state=this.currentLimbo(token),facts=state?.confirmation;
    if(!state||!facts||!['loss','return','win','bigwin'].includes(kind))return;
    const returned=BigInt(facts.returnedUnits),stake=BigInt(facts.stakeUnits);
    const expected=returned===0n?'loss':returned<=stake?'return':returned>=4n*stake?'bigwin':'win';
    if(kind!==expected)return;
    if(this.motion&&(!state.revealed||!this.environment.context()||this.environment.context()!.currentTime-state.revealedAt<.35))return;
    this.finished=true;
    if(this.ready()){this.environment.duck(true);this.playLimboOutcome(kind);this.environment.played(kind);}
    clearTimeout(this.release);const delay=!this.motion||kind==='loss'||kind==='return'?500:kind==='bigwin'?1950:1400;
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},delay);
  }
  private playLimboOutcome(kind:SlotOutcome){
    const royal=this.gameId==='royal-limbo',tonic=royal?261.63:293.66,third=royal?329.63:369.99,fifth=royal?392:440;
    if(!this.motion){
      if(kind==='loss'){this.tone(tonic/2,.15,.0045);return;}
      this.music(tonic,.22,.006);this.music(kind==='return'?third:fifth,.24,.004,.055);
      if(kind==='bigwin')this.music(tonic*2,.24,.0025,.055);
      return;
    }
    if(kind==='loss'){this.tone(tonic/2,.15,.0045);this.tone(tonic*.75,.17,.003,.05);return;}
    if(kind==='return'){this.music(tonic,.23,.006);this.music(third,.25,.004,.07);return;}
    const notes=kind==='bigwin'?(royal?[523.25,659.25,783.99,659.25,880,1046.5,783.99,987.77,1046.5]:[587.33,739.99,880,739.99,987.77,1174.66,880,1108.73,1174.66]):(royal?[392,523.25,659.25,587.33,783.99,659.25,523.25]:[440,587.33,739.99,659.25,880,739.99,587.33]);
    const rhythm=kind==='bigwin'?[0,.1,.21,.37,.53,.72,.92,1.11,1.3]:[0,.105,.22,.37,.51,.68,.83];
    notes.forEach((note,index)=>this.music(note,index===notes.length-1?(kind==='bigwin'?.48:.37):.24,kind==='bigwin'?.025:.021,rhythm[index]));
    [tonic/2,third,fifth].forEach((note,index)=>this.music(note,kind==='bigwin'?.5:.4,index===0?.005:.008,rhythm.at(-1)!));
  }

  private isDiceGame(){return this.gameId==='royal-dice'||this.gameId==='variant-dice'||this.gameId==='studio-signal-fox';}
  beginDice(token:string,options:{motion?:boolean;click?:boolean}={}){
    if(!this.isDiceGame()||!options||!this.open(token,options,'reels'))return;
    this.dice={click:options.click!==false,revealed:false};
    // Awaiting a current server receipt is silent, including after unlock.
    void this.environment.unlock().catch(()=>{});
  }
  private currentDice(token:string){
    if(!this.isDiceGame()||!this.accepts(token)||this.finished)return;
    if(this.motion&&this.environment.reducedMotion()){this.cancel(token);return;}
    return this.dice;
  }
  private diceFacts(value:unknown):ConfirmedDiceRoll|undefined{
    try{
      if(!value||typeof value!=='object'||Array.isArray(value))return;
      const object=value as Record<string,unknown>,prototype=Object.getPrototypeOf(object),keys=Reflect.ownKeys(object);
      if(prototype!==Object.prototype&&prototype!==null||keys.some(key=>typeof key!=='string')||keys.sort().join(',')!=='outcomeCount,rollMinor,winRange,won')return;
      if(keys.some(key=>!('value' in Object.getOwnPropertyDescriptor(object,key)!)))return;
      const range=object.winRange;if(!range||typeof range!=='object'||Array.isArray(range))return;
      const rangeObject=range as Record<string,unknown>,rangePrototype=Object.getPrototypeOf(rangeObject),rangeKeys=Reflect.ownKeys(rangeObject);
      if(rangePrototype!==Object.prototype&&rangePrototype!==null||rangeKeys.some(key=>typeof key!=='string')||rangeKeys.sort().join(',')!=='maxExclusive,minInclusive')return;
      if(rangeKeys.some(key=>!('value' in Object.getOwnPropertyDescriptor(rangeObject,key)!)))return;
      const {rollMinor,outcomeCount,won}=object,{minInclusive,maxExclusive}=rangeObject;
      if(!Number.isSafeInteger(rollMinor)||!Number.isSafeInteger(minInclusive)||!Number.isSafeInteger(maxExclusive)||typeof won!=='boolean')return;
      const roll=rollMinor as number,min=minInclusive as number,max=maxExclusive as number,count=this.gameId==='studio-signal-fox'?100:10000;
      if(outcomeCount!==count||roll<0||roll>=count||min<0||max>count||min>=max||won!==(roll>=min&&roll<max))return;
      const winners=max-min;
      if(this.gameId==='royal-dice'){
        if(winners<1||winners>9703||min!==0&&max!==10000)return;
      }else if(this.gameId==='variant-dice'){
        if(![[3500,6500],[2500,7500],[1500,8500]].some(([low,high])=>min===low&&max===high))return;
      }else if(![25,50,75].includes(winners)||min!==0&&max!==100)return;
      return Object.freeze({rollMinor:roll,outcomeCount:count,won,winRange:Object.freeze({minInclusive:min,maxExclusive:max})});
    }catch{return;}
  }
  confirmDice(token:string,confirmation:ConfirmedDiceRoll){
    const state=this.currentDice(token);if(!state||state.confirmation)return;
    const facts=this.diceFacts(confirmation);if(!facts)return;state.confirmation=facts;
    if(!this.motion)return;
    void this.environment.unlock().then(()=>{
      if(this.currentDice(token)!==state||state.revealed||!this.ready())return;
      const royal=this.gameId==='royal-dice',corridor=this.gameId==='variant-dice';
      const root=royal?261.63:corridor?293.66:440,third=royal?329.63:corridor?369.99:554.37;
      this.environment.duck(true);
      if(state.click){this.tone(root/2,.065,.004);this.environment.played('click');}
      this.music(root,.135,.009);this.music(third,.14,.006,.045);this.environment.played('dice-start');
    }).catch(()=>{});
  }
  diceReveal(token:string){
    const state=this.currentDice(token);if(!state||!state.confirmation||state.revealed)return;
    state.revealed=true;if(!this.motion||!this.ready())return;
    const royal=this.gameId==='royal-dice',corridor=this.gameId==='variant-dice';
    const root=royal?261.63:corridor?293.66:440,fifth=royal?392:corridor?440:659.25;
    this.music(root,.22,.011);this.music(fifth,.25,.007,.055);this.environment.played('dice-reveal');
  }
  private diceOutcome(token:string,kind:SlotOutcome){
    const state=this.currentDice(token),facts=state?.confirmation;
    if(!state||!facts||!['loss','win','bigwin'].includes(kind)||this.motion&&!state.revealed)return;
    if(!facts.won&&kind!=='loss'||facts.won&&kind==='loss')return;
    if(kind==='bigwin'&&(this.gameId!=='royal-dice'||facts.winRange.maxExclusive-facts.winRange.minInclusive>2450))return;
    this.finished=true;
    if(this.ready()){this.environment.duck(true);this.playDiceOutcome(kind);this.environment.played(kind);}
    clearTimeout(this.release);const delay=!this.motion||kind==='loss'?450:kind==='bigwin'?1900:1500;
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},delay);
  }
  private playDiceOutcome(kind:SlotOutcome){
    const royal=this.gameId==='royal-dice',corridor=this.gameId==='variant-dice';
    const root=royal?130.815:corridor?146.83:220,tonic=root*2,third=royal?329.63:corridor?369.99:554.37,fifth=royal?392:corridor?440:659.25;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.16,.006);return;}
      this.music(tonic,.23,.008);this.music(fifth,.26,.006,.065);
      if(kind==='bigwin')this.music(tonic*2,.25,.004,.065);
      return;
    }
    if(kind==='bigwin'){
      const notes=[261.63,329.63,392,523.25,440,392,659.25,587.33,523.25,783.99],rhythm=[0,.11,.22,.4,.51,.62,.82,.94,1.06,1.26];
      notes.forEach((note,index)=>this.music(note,index===9?.47:.28,index===9?.037:.029,rhythm[index]));
      [root,third,fifth].forEach((note,index)=>this.music(note,.49,index===0?.008:.013,1.26));
    }else if(kind==='win'){
      const notes=royal?[261.63,329.63,392,440,523.25,392,659.25]:corridor?[293.66,369.99,440,493.88,587.33,440,739.99]:[440,554.37,659.25,493.88,587.33,659.25,880];
      const rhythm=royal?[0,.11,.22,.38,.5,.64,.8]:corridor?[0,.1,.2,.36,.46,.61,.79]:[0,.115,.23,.385,.5,.645,.79];
      notes.forEach((note,index)=>this.music(note,index===6?.41:.25,.029,rhythm[index]));
      [root,third,fifth].forEach((note,index)=>this.music(note,.44,index===0?.007:.011,.66));
    }else{
      this.tone(root,.16,.006);this.tone(root*1.5,.18,.004,.055);
    }
  }


  private isStandaloneWheel(){return this.gameId==='studio-saffron-spin'||this.gameId==='studio-lucky-spotlight';}
  beginWheel(token:string,options:{sectors:12|16;motion?:boolean;click?:boolean}){
    if(!this.isStandaloneWheel()||!options||options.sectors!==(this.gameId==='studio-saffron-spin'?12:16)||!this.open(token,options,'reels'))return;
    this.standaloneWheel={sectors:options.sectors,click:options.click!==false,contacts:0,lastContactAt:-Infinity,landed:false};
    // Waiting is silent. Only a confirmed current receipt may start the wheel sound.
    void this.environment.unlock().then(()=>{}).catch(()=>{});
  }
  private currentWheel(token:string){
    if(!this.isStandaloneWheel()||!this.accepts(token)||this.finished)return;
    if(this.motion&&this.environment.reducedMotion()){this.cancel(token);return;}
    return this.standaloneWheel;
  }
  confirmWheel(token:string,confirmation:ConfirmedWheelSector){
    const state=this.currentWheel(token);if(!state||state.confirmation||!confirmation||typeof confirmation!=='object')return;
    const keys=Object.keys(confirmation);if(keys.length!==3||keys.some(key=>!['sector','target','segments'].includes(key)))return;
    const descriptors=Object.getOwnPropertyDescriptors(confirmation);if(keys.some(key=>!('value' in descriptors[key])))return;
    const {sector,target,segments}=confirmation;
    const expected=[0,1,0,2,0,1,0,3,0,1,0,2,...(state.sectors===16?[0,1,0,3]:[])];
    if(!Number.isInteger(sector)||sector<0||sector>=state.sectors||!Number.isInteger(target)||target<0||target>3||!Array.isArray(segments)||segments.length!==state.sectors)return;
    for(let index=0;index<state.sectors;index++){const cell=Object.getOwnPropertyDescriptor(segments,String(index));if(!cell||!('value' in cell)||cell.value!==expected[index])return;}
    if(Object.keys(segments).length!==state.sectors)return;
    state.confirmation=Object.freeze({sector,target,segments:Object.freeze([...expected]) as readonly (0|1|2|3)[]});
    if(!this.motion)return;
    void this.environment.unlock().then(()=>{
      if(this.currentWheel(token)!==state||state.landed||!this.ready())return;
      this.environment.duck(true);const golden=this.gameId==='studio-saffron-spin';
      if(state.click){this.tone(golden?261.63:293.66,.065,.004);this.environment.played('click');}
      this.music(golden?329.63:369.99,.15,.007);this.music(golden?392:440,.13,.004,.045);
      this.startStandaloneWheelLoop();this.environment.played('wheel-start');
    }).catch(()=>{});
  }
  wheelContact(token:string,eventIndex:number){
    const state=this.currentWheel(token);if(!state||!state.confirmation||state.landed||!Number.isInteger(eventIndex)||eventIndex!==state.contacts||eventIndex>=24)return;
    state.contacts++;if(!this.motion||!this.ready())return;
    const now=this.environment.context()!.currentTime;if(now-state.lastContactAt<.075)return;state.lastContactAt=now;
    const golden=this.gameId==='studio-saffron-spin',notes=golden?[329.63,392,440,392]:[369.99,440,493.88,440];
    this.music(notes[eventIndex%notes.length],.075,.0028);this.tone(golden?130.815:146.83,.045,.0014);
    this.environment.played('wheel-contact');
  }
  wheelLanding(token:string,sector:number){
    const state=this.currentWheel(token);if(!state||!state.confirmation||state.landed||!Number.isInteger(sector)||sector!==state.confirmation.sector)return;
    state.landed=true;this.stopLoop();if(!this.motion||!this.ready())return;
    const golden=this.gameId==='studio-saffron-spin',notes=golden?[261.63,329.63,392]:[293.66,369.99,440];
    notes.forEach((note,index)=>this.music(note,.225,index===0?.008:.005,index*.04));
    this.environment.played('wheel-landing');
  }
  private standaloneWheelOutcome(token:string,kind:SlotOutcome){
    const state=this.currentWheel(token);if(!state||!state.confirmation||!['loss','win','bigwin'].includes(kind)||this.motion&&!state.landed)return;
    this.finished=true;this.stopLoop();if(this.ready()){this.environment.duck(true);this.playStandaloneWheelOutcome(kind);this.environment.played(kind);}
    clearTimeout(this.release);const release=!this.motion||kind==='loss'?500:kind==='bigwin'?2000:1500;
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},release);
  }
  private startStandaloneWheelLoop(){
    const c=this.environment.context()!,golden=this.gameId==='studio-saffron-spin',voices:Voice[]=[];
    for(const [frequency,level] of [[golden?130.815:146.83,.0018],[golden?196:220,.001]]){
      const source=c.createOscillator(),gain=c.createGain();source.setPeriodicWave(this.timbre(c));source.frequency.setValueAtTime(frequency,c.currentTime);
      gain.gain.setValueAtTime(0,c.currentTime);gain.gain.linearRampToValueAtTime(level,c.currentTime+.16);source.connect(gain);
      voices.push(this.connect(source,gain));source.start();
    }
    this.loop=voices;
  }
  private playStandaloneWheelOutcome(kind:SlotOutcome){
    const golden=this.gameId==='studio-saffron-spin',root=golden?261.63:293.66,third=golden?329.63:369.99,fifth=golden?392:440;
    if(!this.motion){if(kind==='loss'){this.tone(root/2,.17,.0035);return;}this.music(root,.22,.006);this.music(fifth,.245,.004,.055);return;}
    if(kind==='loss'){this.tone(root/2,.16,.0035);this.tone(golden?196:220,.19,.0025,.05);return;}
    const big=kind==='bigwin',notes=golden?(big?[261.63,329.63,392,523.25,587.33,659.25,587.33,523.25,440,523.25]:[261.63,329.63,392,440,523.25,440,392,523.25]):
      (big?[293.66,369.99,440,587.33,659.25,739.99,659.25,587.33,493.88,587.33]:[293.66,369.99,440,493.88,587.33,493.88,440,587.33]);
    const rhythm=big?[0,.095,.19,.31,.45,.6,.76,.9,1.04,1.2]:[0,.105,.21,.34,.48,.61,.76,.9];
    notes.forEach((note,index)=>this.music(note,index===notes.length-1?(big?.44:.32):.21,big?.019:.014,rhythm[index]));
    [root/2,third,fifth].forEach((note,index)=>this.music(note,big?.46:.34,index===0?.003:.005,rhythm.at(-1)!));
  }

  private isTargetDropGame(){return this.gameId==='variant-target-plinko'||this.gameId==='studio-obsidian-drop';}
  private beginTargetDrop(token:string,options:{rows:number;balls:number;motion?:boolean;click?:boolean}){
    if(!this.isTargetDropGame()||!options||options.rows!==12||options.balls!==1||!this.open(token,options,'reels'))return;
    this.plinko={rows:12,balls:1,click:options.click!==false,dropped:new Set(),paths:[[]],landed:new Set()};
    // The caller confirms the saved path before drop; waiting and late unlock are silent.
    void this.environment.unlock().then(()=>{}).catch(()=>{});
  }
  private targetDrop(token:string,ball:number){
    const state=this.plinko;if(!state||!this.accepts(token)||this.finished||ball!==0||state.dropped.has(0))return;
    state.dropped.add(0);if(!this.motion||!this.ready())return;
    this.environment.duck(true);const target=this.gameId==='variant-target-plinko',root=target?220:164.81;
    if(state.click){this.tone(root,.065,.0042);this.tap(target?330:270,.04,.0025);this.environment.played('click');}
    this.music(root,.15,.009);this.music(target?329.63:246.94,.13,.004,.035);this.environment.played('plinko-drop');
  }
  private targetPin(token:string,ball:number,row:number,direction:0|1){
    const state=this.plinko;if(!state||!this.accepts(token)||this.finished||ball!==0||!state.dropped.has(0)||state.landed.has(0)
      ||!Number.isInteger(row)||row!==state.paths[0].length||row>=12||(direction!==0&&direction!==1))return;
    state.paths[0].push(direction);if(!this.motion||!this.ready())return;
    const target=this.gameId==='variant-target-plinko',notes=target?[220,277.18,329.63,369.99,440]:[164.81,196,246.94,293.66,329.63];
    this.music(notes[(row+direction*2)%notes.length],target?.105:.12,target?.0057:.0052);
    this.tap(target?330:260,.028,.0016);this.environment.played('plinko-pin');
  }
  private targetLanding(token:string,ball:number,bucket:number){
    const state=this.plinko;if(!state||!this.accepts(token)||this.finished||ball!==0||!state.dropped.has(0)||state.landed.has(0)
      ||state.paths[0].length!==12||!Number.isInteger(bucket)||bucket!==state.paths[0].reduce((sum,bit)=>sum+bit,0))return;
    state.landed.add(0);if(!this.motion||!this.ready())return;
    const target=this.gameId==='variant-target-plinko',notes=target?[220,277.18,329.63]:[164.81,196,246.94];
    notes.forEach((note,index)=>this.music(note,index===2?(target?.23:.245):.22,index===0?.008:index===1?.0055:.0045,index===0?0:index===1?.045:.09));
    this.environment.played('plinko-landing');
  }
  private targetOutcome(token:string,kind:SlotOutcome){
    const state=this.plinko;if(!state||!this.accepts(token)||this.finished||!['loss','return','win','bigwin'].includes(kind)
      ||this.motion&&state.landed.size!==1)return;
    this.finished=true;if(this.ready()){this.environment.duck(true);this.playTargetOutcome(kind);this.environment.played(kind);}
    clearTimeout(this.release);const release=!this.motion?500:kind==='bigwin'?1900:kind==='win'?1400:500;
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},release);
  }
  private playTargetOutcome(kind:SlotOutcome){
    const target=this.gameId==='variant-target-plinko',root=target?220:164.81,third=target?277.18:196,fifth=target?329.63:246.94;
    if(!this.motion){if(kind==='loss'){this.tone(root/2,.17,.004);return;}this.music(root,.23,.0065);this.music(kind==='return'?third:fifth,.25,.0045,.055);return;}
    if(kind==='loss'){this.tone(root/2,.16,.004);this.tone(target?164.81:123.47,.18,.0025,.055);return;}
    if(kind==='return'){this.music(root,.24,.0055);this.music(third,.255,.0035,.075);return;}
    const big=kind==='bigwin';
    const notes=target?(big?[220,277.18,329.63,440,554.37,493.88,440,369.99,329.63,440]:[220,277.18,329.63,440,369.99,329.63,440]):
      (big?[164.81,196,246.94,329.63,392,369.99,329.63,293.66,246.94,329.63]:[164.81,196,246.94,293.66,329.63,293.66,246.94,329.63]);
    const rhythm=big?[0,.095,.19,.32,.47,.6,.75,.9,1.05,1.2]:target?[0,.105,.21,.34,.48,.61,.78]:[0,.13,.26,.39,.53,.65,.78,.93];
    notes.forEach((note,index)=>this.music(note,index===notes.length-1?(big?.42:.31):.22,big?.02:.0155,rhythm[index]));
    [root/2,third,fifth].forEach((note,index)=>this.music(note,big?.44:.32,index===0?.0035:.0055,rhythm.at(-1)!));
  }
  beginPlinko(token:string,options:{rows:number;balls:number;motion?:boolean;click?:boolean}){
    if(!this.isPlinkoGame()||!options||!Number.isInteger(options.rows)||!Number.isInteger(options.balls)
      ||(this.gameId==='royal-plinko'?(options.rows<8||options.rows>16||options.balls!==1):(options.rows!==12||options.balls!==2)))return;
    if(!this.open(token,options,'reels'))return;
    this.plinko={rows:options.rows,balls:options.balls,click:options.click!==false,dropped:new Set(),paths:Array.from({length:options.balls},()=>[]),landed:new Set()};
    // Pending confirmation is silent. Unlock never starts a delayed sound.
    void this.environment.unlock().then(()=>{}).catch(()=>{});
  }
  plinkoDrop(token:string,ball:number){
    const state=this.plinko;if(!state||!this.isPlinkoGame()||!this.accepts(token)||this.finished||!Number.isInteger(ball)||ball<0||ball>=state.balls||state.dropped.has(ball))return;
    const first=state.dropped.size===0;state.dropped.add(ball);if(!this.motion||!this.ready())return;
    this.environment.duck(true);const royal=this.gameId==='royal-plinko',root=royal?196:174.61;
    if(first&&state.click){this.tone(root,.055,.004);this.tap(royal?290:340,.04,.003);this.environment.played('click');}
    this.music(root,.14,.009);this.music(root*1.5,.12,.0035,.03);this.environment.played('plinko-drop');
  }
  plinkoPin(token:string,ball:number,row:number,direction:0|1){
    const state=this.plinko;if(!state||!this.isPlinkoGame()||!this.accepts(token)||this.finished||!Number.isInteger(ball)||ball<0||ball>=state.balls
      ||!state.dropped.has(ball)||state.landed.has(ball)||!Number.isInteger(row)||row!==state.paths[ball].length||row>=state.rows||(direction!==0&&direction!==1))return;
    state.paths[ball].push(direction);if(!this.motion||!this.ready())return;
    const royal=this.gameId==='royal-plinko',notes=royal?[196,246.94,293.66,329.63,392]:[174.61,220,261.63,293.66,349.23];
    this.music(notes[(row+direction+ball*2)%notes.length],.095,.0052);this.tap(royal?280:340,.027,.0018);this.environment.played('plinko-pin');
  }
  plinkoLanding(token:string,ball:number,bucket:number){
    const state=this.plinko;if(!state||!this.isPlinkoGame()||!this.accepts(token)||this.finished||!Number.isInteger(ball)||ball<0||ball>=state.balls
      ||!state.dropped.has(ball)||state.landed.has(ball)||state.paths[ball].length!==state.rows||!Number.isInteger(bucket)||bucket!==state.paths[ball].reduce((sum,direction)=>sum+direction,0))return;
    state.landed.add(ball);if(!this.motion||!this.ready())return;
    const royal=this.gameId==='royal-plinko',tonic=royal?196:174.61,third=royal?246.94:220,fifth=royal?293.66:261.63;
    this.music(tonic,.25,.009);this.music(third,.23,.006,.05);this.music(fifth,.25,.005,.075);this.environment.played('plinko-landing');
  }
  private isPlinkoGame(){return this.gameId==='royal-plinko'||this.gameId==='variant-plinko';}
  private plinkoOutcome(token:string,kind:SlotOutcome){
    const state=this.plinko;if(!state||!this.accepts(token)||this.finished||!['loss','return','win','bigwin'].includes(kind)||(this.motion&&state.landed.size!==state.balls))return;
    this.finished=true;if(this.ready()){this.environment.duck(true);this.playPlinkoOutcome(kind);this.environment.played(kind);}
    clearTimeout(this.release);const release=!this.motion?500:kind==='bigwin'?1800:kind==='win'?1100:500;
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},release);
  }
  private playPlinkoOutcome(kind:SlotOutcome){
    const royal=this.gameId==='royal-plinko',tonic=royal?196:174.61,third=royal?246.94:220,fifth=royal?293.66:261.63;
    if(!this.motion){if(kind==='loss'){this.tone(tonic/2,.15,.0045);return;}this.music(tonic,.22,.007);this.music(kind==='return'?third:fifth,.24,.0045,.055);if(kind==='bigwin')this.music(tonic*2,.245,.003,.055);return;}
    if(kind==='return'){this.music(tonic,.23,.006);this.music(third,.25,.004,.07);return;}
    if(kind==='loss'){this.tone(tonic/2,.15,.0045);this.tone(tonic*.75,.17,.003,.05);return;}
    const notes=kind==='bigwin'?(royal?[196,246.94,293.66,392,329.63,440,392,493.88,392]:[174.61,220,261.63,349.23,293.66,392,349.23,440,349.23]):(royal?[196,246.94,293.66,329.63,392,440]:[174.61,220,261.63,293.66,349.23,392]);
    const rhythm=kind==='bigwin'?[0,.105,.21,.36,.5,.7,.85,1.04,1.22]:[0,.11,.22,.37,.52,.69];
    notes.forEach((note,i)=>this.music(note,i===notes.length-1?(kind==='bigwin'?.42:.33):.23,kind==='bigwin'?.021:.017,rhythm[i]));
    [tonic/2,third,fifth].forEach((note,i)=>this.music(note,kind==='bigwin'?.44:.34,i===0?.004:.007,rhythm.at(-1)!));
  }
  begin(token:string,options:{motion?:boolean;click?:boolean;stage?:'base'|'hold';bonusStep?:1|2}={}) {
    if(this.isHoldGame()&&options.stage!==undefined&&!['base','hold'].includes(options.stage))return;
    if(this.isWheelTrailGame()&&(options.stage==='hold'||options.bonusStep!==undefined&&![1,2].includes(options.bonusStep)))return;
    if(this.isFruitsGame()&&(options.stage==='hold'||options.bonusStep!==undefined))return;
    if(!this.open(token,options,'reels'))return;
    if(this.isHoldGame()){this.holdStage=options.stage??'base';this.coins.clear();}
    if(this.isWheelTrailGame()){this.bonusStep=options.bonusStep??0;this.wheelPlayed=false;this.trailPlayed=false;}
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
      }else if(this.isFruitsGame()){
        const royal=this.gameId==='royal-fruits',note=(royal?[261.63,329.63,392]:[293.66,369.99,440])[index];
        this.tone(royal?130.815:146.83,.065,.0035);this.music(note,.25,.021,.01);this.tap(royal?310:370,.045,.004);
      }else if(this.isWheelTrailGame()){
        const petal=this.gameId==='studio-petal-parlor',note=(petal?[440,493.88,554.37,659.25,739.99]:[329.63,369.99,415.3,493.88,554.37])[index];
        this.tone(petal?110:82.405,.065,.0035);this.music(note,.25,.021,.01);this.tap(petal?370:310,.045,.004);
      }else if(this.isHoldGame()){
        const ember=this.gameId==='studio-ember-vault',market=this.gameId==='studio-midnight-market';
        const note=(ember?[311.13,392,466.16,523.25,622.25]:market?[261.63,311.13,392,466.16,523.25]:[293.66,369.99,440])[index];
        this.tone(ember?77.78:market?130.815:146.83,.065,.0035);this.music(note,.25,.023,.01);this.tap(ember?440:market?310:260,.045,.0045);
      }else if(this.isCollectGame()){
        const deep=this.gameId==='studio-deep-current',note=(deep?[220,277.18,329.63,369.99,440]:[233.08,293.66,349.23,392,466.16])[index];
        this.tone(deep?110:116.54,.07,.004);this.music(note,.25,.025,.01);this.tap(deep?270:360,.05,.005);
      }else if(this.isWaysGame()){
        const sky=this.gameId==='studio-sky-lanterns',rivet=this.gameId==='studio-rivet-rally';
        const note=(sky?[293.66,369.99,440,493.88,587.33,659.25]:rivet?[349.23,440,523.25,587.33,698.46]:[392,493.88,587.33,739.99,880])[index];
        this.tone(sky?146.83:rivet?174.61:196,.075,.0045);this.music(note,.24,.026,.01);this.tap(sky?290:rivet?410:270,.05,.0055);
      }else if(this.isJourneyGame()){
        const copper=this.gameId==='studio-copperline-express',pulse=this.gameId==='studio-pulse-district';
        const note=(copper?[293.66,349.23,440,523.25,587.33]:pulse?[329.63,392,493.88,587.33,659.25]:[392,493.88,587.33])[index];
        this.tone(copper?146.83:pulse?164.81:196,.075,.005);this.music(note,.26,.027,.01);this.tap(copper?380:pulse?420:300,.052,.006);
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
      else if(this.isJourneyGame()){
        const notes=this.gameId==='studio-copperline-express'?[349.23,440,523.25,587.33,698.46]:this.gameId==='studio-pulse-district'?[392,493.88,587.33,659.25,783.99]:[392,440,493.88,587.33,659.25];
        this.music(notes[index%5],.24,.019);
      }
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
  ways(token:string,index:number){
    if(!this.isWaysGame()||!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>3||this.groups.has(index))return;
    this.groups.add(index);if(!this.ready())return;
    const note=(this.gameId==='studio-sky-lanterns'?[369.99,440,493.88,587.33]:this.gameId==='studio-rivet-rally'?[349.23,440,523.25,698.46]:[493.88,587.33,739.99,783.99])[index];
    this.music(note,.235,.019);this.music(note*.5,.19,.0045,.025);
    this.environment.played('ways');
  }
  private collectLine(token:string,index:number){
    if(!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>=PROFILES[this.gameId].lines||this.lines.has(index)||this.lines.size>=3)return;
    this.lines.add(index);if(!this.ready())return;
    const notes=this.gameId==='studio-deep-current'?[277.18,329.63,369.99,440,554.37]:[293.66,349.23,392,466.16,587.33];
    this.music(notes[index%5],.24,.016);this.music(notes[index%5]*.5,.19,.003,.035);
    this.environment.played('line');
  }
  collect(token:string,index:number,eventId:string){
    const holdMarket=this.gameId==='studio-midnight-market'&&this.holdStage==='base';
    if((!this.isCollectGame()&&!holdMarket)||!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>(holdMarket?26:41)
      ||typeof eventId!=='string'||!eventId||eventId.length>192||this.groups.has(index)||this.effects.has('collect:'+eventId)||this.collections>=2)return;
    this.groups.add(index);this.effects.add('collect:'+eventId);const order=this.collections++;
    if(!this.ready())return;
    if(holdMarket){
      (order?[311.13,466.16,622.25]:[261.63,392,523.25]).forEach((note,i)=>this.music(note,.28,.018,i*.075));this.tone(130.815,.22,.0035);this.environment.played('collect');return;
    }
    const deep=this.gameId==='studio-deep-current',notes=deep?(order?[277.18,369.99,554.37]:[220,329.63,440]):(order?[293.66,392,587.33]:[233.08,349.23,466.16]);
    notes.forEach((note,i)=>this.music(note,.29,.019,i*.075));this.tone(deep?110:116.54,.23,.004);
    this.environment.played('collect');
  }
  private holdLine(token:string,index:number){
    if(this.holdStage!=='base'||!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>=PROFILES[this.gameId].lines||this.lines.has(index)||this.lines.size>=3)return;
    this.lines.add(index);if(!this.ready())return;
    const note=(this.gameId==='studio-ember-vault'?[392,466.16,523.25,622.25,783.99]:this.gameId==='studio-midnight-market'?[311.13,392,466.16,523.25,622.25]:[369.99,440,493.88,587.33,739.99])[index%5];
    this.music(note,.235,.016);this.music(note*.5,.18,.003,.04);this.environment.played('line');
  }
  private fruitsLine(token:string,index:number){
    if(!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>=PROFILES[this.gameId].lines||this.lines.has(index)||this.lines.size>=3)return;
    this.lines.add(index);if(!this.ready())return;
    const royal=this.gameId==='royal-fruits';this.music(royal?329.63:[369.99,440,587.33][index],.235,.016);
    this.music(royal?261.63:[293.66,369.99,440][index],.21,.004,.035);this.environment.played('line');
  }
  private wheelTrailLine(token:string,index:number){
    if(!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>=10||this.lines.has(index)||this.lines.size>=3)return;
    this.lines.add(index);if(!this.ready())return;
    const note=(this.gameId==='studio-petal-parlor'?[493.88,554.37,659.25,739.99,880]:[369.99,415.3,493.88,554.37,659.25])[index%5];
    this.music(note,.235,.015);this.music(note*.5,.18,.003,.035);this.environment.played('line');
  }
  wheel(token:string,index:number,eventId:string,count:number){
    if(this.gameId!=='studio-petal-parlor'||!this.bonusStep||this.wheelPlayed||!this.accepts(token)||this.finished||!this.motion||!this.stageReady()
      ||!Number.isInteger(index)||index<0||index>10||!Number.isInteger(count)||count<1||count>6||typeof eventId!=='string'||!eventId||eventId.length>192||this.effects.has('wheel:'+eventId))return;
    this.wheelPlayed=true;this.effects.add('wheel:'+eventId);if(!this.ready())return;
    const note=[440,493.88,554.37,659.25,739.99,880][count-1];
    this.music(440,.25,.014);this.music(554.37,.26,.011,.075);this.music(note,.28,.016,.15);this.environment.played('wheel');
  }
  trail(token:string,index:number,eventId:string,factor:number){
    if(this.gameId!=='studio-sunbird-trails'||this.trailPlayed||!this.accepts(token)||this.finished||!this.motion||!this.stageReady()
      ||!Number.isInteger(index)||index<0||index>=10||!Number.isInteger(factor)||factor<1||factor>7||typeof eventId!=='string'||!eventId||eventId.length>192||this.effects.has('trail:'+eventId))return;
    this.trailPlayed=true;this.effects.add('trail:'+eventId);if(!this.ready())return;
    this.music(329.63,.23,.009);this.music([329.63,369.99,415.3,493.88,554.37,659.25,739.99][factor-1],.24,.007,.075);this.environment.played('trail');
  }
  coin(token:string,index:number,eventId:string){
    const limit=this.gameId==='studio-ember-vault'?40:this.gameId==='studio-midnight-market'?27:14;
    if(!this.isHoldGame()||!this.accepts(token)||this.finished||!this.motion||!this.stageReady()||!Number.isInteger(index)||index<0||index>=limit||this.coins.has(index)||this.coins.size>=3
      ||typeof eventId!=='string'||!eventId||eventId.length>192||this.effects.has('coin:'+eventId))return;
    const order=this.coins.size;this.coins.add(index);this.effects.add('coin:'+eventId);if(!this.ready())return;
    const ember=this.gameId==='studio-ember-vault',market=this.gameId==='studio-midnight-market',note=(ember?[311.13,392,466.16]:market?[261.63,311.13,392]:[293.66,369.99,440])[order];
    this.music(note,.23,.016);this.music(note*1.5,.19,.0045,.055);this.tap(ember?440:market?310:260,.045,.0035);this.environment.played('coin');
  }
  effect(token:string,kind:SlotEffect,eventId:string,column?:number){
    if(this.isFruitsGame())return;
    if(!this.accepts(token)||this.finished||!this.motion||this.gameId==='studio-neon-crown'||typeof eventId!=='string'||!eventId||eventId.length>192)return;
    if(this.isCascadeGame()){
      if(!['collapse','drop','refill','orb'].includes(kind)||kind==='orb'&&(this.gameId!=='studio-starfall-oracle'||!this.stageReady())
        ||kind!=='orb'&&(this.mode!=='cascade'||!this.cascadeConfirmed||this.cascadeSettled))return;
    }else if(this.isWheelTrailGame()){
      if(!this.stageReady()||!this.bonusStep||kind!=='free-stage')return;
    }else if(this.isHoldGame()){
      if(!this.stageReady()||this.holdStage!=='hold'||kind!=='free-stage')return;
    }else if(this.isCollectGame()){
      if(!this.stageReady()||!(this.gameId==='studio-deep-current'?kind==='free-stage':kind==='expand')
        ||kind==='expand'&&(!Number.isInteger(column)||column!<1||column!>3||this.collections>0||this.effects.has('expand-column:'+column)))return;
    }else if(this.isClusterGame()){
      if(!this.stageReady()||!['collect','cell-values','free-stage'].includes(kind)
        ||kind==='collect'&&(this.gameId!=='studio-lumen-grove'||this.collections>=2)
        ||kind==='cell-values'&&this.gameId!=='studio-prism-atelier')return;
    }else if(this.isWaysGame()){
      const allowed=this.gameId==='studio-sky-lanterns'?['free-stage']:this.gameId==='studio-rivet-rally'?['synced']:['mystery','free-stage'];
      if(!this.stageReady()||!allowed.includes(kind))return;
    }else if(this.isJourneyGame()){
      const allowed=this.gameId==='studio-copperline-express'?['sticky','multiplier','free-stage']:this.gameId==='studio-pulse-district'?['walking','free-stage']:['wish-pin','free-stage'];
      if(!this.stageReady()||!allowed.includes(kind))return;
    }else if(this.isElementGame()){
      const allowed=this.gameId==='studio-stormforge-duel'?['expand','multiplier','free-stage']:this.gameId==='studio-saffron-cipher'?['chosen','free-stage']:['beam','free-stage'];
      if(!this.stageReady()||!allowed.includes(kind))return;
    }else if(this.stopped.size!==PROFILES[this.gameId].reels||!['expand','sticky','multiplier','free-stage'].includes(kind))return;
    const key=kind+':'+eventId;if(this.effects.has(key))return;this.effects.add(key);
    if(this.isCollectGame()&&kind==='expand')this.effects.add('expand-column:'+column);
    if(!this.ready())return;
    if(this.isWheelTrailGame()){
      const petal=this.gameId==='studio-petal-parlor';this.music(petal?440:329.63,.24,.01);this.music(petal?659.25:493.88,.25,.007,.075);this.environment.played(kind);return;
    }
    if(this.isHoldGame()){
      (this.gameId==='studio-ember-vault'?[311.13,466.16,622.25]:this.gameId==='studio-midnight-market'?[261.63,392,523.25]:[293.66,440,587.33]).forEach((note,i)=>this.music(note,.27,.016,i*.075));this.environment.played(kind);return;
    }
    if(this.isCollectGame()){this.collectEffect(kind,column);this.environment.played(kind);return;}
    if(this.isClusterGame()){this.clusterEffect(kind);this.environment.played(kind);return;}
    if(this.isCascadeGame()){this.cascadeEffect(kind);this.environment.played(kind);return;}
    if(this.isWaysGame()){this.waysEffect(kind);this.environment.played(kind);return;}
    if(this.isJourneyGame()){this.journeyEffect(kind);this.environment.played(kind);return;}
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
  private waysEffect(kind:SlotEffect){
    if(kind==='synced'){
      [349.23,440,523.25].forEach((note,i)=>this.music(note,.26,.02,i*.085));this.tone(174.61,.23,.005);
    }else if(kind==='mystery'){
      [392,493.88,587.33].forEach((note,i)=>this.music(note,.27,.019,i*.08));
    }else{
      const sky=this.gameId==='studio-sky-lanterns',notes=sky?[329.63,369.99,493.88,587.33]:[392,587.33,493.88,659.25];
      notes.forEach((note,i)=>this.music(note,.25,.02,[0,.065,.13,.2][i]));
    }
  }
  private collectEffect(kind:SlotEffect,column?:number){
    if(kind==='expand'){
      const notes=[233.08,293.66,349.23];
      this.music(notes[column!-1],.28,.018);this.music(notes[column!-1]*1.5,.24,.005,.08);this.tap(350,.055,.0045);
    }else{
      [277.18,329.63,440,554.37].forEach((note,i)=>this.music(note,.25,.018,[0,.065,.13,.2][i]));
    }
  }
  private journeyEffect(kind:SlotEffect){
    const copper=this.gameId==='studio-copperline-express',pulse=this.gameId==='studio-pulse-district';
    if(kind==='sticky'){
      [293.66,440,587.33].forEach((note,i)=>this.music(note,.29,.02,i*.07));this.tap(380,.07,.006);
    }else if(kind==='multiplier'){
      [440,523.25,698.46].forEach((note,i)=>this.music(note,.24,.019,i*.065));
    }else if(kind==='walking'){
      [329.63,493.88,659.25].forEach((note,i)=>this.music(note,.28,.02,i*.08));this.tone(164.81,.2,.006);
    }else if(kind==='wish-pin'){
      [392,493.88,659.25].forEach((note,i)=>this.music(note,.29,.018,i*.08));
    }else{
      (copper?[349.23,440,587.33]:pulse?[392,493.88,659.25]:[440,587.33,783.99]).forEach((note,i)=>this.music(note,.32,.021,i*.085));
    }
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
      if(this.isFruitsGame())this.playFruitsOutcome(kind);
      else if(this.isWheelTrailGame())this.playWheelTrailOutcome(kind);
      else if(this.isHoldGame())this.playHoldOutcome(kind);
      else if(this.isCollectGame())this.playCollectOutcome(kind);
      else if(this.isWaysGame())this.playWaysOutcome(kind);
      else if(this.isJourneyGame())this.playJourneyOutcome(kind);
      else if(this.isClusterGame())this.playClusterOutcome(kind);
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
    const release=(this.isClusterGame()||this.isElementGame()||this.isJourneyGame()||this.isWaysGame()||this.isCollectGame()||this.isHoldGame()||this.isWheelTrailGame()||this.isFruitsGame())&&!this.motion?500:this.gameId==='studio-neon-crown'?(kind==='bigwin'?1500:kind==='win'?900:400):(kind==='bigwin'?2000:kind==='win'?1250:500);
    this.release=setTimeout(()=>{this.release=undefined;if(this.token===token)this.environment.duck(false);},release);
  }
  private playFruitsOutcome(kind:SlotOutcome){
    const royal=this.gameId==='royal-fruits',root=royal?130.815:146.83,tonic=root*2,third=royal?329.63:369.99,fifth=royal?392:440;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.17,.0055);return;}
      this.music(tonic,.24,.009);this.music(kind==='return'?third:fifth,.27,.006,.075);
      if(kind==='bigwin')this.music(tonic*2,.29,.0045,.075);return;
    }
    if(kind==='bigwin'){
      const notes=royal?[261.63,329.63,392,523.25,440,392,659.25,587.33,523.25,659.25]:[293.66,369.99,440,587.33,493.88,659.25,587.33,440,739.99,587.33];
      const rhythm=royal?[0,.105,.21,.39,.5,.61,.82,.925,1.03,1.2]:[0,.1,.2,.4,.51,.62,.84,.94,1.04,1.22];
      notes.forEach((note,i)=>this.music(note,i===9?.53:.29,i===9?.032:.027,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.52,i===0?.007:.012,rhythm[9]));
    }else if(kind==='win'){
      const notes=royal?[261.63,329.63,392,523.25,440,659.25]:[293.66,369.99,440,587.33,493.88,659.25];
      const rhythm=royal?[0,.11,.22,.39,.51,.66]:[0,.1,.24,.35,.5,.65];
      notes.forEach((note,i)=>this.music(note,i===5?.4:.26,.023,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.42,i===0?.006:.009,.59));
    }else if(kind==='return'){
      this.music(tonic,.23,.0075);this.music(third,.26,.005,.08);
    }else{
      this.tone(root,.16,.006);this.tone(root*1.5,.19,.004,.055);
    }
  }
  private playWheelTrailOutcome(kind:SlotOutcome){
    const petal=this.gameId==='studio-petal-parlor',root=petal?220:164.815,tonic=root*2,third=petal?554.37:415.3,fifth=petal?659.25:493.88;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.16,.005);return;}
      this.music(tonic,.22,.0065);this.music(kind==='return'?third:fifth,.245,.0045,.075);
      if(kind==='bigwin')this.music(tonic*2,.26,.003,.075);return;
    }
    if(kind==='bigwin'){
      const notes=petal?[440,493.88,554.37,659.25,739.99,880,739.99,659.25,987.77,1108.73]:[329.63,369.99,415.3,493.88,554.37,659.25,554.37,493.88,739.99,830.61];
      const rhythm=petal?[0,.115,.23,.4,.515,.63,.83,.945,1.06,1.28]:[0,.105,.21,.405,.51,.615,.815,.92,1.025,1.3];
      notes.forEach((note,i)=>this.music(note,i===9?.55:.28,i===9?.03:.022,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.56,i===0?.0055:.009,rhythm[9]));
    }else if(kind==='win'){
      const notes=petal?[440,554.37,659.25,739.99,659.25,880,987.77]:[329.63,415.3,493.88,554.37,493.88,659.25,830.61];
      const rhythm=petal?[0,.115,.23,.39,.505,.65,.81]:[0,.105,.21,.375,.48,.63,.8];
      notes.forEach((note,i)=>this.music(note,i===6?.4:.255,.021,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.46,i===0?.0055:.008,.65));
    }else if(kind==='return'){
      this.music(tonic,.22,.0065);this.music(third,.24,.0045,.075);
    }else{
      this.tone(root,.155,.005);this.tone(root*1.5,.175,.003,.06);
    }
  }
  private playWaysOutcome(kind:SlotOutcome){
    const sky=this.gameId==='studio-sky-lanterns',rivet=this.gameId==='studio-rivet-rally';
    const root=sky?146.83:rivet?174.61:196,tonic=root*2,third=sky?369.99:rivet?440:493.88,fifth=sky?440:rivet?523.25:587.33;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.17,.0065);return;}
      this.music(tonic,.235,.008);this.music(kind==='return'?third:fifth,.26,.006,.075);
      if(kind==='bigwin')this.music(tonic*2,.28,.0045,.075);
      return;
    }
    if(kind==='bigwin'){
      const notes=sky?[293.66,329.63,369.99,440,493.88,587.33,493.88,440,739.99,880]:rivet?[349.23,440,523.25,698.46,587.33,523.25,440,783.99,698.46,1046.5]:[392,493.88,587.33,739.99,659.25,587.33,523.25,783.99,739.99,987.77];
      const rhythm=sky?[0,.12,.24,.43,.55,.67,.84,.96,1.08,1.27]:rivet?[0,.105,.245,.405,.54,.675,.835,.97,1.105,1.28]:[0,.115,.23,.425,.54,.655,.85,.965,1.08,1.28];
      notes.forEach((note,i)=>this.music(note,i===9?.54:.29,i===9?.036:.028,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.56,i===0?.008:.014,rhythm[9]));
    }else if(kind==='win'){
      const notes=sky?[293.66,369.99,440,493.88,440,587.33,739.99]:rivet?[349.23,440,523.25,587.33,523.25,440,698.46]:[392,493.88,587.33,659.25,523.25,493.88,783.99];
      const rhythm=sky?[0,.12,.24,.38,.5,.66,.8]:rivet?[0,.11,.25,.385,.52,.655,.8]:[0,.115,.23,.385,.5,.65,.79];
      notes.forEach((note,i)=>this.music(note,i===6?.41:.27,.026,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.49,i===0?.008:.011,.62));
    }else if(kind==='return'){
      this.music(tonic,.23,.008);this.music(third,.25,.006,.09);
    }else{
      this.tone(root,.16,.0065);this.tone(root*1.5,.18,.0045,.06);
    }
  }
  private playHoldOutcome(kind:SlotOutcome){
    const ember=this.gameId==='studio-ember-vault',market=this.gameId==='studio-midnight-market';
    const root=ember?155.565:market?130.815:146.83,tonic=root*2,third=ember?392:market?311.13:369.99,fifth=ember?466.16:market?392:440;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.16,.0055);return;}
      this.music(tonic,.22,.007);this.music(kind==='return'?third:fifth,.25,.005,.075);
      if(kind==='bigwin')this.music(tonic*2,.26,.0035,.075);
      return;
    }
    if(kind==='bigwin'){
      const notes=ember?[311.13,349.23,392,466.16,523.25,622.25,523.25,466.16,783.99,932.33]:market?[261.63,311.13,392,466.16,523.25,622.25,523.25,466.16,783.99,1046.5]:[293.66,329.63,369.99,440,493.88,587.33,493.88,440,739.99,880];
      const rhythm=ember?[0,.105,.23,.395,.515,.635,.81,.93,1.05,1.24]:market?[0,.12,.24,.435,.555,.675,.855,.975,1.095,1.315]:[0,.115,.23,.415,.53,.645,.845,.96,1.075,1.3];
      notes.forEach((note,i)=>this.music(note,i===9?.54:.28,i===9?.033:.025,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.56,i===0?.0065:.011,rhythm[9]));
    }else if(kind==='win'){
      const notes=ember?[311.13,392,466.16,523.25,466.16,622.25,783.99]:market?[261.63,311.13,392,466.16,392,523.25,622.25]:[293.66,369.99,440,493.88,440,587.33,739.99];
      const rhythm=ember?[0,.11,.22,.38,.49,.635,.8]:market?[0,.12,.24,.39,.51,.66,.8]:[0,.115,.23,.375,.49,.64,.79];
      notes.forEach((note,i)=>this.music(note,i===6?.4:.255,.023,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.46,i===0?.006:.009,.64));
    }else if(kind==='return'){
      this.music(tonic,.225,.007);this.music(third,.245,.005,.085);
    }else{
      this.tone(root,.155,.0055);this.tone(root*1.5,.175,.0035,.06);
    }
  }
  private playCollectOutcome(kind:SlotOutcome){
    const deep=this.gameId==='studio-deep-current',root=deep?110:116.54,tonic=root*2,third=deep?277.18:293.66,fifth=deep?329.63:349.23;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.16,.006);return;}
      this.music(tonic,.225,.0075);this.music(kind==='return'?third:fifth,.25,.0055,.07);
      if(kind==='bigwin')this.music(tonic*2,.265,.004,.07);
      return;
    }
    if(kind==='bigwin'){
      const notes=deep?[220,277.18,329.63,440,369.99,554.37,493.88,440,659.25,880]:[233.08,293.66,349.23,466.16,392,587.33,523.25,466.16,698.46,932.33];
      const rhythm=deep?[0,.115,.23,.415,.53,.645,.855,.97,1.085,1.285]:[0,.105,.21,.405,.51,.615,.825,.93,1.035,1.275];
      notes.forEach((note,i)=>this.music(note,i===9?.55:.28,i===9?.035:.026,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.56,i===0?.0075:.012,rhythm[9]));
    }else if(kind==='win'){
      const notes=deep?[220,277.18,329.63,369.99,440,329.63,554.37]:[233.08,293.66,349.23,392,466.16,349.23,587.33];
      const rhythm=deep?[0,.12,.24,.39,.51,.65,.8]:[0,.105,.21,.375,.48,.625,.79];
      notes.forEach((note,i)=>this.music(note,i===6?.4:.26,.024,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.47,i===0?.007:.01,.64));
    }else if(kind==='return'){
      this.music(tonic,.23,.0075);this.music(third,.25,.0055,.09);
    }else{
      this.tone(root,.16,.006);this.tone(root*1.5,.18,.004,.06);
    }
  }
  private playJourneyOutcome(kind:SlotOutcome){
    const copper=this.gameId==='studio-copperline-express',pulse=this.gameId==='studio-pulse-district';
    const root=copper?146.83:pulse?164.81:196,tonic=root*2,third=copper?349.23:pulse?392:493.88,fifth=copper?440:pulse?493.88:587.33;
    if(!this.motion){
      if(kind==='loss'){this.tone(root,.17,.007);return;}
      this.music(tonic,.24,.009);this.music(kind==='return'?third:fifth,.27,.007,.075);
      if(kind==='bigwin')this.music(tonic*2,.29,.005,.075);
      return;
    }
    if(kind==='bigwin'){
      const notes=copper?[293.66,349.23,440,587.33,523.25,440,698.46,587.33,523.25,880]:pulse?[329.63,392,493.88,659.25,587.33,783.99,659.25,493.88,783.99,987.77]:[392,440,493.88,587.33,659.25,783.99,659.25,587.33,880,987.77];
      const rhythm=copper?[0,.115,.23,.43,.545,.66,.86,.975,1.09,1.29]:pulse?[0,.105,.21,.42,.525,.63,.84,.945,1.05,1.29]:[0,.12,.24,.41,.53,.65,.82,.94,1.06,1.29];
      notes.forEach((note,i)=>this.music(note,i===9?.54:.31,i===9?.039:.031,rhythm[i]));
      [root,tonic,third,fifth].forEach((note,i)=>this.music(note,.56,i===0?.01:.016,rhythm[9]));
    }else if(kind==='win'){
      const notes=copper?[293.66,349.23,440,523.25,587.33,440,698.46]:pulse?[329.63,392,493.88,587.33,659.25,493.88,783.99]:[392,440,493.88,587.33,659.25,587.33,783.99];
      const rhythm=copper?[0,.12,.24,.38,.5,.63,.79]:pulse?[0,.105,.21,.36,.465,.615,.78]:[0,.115,.23,.385,.5,.645,.79];
      notes.forEach((note,i)=>this.music(note,i===6?.42:.28,.028,rhythm[i]));
      [root,third,fifth].forEach((note,i)=>this.music(note,.5,i===0?.009:.012,.62));
    }else if(kind==='return'){
      this.music(tonic,.23,.009);this.music(third,.26,.007,.09);
    }else{
      this.tone(root,.16,.007);this.tone(root*1.5,.19,.005,.06);
    }
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
  private isJourneyGame(){return this.gameId==='studio-copperline-express'||this.gameId==='studio-pulse-district'||this.gameId==='studio-jade-koi';}
  private isWaysGame(){return this.gameId==='studio-sky-lanterns'||this.gameId==='studio-rivet-rally'||this.gameId==='studio-frostline-courier';}
  private isCollectGame(){return this.gameId==='studio-deep-current'||this.gameId==='studio-blazing-orchard';}
  private isHoldGame(){return this.gameId==='studio-ember-vault'||this.gameId==='studio-midnight-market'||this.gameId==='studio-moonlit-mint';}
  private isWheelTrailGame(){return this.gameId==='studio-petal-parlor'||this.gameId==='studio-sunbird-trails';}
  private isFruitsGame(){return this.gameId==='royal-fruits'||this.gameId==='variant-fruits';}
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
    const partials=this.gameId==='royal-limbo'?[0,1,.032,.084,.009,.004]:this.gameId==='variant-limbo'?[0,1,.017,.06,.022,.003]:this.gameId==='royal-dice'?[0,1,.08,.025,.012,.003]:this.gameId==='variant-dice'?[0,1,.025,.07,.018,.004]:this.gameId==='studio-signal-fox'?[0,1,.06,.018,.035,.004]:this.gameId==='studio-saffron-spin'?[0,1,.055,.024,.01,.003]:this.gameId==='studio-lucky-spotlight'?[0,1,.028,.065,.015,.004]:this.gameId==='variant-target-plinko'?[0,1,.036,.018,.025,.003]:this.gameId==='studio-obsidian-drop'?[0,1,.018,.065,.007,.003]:this.gameId==='royal-plinko'?[0,1,.023,.037,.005,.002]:this.gameId==='variant-plinko'?[0,1,.048,.021,.028,.003]:this.gameId==='royal-fruits'?[0,1,.022,.045,.004,.003]:this.gameId==='variant-fruits'?[0,1,.06,.018,.02,.004]:this.gameId==='studio-petal-parlor'?[0,1,.045,.028,.012,.002]:this.gameId==='studio-sunbird-trails'?[0,1,.085,.016,.032,.004]:this.gameId==='studio-ember-vault'?[0,1,.11,.045,.016,.004]:this.gameId==='studio-midnight-market'?[0,1,.07,.018,.065,.005]:this.gameId==='studio-moonlit-mint'?[0,1,.025,.07,.018,.003]:this.gameId==='studio-deep-current'?[0,1,.028,.052,.009,.003]:this.gameId==='studio-blazing-orchard'?[0,1,.075,.035,.02,.004]:this.gameId==='studio-sky-lanterns'?[0,1,.035,.075,.008,.002]:this.gameId==='studio-rivet-rally'?[0,1,.095,.018,.045,.008]:this.gameId==='studio-frostline-courier'?[0,1,.025,.06,.024,.002]:this.gameId==='studio-copperline-express'?[0,1,.13,.04,.017,.005]:this.gameId==='studio-pulse-district'?[0,1,.06,.11,.019,.004]:this.gameId==='studio-jade-koi'?[0,1,.045,.026,.075,.003]:this.gameId==='studio-cosmic-escape'?[0,1,.1,.024,.008]:this.gameId==='studio-caramel-carnival'?[0,1,.12,.023,.008]:this.gameId==='studio-starfall-oracle'?[0,1,.04,.1,.015]:this.gameId==='studio-lumen-grove'?[0,1,.08,.034,.01,.004]:this.gameId==='studio-prism-atelier'?[0,1,.04,.07,.012,.005]:this.gameId==='studio-stormforge-duel'?[0,1,.14,.047,.009,.004]:this.gameId==='studio-saffron-cipher'?[0,1,.085,.024,.015,.006]:this.gameId==='studio-beacon-bay'?[0,1,.045,.095,.012,.002]:[0,1,.07,.085,.012];
    const wave=c.createPeriodicWave(new Float32Array(partials.length),new Float32Array(partials));this.color={context:c,wave};return wave;
  }
  private tone(frequency:number,duration:number,level:number,delay=0,musical=false):Voice {
    const c=this.environment.context()!,source=c.createOscillator(),gain=c.createGain(),at=c.currentTime+delay;
    source.type='sine';source.frequency.setValueAtTime(frequency,at);
    if(musical)source.setPeriodicWave(this.timbre(c));
    const attack=musical?(this.gameId==='royal-limbo'?.017:this.gameId==='variant-limbo'?.024:this.gameId==='royal-dice'?.023:this.gameId==='variant-dice'?.025:this.gameId==='studio-signal-fox'?.029:this.gameId==='studio-saffron-spin'?.024:this.gameId==='studio-lucky-spotlight'?.027:this.gameId==='variant-target-plinko'?.022:this.gameId==='studio-obsidian-drop'?.028:this.gameId==='royal-plinko'?.023:this.gameId==='variant-plinko'?.026:this.gameId==='royal-fruits'?.02:this.gameId==='variant-fruits'?.024:this.gameId==='studio-petal-parlor'?.027:this.gameId==='studio-sunbird-trails'?.024:this.gameId==='studio-ember-vault'?.025:this.gameId==='studio-midnight-market'?.024:this.gameId==='studio-moonlit-mint'?.034:this.gameId==='studio-deep-current'?.03:this.gameId==='studio-blazing-orchard'?.025:this.gameId==='studio-sky-lanterns'?.026:this.gameId==='studio-rivet-rally'?.023:this.gameId==='studio-frostline-courier'?.031:this.gameId==='studio-copperline-express'?.023:this.gameId==='studio-pulse-district'?.026:this.gameId==='studio-jade-koi'?.029:this.gameId==='studio-cosmic-escape'?.022:this.gameId==='studio-caramel-carnival'?.022:this.gameId==='studio-starfall-oracle'?.03:this.gameId==='studio-lumen-grove'?.025:this.gameId==='studio-stormforge-duel'?.025:this.gameId==='studio-saffron-cipher'?.018:this.gameId==='studio-beacon-bay'?.026:.028):.012;
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
    else if(this.gameId==='studio-copperline-express'){this.tone(293.66,.085,.01);this.tap(380,.06,.008);}
    else if(this.gameId==='studio-pulse-district'){this.tone(329.63,.085,.01);this.tap(420,.055,.008);}
    else if(this.gameId==='studio-jade-koi'){this.tone(392,.09,.009);this.tap(300,.06,.008);}
    else if(this.gameId==='royal-fruits'){this.tone(261.63,.08,.0065);this.tap(310,.05,.0045);}
    else if(this.gameId==='variant-fruits'){this.tone(293.66,.085,.0065);this.tap(370,.05,.0045);}
    else if(this.gameId==='studio-petal-parlor'){this.tone(440,.08,.007);this.tap(370,.05,.0055);}
    else if(this.gameId==='studio-sunbird-trails'){this.tone(329.63,.085,.007);this.tap(310,.05,.0055);}
    else if(this.gameId==='studio-ember-vault'){this.tone(311.13,.08,.008);this.tap(440,.05,.006);}
    else if(this.gameId==='studio-midnight-market'){this.tone(261.63,.085,.0075);this.tap(310,.05,.0055);}
    else if(this.gameId==='studio-moonlit-mint'){this.tone(293.66,.085,.007);this.tap(260,.05,.0055);}
    else if(this.gameId==='studio-deep-current'){this.tone(220,.085,.008);this.tap(270,.055,.006);}
    else if(this.gameId==='studio-blazing-orchard'){this.tone(233.08,.08,.0085);this.tap(360,.05,.0065);}
    else if(this.gameId==='studio-sky-lanterns'){this.tone(293.66,.08,.0085);this.tap(290,.05,.0065);}
    else if(this.gameId==='studio-rivet-rally'){this.tone(349.23,.075,.009);this.tap(410,.05,.007);}
    else if(this.gameId==='studio-frostline-courier'){this.tone(392,.085,.0085);this.tap(270,.055,.0065);}
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
