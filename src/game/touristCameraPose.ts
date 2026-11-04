import type { Facing } from '../shared/movement';
import type { StreetResidentPose } from './StreetResidentActions';

export const TOURIST_FRAMES=43;
const clamp=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
export function touristCameraFrame(pose:StreetResidentPose){
  const p=clamp(pose.progress);
  if(pose.action==='walk')return Math.max(0,Math.min(6,pose.frame));
  if(pose.action==='frame-photo')return p<.28?8+Math.round(p/.28*11):20;
  if(pose.action==='take-photo')return p>.42&&p<.56?21:20;
  if(pose.action==='review-photo')return p<.16?22+Math.round(p/.16*7):p<.65?30:31+Math.round((p-.65)/.35*11);
  return pose.action==='look-around'?7:6;
}
export function touristFramePose(frame:number){
  let lift=0,grip=0,review=0,press=0;
  let stage:'carry'|'raise'|'aim'|'shutter'|'lower'|'review'|'stow'='carry';
  if(frame>=8&&frame<=19){const t=(frame-8)/11;lift=ease((t-.2)/.8);grip=ease(t/.25);stage='raise';}
  if(frame===20||frame===21){lift=grip=1;press=frame===21?1:0;stage=press?'shutter':'aim';}
  if(frame>=22&&frame<=29){const t=ease((frame-22)/7);lift=1-.65*t;grip=1;review=t;stage='lower';}
  if(frame===30){lift=.35;grip=review=1;stage='review';}
  if(frame>=31){const t=(Math.min(42,frame)-31)/11;lift=.35*(1-ease(t/.7));grip=1-ease((t-.7)/.3);review=1-ease(t/.7);stage='stow';}
  return {lift,grip,review,press,stage,avatarFrame:frame<8?frame:6};
}

/** Body-local joints use the avatar's own bounce, rotation and left-facing mirror. */
export function touristCameraRig(facing:Facing,frame:number){
  const pose=touristFramePose(frame),side=facing==='left'||facing==='right',back=facing==='up';
  const step=frame<6?([0,1,.55,0,-1,-.55][frame]??0):0;
  const x=(side?44:32)+(side?6:8)*pose.lift+step*.7,y=(side?61:59)-pose.lift*(side?29:24)+Math.abs(step)*.3;
  const angle=step*.08-pose.review*.12;
  const point=(dx:number,dy:number)=>({x:x+dx*Math.cos(angle)-dy*Math.sin(angle),y:y+dx*Math.sin(angle)+dy*Math.cos(angle)});
  const far=point(side?8:-10,side?5:4),near=point(side?-4:10,side?2:3);
  return {...pose,side,back,mirrored:facing==='left',camera:{x,y,angle,w:side?13:20,h:side?10:12},hands:{far,near}};
}
