import type {CharacterBeat,TempleReaction} from './character';

export const motionChannels=['gaze','nod','tilt','lean','lift','rightArm','leftArm','lantern','breath','blink','smile'] as const;
export type MotionChannel=typeof motionChannels[number];
export type PortraitMotion=Record<MotionChannel,number>;
const neutral=():PortraitMotion=>({gaze:0,nod:0,tilt:0,lean:0,lift:0,rightArm:0,leftArm:0,lantern:0,breath:0,blink:0,smile:0});
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const smooth=(value:number)=>{const x=clamp(value);return x*x*(3-2*x);};
const pulse=(time:number,start:number,length:number)=>{const p=(time-start)/length;return p<0||p>1?0:Math.sin(p*Math.PI)**2;};
const springs:PortraitMotion={gaze:.12,nod:.11,tilt:.17,lean:.2,lift:.18,rightArm:.22,leftArm:.24,lantern:.28,breath:.2,blink:.022,smile:.11};
const variantFor=(key:string)=>{let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);return(hash>>>0)%3;};

/** These curves describe an already confirmed event, never the chance of a win. */
export function characterMotionTarget(clip:string,beat:CharacterBeat|undefined,offset:number,clock:number,variant:number):PortraitMotion{
  const seconds=clock/1000,p=beat?clamp(offset/beat.duration):0,attack=smooth(p/.2),accent=Math.sin(p*Math.PI),side=variant===1?-1:1;
  const idleCycle=clock%26000;
  const blink=Math.max(pulse(idleCycle,3300,170),pulse(idleCycle,8700,180),pulse(idleCycle,14600,165),pulse(idleCycle,21700,190));
  const glance=pulse(idleCycle,11000,2700);
  const m:PortraitMotion={gaze:glance*.48,nod:Math.sin(seconds*.37)*.035,tilt:Math.sin(seconds*.29)*.06,lean:Math.sin(seconds*.4)*.065,lift:0,rightArm:Math.sin(seconds*.46)*.025,leftArm:Math.sin(seconds*.51+.7)*.035,lantern:Math.sin(seconds*.82+.7)*.09,breath:Math.sin(seconds*1.45),blink,smile:0};
  if(clip==='waiting'||clip==='glance'||clip==='survey'){
    m.gaze=.65;m.nod=.08;m.tilt=-.1;m.lean=.1;m.leftArm=.1;
  }else if(clip==='watch-fall'||clip==='steady'){
    m.gaze=.45+.35*smooth(p);m.nod=-.2+.5*smooth(p);m.tilt=side*.1*accent;
    m.lean=.12+(clip==='steady'?.12:0);m.rightArm=variant===2?.18*accent:-.08*accent;m.leftArm=.13+.12*accent;
  }else if(clip==='shield'||clip==='follow-stones'){
    m.gaze=.7;m.nod=-.18*accent;m.lean=-.22*accent;m.tilt=-side*.12*accent;
    m.rightArm=variant===0?.25*accent:-.16*accent;m.leftArm=.3*accent;m.lantern+=side*.35*accent;
  }else if(clip==='follow-chain'||clip==='treasure'){
    m.gaze=.65;m.nod=.25*accent;m.tilt=side*.12*accent;m.lean=.2*accent;
    m.rightArm=variant===1?.24*accent:.08;m.leftArm=.12*accent;
  }else if(clip==='relic'){
    m.gaze=.55-.3*attack;m.nod=-.18*attack;m.tilt=side*.3*attack;m.lean=.22*attack;m.lift=.45*attack;
    m.rightArm=(variant===1?.5:.8)*attack;m.leftArm=.5*attack;m.lantern+=side*.35*accent;m.smile=.5*attack;
  }else if(clip==='back-to-temple'){
    m.gaze=.8;m.nod=.18*accent;m.tilt=-.12;m.lean=.12;m.rightArm=-.1*accent;m.leftArm=.15;
  }else if(clip==='success'||clip==='triumph'){
    const big=clip==='triumph',strength=big?1:.55,nod=Math.sin(p*Math.PI*(variant===2?4:2));
    m.gaze=.15*(1-attack);m.nod=nod*.4*strength;m.tilt=side*.28*attack*strength;
    m.lean=side*.24*attack*strength;m.lift=.75*attack*strength;
    m.rightArm=(variant===0?.9:.6)*attack*strength;m.leftArm=(variant===1?.95:.55)*attack*strength;
    m.lantern+=side*.4*accent*strength;m.smile=(big?1:.65)*attack;
  }else if(clip==='reflect'){
    m.gaze=.25;m.nod=.42*attack;m.tilt=-.12*attack;m.lean=-.12*attack;m.lift=-.12*attack;
    m.rightArm=-.12*attack;m.leftArm=-.1*attack;
  }else if(clip==='settle'){
    m.gaze=.2;m.nod=.12*accent;m.tilt=side*.08*accent;
  }
  return m;
}

/** Persistent critically damped channels keep position and velocity at event boundaries. */
export class CharacterMotion{
  private values=neutral();
  private velocity=neutral();
  private target=neutral();
  private key='';
  private clip='breathe';
  private beat?:CharacterBeat;
  private offset=0;
  private variant=0;
  private maxStep=0;
  select(key:string,reaction:TempleReaction,beat?:CharacterBeat){
    if(key===this.key)return;
    this.key=key;this.clip=reaction.clip;this.beat=beat;this.offset=0;
    this.variant=(variantFor(key)+(beat?.variant??0))%3;
  }
  step(dtMs:number,clock:number,offset:number){
    this.offset=Math.max(this.offset,offset);
    this.target=characterMotionTarget(this.clip,this.beat,this.offset,clock,this.variant);
    const dt=clamp(dtMs,0,80)/1000;
    if(!dt)return this.values;
    for(const key of motionChannels){
      const omega=2/springs[key],decay=Math.exp(-omega*dt),change=this.values[key]-this.target[key],travel=(this.velocity[key]+omega*change)*dt;
      const next=clamp(this.target[key]+(change+travel)*decay,key==='blink'||key==='smile'?0:-1,1);
      this.velocity[key]=(this.velocity[key]-omega*travel)*decay;
      this.maxStep=Math.max(this.maxStep,Math.abs(next-this.values[key]));this.values[key]=next;
    }
    return this.values;
  }
  freeze(){this.velocity=neutral();}
  reset(){this.values=neutral();this.velocity=neutral();this.target=neutral();this.key='';this.clip='breathe';this.beat=undefined;this.offset=0;this.variant=0;this.maxStep=0;}
  getState(){return {clip:this.clip,variant:this.variant,offsetMs:this.offset,channels:{...this.values},target:{...this.target},velocity:{...this.velocity},maxStep:this.maxStep};}
}
