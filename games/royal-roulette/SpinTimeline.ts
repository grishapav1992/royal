/** Presentation kinematics. None of these values select a game outcome. */
const restitution=.68,firstImpact=.6,bounces=5;
const flightWeight=Array.from({length:bounces},(_,i)=>restitution**i).reduce((a,b)=>a+b,0);
const firstFlight=(1-firstImpact)/flightWeight;
const contacts=[firstImpact];
for(let i=0;i<bounces;i++)contacts.push(contacts[i]+firstFlight*restitution**i);
contacts[contacts.length-1]=1;
export const SPIN_CONTACTS:readonly number[]=Object.freeze(contacts);
export const SPIN_TIMING = Object.freeze({launch:650,landing:4400,drop:.43,join:contacts[2]});
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
/** Rolling drag dissipates speed while the ball is still supported by the rim. */
function coast(start:SpinPose,seconds:number){
  const drag=.68,decay=Math.exp(-drag*seconds);
  return {value:start.ball+start.ballVelocity*(1-decay)/drag,velocity:start.ballVelocity*decay};
}
export function landingPlan(start:SpinPose,pocket:number):LandingPlan {
  if(!Number.isInteger(pocket)||pocket<0||pocket>=37||start.wheelVelocity<360||!Object.values(start).filter(v=>typeof v==='number').every(Number.isFinite))throw Error('Invalid roulette presentation pose');
  const duration=SPIN_TIMING.landing/1000,min=start.wheelVelocity*duration/3,max=2*min;
  const delta=normalizeAngle(-pocket*360/37-start.wheel);
  let distance=delta+360*Math.ceil((min-delta)/360);
  if(distance+360<=max&&Math.abs(distance+360-start.wheelVelocity*duration/2)<Math.abs(distance-start.wheelVelocity*duration/2))distance+=360;
  if(distance<min-1e-8||distance>max+1e-8)throw Error('Wheel deceleration bounds are invalid');
  const joining=wheelPose({start,distance},SPIN_TIMING.join),worldJoin=joining.value+pocket*360/37;
  const dropping=coast(start,duration*SPIN_TIMING.drop),flight=duration*(SPIN_TIMING.join-SPIN_TIMING.drop);
  const ideal=dropping.value+(dropping.velocity+joining.velocity)*flight/2;
  const ballJoin=worldJoin+360*Math.round((ideal-worldJoin)/360);
  return {start,pocket,distance,ballJoin,ballJoinVelocity:joining.velocity,ballOffset:ballJoin-worldJoin};
}
/** Ballistic flights lose height and duration with a constant restitution ratio. */
function bounce(t:number){
  for(let i=0;i<SPIN_CONTACTS.length-1;i++){
    const start=SPIN_CONTACTS[i],end=SPIN_CONTACTS[i+1];
    if(t>=start&&t<end){
      const u=(t-start)/(end-start),height=restitution**(2*i);
      return {hop:4*u*(1-u)*height,sway:(i%2?-1:1)*1.8*height*Math.sin(Math.PI*u)**2,
        swayVelocity:(i%2?-1:1)*1.8*height*Math.PI*Math.sin(2*Math.PI*u)/((end-start)*SPIN_TIMING.landing/1000)};
    }
  }
  return {hop:0,sway:0,swayVelocity:0};
}
export function landingPose(plan:LandingPlan,elapsedMs:number):SpinPose {
  const t=clamp(elapsedMs/SPIN_TIMING.landing),w=wheelPose(plan,t),{drop,join}=SPIN_TIMING,duration=SPIN_TIMING.landing/1000;
  if(t>=1)return {wheel:plan.start.wheel+plan.distance,wheelVelocity:0,ball:plan.start.wheel+plan.distance+plan.pocket*360/37+plan.ballOffset,ballVelocity:0,radius:148,hop:0,phase:'idle'};
  if(t<drop){const b=coast(plan.start,t*duration);return {wheel:w.value,wheelVelocity:w.velocity,ball:b.value,ballVelocity:b.velocity,radius:187,hop:0,phase:'coast'};}
  const impact=bounce(t);
  if(t<join){
    const from=coast(plan.start,drop*duration),u=(t-drop)/(join-drop);
    const b=hermite(from.value,plan.ballJoin,from.velocity,plan.ballJoinVelocity,u,duration*(join-drop));
    return {wheel:w.value,wheelVelocity:w.velocity,ball:b.value+impact.sway,ballVelocity:b.velocity+impact.swayVelocity,
      radius:187-39*smooth(u)+5.5*impact.hop,hop:impact.hop,phase:'drop'};
  }
  return {wheel:w.value,wheelVelocity:w.velocity,ball:w.value+plan.pocket*360/37+plan.ballOffset+impact.sway,ballVelocity:w.velocity+impact.swayVelocity,
    radius:148+5.5*impact.hop,hop:impact.hop,phase:'pocket'};
}
