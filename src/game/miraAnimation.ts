import {MIRA_REST_SECONDS,MIRA_SERVICE_SECONDS,miraSeatAmount,type MiraAction,type MiraView} from '../shared/miraRoutine';

export const MIRA_ATLASES={
  walk:{file:'mira-walk-24.png',columns:6,rows:4,fullBody:true},
  seat:{file:'mira-seat-cycle.png',columns:6,rows:8,fullBody:true,anchorGround:446,scaleHeight:433},
  wipe:{file:'mira-wipe-24.png',columns:6,rows:4,fullBody:false,contactGround:319},
  work:{file:'mira-work-corrected.png',columns:4,rows:4,fullBody:false},
  react:{file:'mira-react.png',columns:4,rows:4,fullBody:false},
  serve:{file:'mira-serve-24.png',columns:6,rows:4,fullBody:false,anchorGround:427,scaleHeight:414},
  // In-betweens and new poses painted from the work and reaction sheets: frames 0-8 keep the work scale, 9-27 the reaction scale.
  extra:{file:'mira-extra-28.png',columns:7,rows:4,fullBody:false},
} as const;
export const MIRA_EXTRA_WORK_FRAMES=9;
export type MiraAtlas=keyof typeof MIRA_ATLASES;
export type MiraFrame={atlas:MiraAtlas;frame:number;seat:number;flipped:boolean;clip:MiraView['action']};
const SERVE_FRAME_START_MS=[0,100,200,400,490,580,660,750,880,1000,1200,1400,1600,1670,1750,1820,1900,2050,2120,2200,2310,2430,2540,2650] as const;
const SERVE_DURATION_MS=MIRA_SERVICE_SECONDS*1000;

export function isMiraPouring(frame:MiraFrame|undefined):boolean {
  return frame?.atlas==='serve'&&frame.frame>=8&&frame.frame<=12;
}

const clamp=(p:number)=>Math.max(0,Math.min(1,Number.isFinite(p)?p:0));
const frameAt=(p:number,count:number)=>Math.min(count-1,Math.floor(clamp(p)*count));

type Pose=readonly [MiraAtlas,number];
type Beat=readonly [Pose,number];
const W=(frame:number):Pose=>['work',frame],R=(frame:number):Pose=>['react',frame],X=(frame:number):Pose=>['extra',frame];
/** Weighted holds: key poses stay longer, passing poses are short. Frames change crisply, never blended. */
function beat(beats:readonly Beat[],p:number):Pose{
  const total=beats.reduce((sum,[,weight])=>sum+weight,0);let at=clamp(p)*total;
  for(const [pose,weight] of beats){if(at<weight)return pose;at-=weight;}
  return beats[beats.length-1][0];
}
const POLISH:readonly Beat[]=[[W(8),.4],[X(5),.14],[W(9),.14],[X(6),.14],[W(10),.14],[X(7),.14],[W(11),.45],[X(8),.16]];
const STOCK:readonly Beat[]=[[W(12),.35],[X(0),.2],[W(13),.25],[X(1),.2],[W(14),.7],[X(2),.2],[W(15),.3],[X(3),.25],[X(4),.3]];
const TALK:readonly Beat[]=[[R(15),.14],[X(9),.14],[R(13),.2],[X(10),.18],[R(14),.16],[X(11),.2],[X(12),.18],[R(13),.16],[X(13),.22],[X(14),.16],[R(12),.2],[R(15),.25]];
// A blink and a small nod inside each four-second listening cycle.
const LISTEN:readonly Beat[]=[[R(8),.45],[R(10),.03],[R(8),.22],[R(9),.06],[R(11),.08],[R(9),.06],[R(8),.1]];
const REACTIONS:Record<'smile'|'tease'|'concern',readonly Beat[]>={
  smile:[[X(15),.2],[X(16),.5],[X(17),.6]],
  tease:[[X(18),.3],[X(19),.45],[X(20),.55]],
  concern:[[X(21),.4],[X(22),.5],[X(23),.4]],
};
// Pauses between jobs: at home she looks over the hall and fixes her hair, at the far end she rests her cheek.
const IDLE_HOME:readonly Beat[]=[[R(8),.2],[X(24),.35],[R(10),.04],[R(8),.1],[X(27),.31]];
const IDLE_AWAY:readonly Beat[]=[[R(8),.15],[X(25),.35],[X(26),.5]];
const MIRA_HOME_X=265;
// Seated rest: hold, lift the lemonade through all 24 seated drawings, sip, lower it the same way.
const SIP_SECONDS=6.2;
function sipFrame(seconds:number){
  const t=seconds%SIP_SECONDS;
  return t<1.2?24:t<3.2?24+Math.min(23,Math.floor((t-1.2)/2*24)):t<4.2?47:47-Math.min(23,Math.floor((t-4.2)/2*24));
}

