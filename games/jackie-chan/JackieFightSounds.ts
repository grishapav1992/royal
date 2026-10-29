export type FightSound = 'punch'|'kick'|'chair'|'block'|'whoosh'|'wood'|'landing';

const settings:Record<FightSound,{duration:number;peak:number}>={
  punch:{duration:.19,peak:.68},kick:{duration:.26,peak:.72},chair:{duration:.23,peak:.74},
  block:{duration:.13,peak:.40},whoosh:{duration:.16,peak:.12},wood:{duration:.12,peak:.13},landing:{duration:.27,peak:.32},
};

/** Original arcade Foley. Cosmetic noise is independent from the paid-round RNG. */
export function fightSound(cue:FightSound,sampleRate:number,variation=0):Float32Array {
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Invalid sound sample rate');
  const {duration,peak}=settings[cue],data=new Float32Array(Math.ceil(duration*sampleRate));
  const variant=((Math.trunc(variation)%4)+4)%4,tune=1+(variant-1.5)*.024;
  let seed=0x9e3779b9^(variant+1)*0x45d9f3b,low=0,mid=0,air=0,phase=0,prior=0,highpass=0,maximum=0;
  const coefficient=(hz:number)=>1-Math.exp(-2*Math.PI*Math.min(sampleRate*.42,hz)/sampleRate),dc=Math.exp(-2*Math.PI*22/sampleRate);
  const lowRate=coefficient(210),midRate=coefficient(1800),airRate=coefficient(7800);
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,u=t/duration;
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/2147483648-1;
    low+=(noise-low)*lowRate;mid+=(noise-mid)*midRate;air+=(noise-air)*airRate;
    const onset=1-Math.exp(-t/.00065),tail=Math.min(1,Math.max(0,(duration-t)/.008));
    let value:number;
    if(cue==='whoosh'){
      const sweep=coefficient(450+2300*(1-u));prior+=(noise-prior)*sweep;
      value=(air-prior)*Math.pow(Math.sin(Math.PI*u),1.7);
    }else if(cue==='wood'){
      value=(Math.sin(2*Math.PI*195*t*tune)+.45*Math.sin(2*Math.PI*431*t*tune)+.22*Math.sin(2*Math.PI*823*t))*Math.exp(-t/.027)+noise*.18*Math.exp(-t/.006);
    }else{
      const kick=cue==='kick',chair=cue==='chair',block=cue==='block',landing=cue==='landing';
      const end=landing?34:kick?43:chair?51:block?110:65;
      const start=landing?100:kick?155:chair?180:block?270:205;
      phase+=2*Math.PI*(end+(start-end)*Math.exp(-t/.019))*tune/sampleRate;
      const body=Math.sin(phase)*Math.exp(-t/(kick?.062:landing?.073:.043));
      const slap=(air-mid)*Math.exp(-t/(block?.009:.014));
      const crunch=Math.tanh((mid-low)*3.4)*Math.exp(-t/(chair?.047:kick?.048:.032));
      value=body*(landing?1.1:.92)+slap*(landing?.20:block?1.6:1.25)+crunch*(landing?.32:.52);
      if(chair)value+=(Math.sin(2*Math.PI*187*t*tune)+.40*Math.sin(2*Math.PI*463*t))*Math.exp(-t/.038)*.48;
      if(landing)value+=low*.75*Math.exp(-t/.095);
    }
    value=Math.tanh(value*1.35)*onset*tail;
    // Remove DC before peak limiting; the tail is faded again after filtering.
    if(cue!=='whoosh'){highpass=dc*(highpass+value-prior);prior=value;value=highpass;}
    data[i]=value*tail;maximum=Math.max(maximum,Math.abs(data[i]));
  }
  if(maximum)for(let i=0;i<data.length;i++)data[i]*=peak/maximum;
  return data;
}
