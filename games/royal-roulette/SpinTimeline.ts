/** Presentation kinematics. None of these values select a game outcome. */
export const SPIN_TIMING = Object.freeze({launch:650, landing:3200, join:.83});
export type SpinPhase = 'idle' | 'launch' | 'orbit' | 'coast' | 'drop' | 'pocket' | 'quiet';
export type SpinPose = {wheel:number; wheelVelocity:number; ball:number; ballVelocity:number; radius:number; hop:number; phase:SpinPhase};
export type LandingPlan = {start:SpinPose; pocket:number; distance:number; ballJoin:number; ballJoinVelocity:number; ballOffset:number};
export const normalizeAngle = (value:number) => ((value%360)+360)%360;
const clamp = (value:number) => Math.max(0,Math.min(1,value));
const smooth = (t:number) => t*t*(3-2*t);
function ramp(speed:number,seconds:number) {
  const duration=.45,t=Math.max(0,seconds);
  if(t>=duration)return {angle:speed*(t-duration/2),velocity:speed};
  return {angle:speed*(t-duration/Math.PI*Math.sin(Math.PI*t/duration))/2,velocity:speed*(1-Math.cos(Math.PI*t/duration))/2};
}
export function launchPose(base:SpinPose,elapsedMs:number):SpinPose {
  const t=Math.max(0,elapsedMs)/1000,w=ramp(450,t),b=ramp(-1000,t);
  return {wheel:base.wheel+w.angle,wheelVelocity:w.velocity,ball:base.ball+b.angle,ballVelocity:b.velocity,
    radius:base.radius+(187-base.radius)*smooth(clamp(t/.28)),hop:0,phase:elapsedMs<SPIN_TIMING.launch?'launch':'orbit'};
}
function hermite(from:number,to:number,v0:number,v1:number,t:number,duration:number) {
  const t2=t*t,t3=t2*t;
  return {value:(2*t3-3*t2+1)*from+(t3-2*t2+t)*duration*v0+(-2*t3+3*t2)*to+(t3-t2)*duration*v1,
    velocity:((6*t2-6*t)*from+(3*t2-4*t+1)*duration*v0+(-6*t2+6*t)*to+(3*t2-2*t)*duration*v1)/duration};
}
function wheelPose(plan:Pick<LandingPlan,'start'|'distance'>,t:number) {
  return hermite(plan.start.wheel,plan.start.wheel+plan.distance,plan.start.wheelVelocity,0,t,SPIN_TIMING.landing/1000);
}
export function landingPlan(start:SpinPose,pocket:number):LandingPlan {
  if(!Number.isInteger(pocket)||pocket<0||pocket>=37||start.wheelVelocity<360||!Object.values(start).filter(v=>typeof v==='number').every(Number.isFinite))throw Error('Invalid roulette presentation pose');
  const duration=SPIN_TIMING.landing/1000,min=start.wheelVelocity*duration/3,max=2*min;
  const delta=normalizeAngle(-pocket*360/37-start.wheel);
  let distance=delta+360*Math.ceil((min-delta)/360);
  if(distance+360<=max&&Math.abs(distance+360-start.wheelVelocity*duration/2)<Math.abs(distance-start.wheelVelocity*duration/2))distance+=360;
  if(distance<min-1e-8||distance>max+1e-8)throw Error('Wheel deceleration bounds are invalid');
  const joining=wheelPose({start,distance},SPIN_TIMING.join),worldJoin=joining.value+pocket*360/37;
  const ideal=start.ball+(start.ballVelocity+joining.velocity)*duration*SPIN_TIMING.join/2;
  let ballJoin=worldJoin+360*Math.round((ideal-worldJoin)/360);
  while(ballJoin>start.ball-360)ballJoin-=360;
  return {start,pocket,distance,ballJoin,ballJoinVelocity:joining.velocity,ballOffset:ballJoin-worldJoin};
}
export function landingPose(plan:LandingPlan,elapsedMs:number):SpinPose {
  const t=clamp(elapsedMs/SPIN_TIMING.landing),w=wheelPose(plan,t),join=SPIN_TIMING.join;
  if(t>=1)return {wheel:plan.start.wheel+plan.distance,wheelVelocity:0,ball:plan.start.wheel+plan.distance+plan.pocket*360/37+plan.ballOffset,ballVelocity:0,radius:148,hop:0,phase:'idle'};
  if(t<join){
    const b=hermite(plan.start.ball,plan.ballJoin,plan.start.ballVelocity,plan.ballJoinVelocity,t/join,SPIN_TIMING.landing/1000*join);
    const drop=clamp((t-.52)/(join-.52)),hop=Math.sin(drop*Math.PI*6)**2*(1-drop);
    return {wheel:w.value,wheelVelocity:w.velocity,ball:b.value,ballVelocity:b.velocity,radius:187-39*smooth(drop)+4.5*hop,hop,phase:t<.52?'coast':'drop'};
  }
  const local=(t-join)/(1-join),hop=Math.sin(local*Math.PI*3)**2*(1-local)**2;
  const wobble=2.2*Math.sin(local*Math.PI*4)*Math.sin(local*Math.PI)**2*(1-local);
  return {wheel:w.value,wheelVelocity:w.velocity,ball:w.value+plan.pocket*360/37+plan.ballOffset+wobble,ballVelocity:w.velocity,
    radius:148+5*hop,hop,phase:'pocket'};
}