const MONOTONIC:readonly MiraAction[]=['wipe','sit','sit-down','stand-up','serve','polish','stock','idle','greet','smile','tease','concern'];
export function interpolateMiraProgress(from:MiraView,to:MiraView,amount:number):Partial<MiraView> {
  if(from.action===to.action&&MONOTONIC.includes(from.action)&&to.progress>=from.progress){
    return {progress:from.progress+(to.progress-from.progress)*amount};
  }
  if(from.action!==to.action||!['walk','listen','chat'].includes(from.action))return {};
  const phaseChange=(to.progress-from.progress+1)%1;
  return {progress:(from.progress+phaseChange*amount)%1};
}

/** Complete painted poses share the authoritative room timeline. No articulated cutout limbs. */
export function sampleMiraFrame(view:MiraView,reducedMotion=false):MiraFrame {
  const p=clamp(view.progress),seat=miraSeatAmount(view.action,p);
  const result:MiraFrame={atlas:'react',frame:8,seat,flipped:false,clip:view.action};
  const pose=([atlas,frame]:Pose):MiraFrame=>({...result,atlas,frame});
  switch(view.action){
    case 'walk':return {...result,atlas:'walk',frame:reducedMotion?3:frameAt(p,MIRA_ATLASES.walk.columns*MIRA_ATLASES.walk.rows),flipped:view.facing==='left'};
    case 'sit':return {...result,atlas:'seat',frame:reducedMotion?24:sipFrame(p*MIRA_REST_SECONDS)};
    case 'sit-down':return {...result,atlas:'seat',frame:Math.round(p*23)};
    case 'stand-up':return {...result,atlas:'seat',frame:Math.round((1-p)*23)};
    case 'wipe':{
      const count=MIRA_ATLASES.wipe.columns*MIRA_ATLASES.wipe.rows;
      return {...result,atlas:'wipe',frame:reducedMotion?3:frameAt(p===1?1:(p*5)%1,count)};
    }
    case 'polish':return reducedMotion?pose(W(8)):pose(beat(POLISH,p===1?1:(p*4)%1));
    case 'stock':return reducedMotion?pose(W(14)):pose(beat(STOCK,p===1?1:(p*2)%1));
    case 'idle':return reducedMotion?pose(R(8)):pose(beat(Math.abs(view.x-MIRA_HOME_X)<1?IDLE_HOME:IDLE_AWAY,p));
    case 'serve':{
      const next=SERVE_FRAME_START_MS.findIndex(start=>p<start/SERVE_DURATION_MS);
      const frame=next<0?SERVE_FRAME_START_MS.length-1:next-1;
      return {...result,atlas:'serve',frame};
    }
    case 'greet':return {...result,frame:reducedMotion?8:frameAt(clamp((p-.08)/.84),8)};
    case 'listen':return reducedMotion?pose(R(8)):pose(beat(LISTEN,p));
    case 'chat':return reducedMotion?pose(R(13)):pose(beat(TALK,(p*2)%1));
    case 'smile':case 'tease':case 'concern':{
      const beats=REACTIONS[view.action];
      return pose(reducedMotion?beats[1][0]:beat(beats,p));
    }
    default:return result;
  }
}
