import type { StreetResidentId } from './streetDetails';
import type { Facing } from '../shared/movement';

type Action='idle'|'greet'|'clear-snow'|'tap-shovel'|'rest'|'look-around'|'coffee'|'smoke'|'check-watch'|'frame-photo'|'take-photo'|'review-photo'|'wave'|'pose';
type Beat=readonly [Action,number];
const routines:Record<StreetResidentId,readonly Beat[]>={
  doorman:[['greet',1300],['idle',8300]],
  janitor:[['clear-snow',5600],['tap-shovel',2600],['rest',4200],['clear-snow',4800],['look-around',3400]],
  'taxi-driver':[['coffee',4000],['smoke',6000],['check-watch',2500],['idle',3500],['smoke',5000],['look-around',3000]],
  tourist:[['frame-photo',4000],['take-photo',2200],['review-photo',4800],['look-around',2800]],
  mascot:[['wave',4200],['pose',3200],['rest',3400],['greet',2200]],
};
export type StreetResidentPose={action:Action;progress:number;frame:number;facing?:Facing};

/** Sample the street clock directly, without independent timers or catch-up effects. */
export function streetResidentPose(id:StreetResidentId,time:number,motion:boolean,talking=false):StreetResidentPose {
  if(!motion||talking)return {action:'idle',progress:0,frame:6};
  const beats=routines[id],duration=beats.reduce((sum,beat)=>sum+beat[1],0);
  let phase=((Number.isFinite(time)?Math.max(0,time):0)+(id==='tourist'?1400:id==='mascot'?700:0))%duration;
  for(const [action,length] of beats){
    if(phase>=length){phase-=length;continue;}
    const progress=phase/length;
    const holdsCamera=id==='tourist'&&['frame-photo','take-photo','review-photo'].includes(action);
    const frame=holdsCamera?14:action==='coffee'?11+Math.min(5,Math.floor(progress*6)):action==='look-around'||action==='greet'?7:action==='rest'?9:6;
    const facing:Facing|undefined=id==='tourist'?(action==='review-photo'?'down':action==='look-around'?'right':'up'):undefined;
    return {action,progress,frame,facing};
  }
  return {action:'idle',progress:0,frame:6};
}
