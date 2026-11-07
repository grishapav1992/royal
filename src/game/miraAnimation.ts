import {MIRA_SERVICE_SECONDS,miraSeatAmount,type MiraView} from '../shared/miraRoutine';

export const MIRA_ATLASES={
  walk:{file:'mira-walk-24.png',columns:6,rows:4,fullBody:true},
  seat:{file:'mira-seat-cycle.png',columns:6,rows:8,fullBody:true,anchorGround:446,scaleHeight:433},
  wipe:{file:'mira-wipe-24.png',columns:6,rows:4,fullBody:false,contactGround:319},
  work:{file:'mira-work-corrected.png',columns:4,rows:4,fullBody:false},
  react:{file:'mira-react.png',columns:4,rows:4,fullBody:false},
  serve:{file:'mira-serve-24.png',columns:6,rows:4,fullBody:false,anchorGround:427,scaleHeight:414},
} as const;
export type MiraAtlas=keyof typeof MIRA_ATLASES;
export type MiraFrame={atlas:MiraAtlas;frame:number;seat:number;flipped:boolean;clip:MiraView['action']};
const SERVE_FRAME_START_MS=[0,100,200,400,490,580,660,750,880,1000,1200,1400,1600,1670,1750,1820,1900,2050,2120,2200,2310,2430,2540,2650] as const;
const SERVE_DURATION_MS=MIRA_SERVICE_SECONDS*1000;

export function isMiraPouring(frame:MiraFrame|undefined):boolean {
  return frame?.atlas==='serve'&&frame.frame>=8&&frame.frame<=12;
}

const clamp=(p:number)=>Math.max(0,Math.min(1,Number.isFinite(p)?p:0));
const frameAt=(p:number,count:number)=>Math.min(count-1,Math.floor(clamp(p)*count));

export function interpolateMiraProgress(from:MiraView,to:MiraView,amount:number):Partial<MiraView> {
  if(from.action===to.action&&['wipe','sit','sit-down','stand-up','serve'].includes(from.action)&&to.progress>=from.progress){
    return {progress:from.progress+(to.progress-from.progress)*amount};
  }
  if(from.action!=='walk'||to.action!=='walk')return {};
  const phaseChange=(to.progress-from.progress+1)%1;
  return {progress:(from.progress+phaseChange*amount)%1};
}

/** Complete painted poses share the authoritative room timeline. No articulated cutout limbs. */
export function sampleMiraFrame(view:MiraView,reducedMotion=false):MiraFrame {
  const p=clamp(view.progress),seat=miraSeatAmount(view.action,p);
  const result:MiraFrame={atlas:'react',frame:8,seat,flipped:false,clip:view.action};
  switch(view.action){
    case 'walk':return {...result,atlas:'walk',frame:reducedMotion?3:frameAt(p,MIRA_ATLASES.walk.columns*MIRA_ATLASES.walk.rows),flipped:view.facing==='left'};
    case 'sit':return {...result,atlas:'seat',frame:24+(reducedMotion?0:frameAt(p%1,24))};
    case 'sit-down':return {...result,atlas:'seat',frame:Math.round(p*23)};
    case 'stand-up':return {...result,atlas:'seat',frame:Math.round((1-p)*23)};
    case 'wipe':{
      const count=MIRA_ATLASES.wipe.columns*MIRA_ATLASES.wipe.rows;
      return {...result,atlas:'wipe',frame:reducedMotion?3:frameAt(p===1?1:(p*5)%1,count)};
    }
    case 'polish':{
      const sequence=[8,9,10,11,10,9];
      return {...result,atlas:'work',frame:reducedMotion?8:sequence[frameAt((p*5)%1,sequence.length)]};
    }
    case 'stock':return {...result,atlas:'work',frame:12+frameAt(p,4)};
    case 'serve':{
      const next=SERVE_FRAME_START_MS.findIndex(start=>p<start/SERVE_DURATION_MS);
      const frame=next<0?SERVE_FRAME_START_MS.length-1:next-1;
      return {...result,atlas:'serve',frame};
    }
    case 'greet':return {...result,frame:reducedMotion?8:frameAt(clamp((p-.08)/.84),8)};
    case 'listen':{
      const nod=[9,10,11,10,9];
      return {...result,frame:reducedMotion||p<=.3||p>=.7?8:nod[frameAt((p-.3)/.4,nod.length)]};
    }
    case 'chat':{
      const sequence=[15,12,13,14,13,12,15,15];
      return {...result,frame:reducedMotion?13:sequence[frameAt(p,sequence.length)]};
    }
    default:return result;
  }
}
