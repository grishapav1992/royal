/** Presentation kinematics. None of these values select a game outcome. */
const restitution=.68,firstImpact=.6,bounces=5;
const flightWeight=Array.from({length:bounces},(_,i)=>restitution**i).reduce((a,b)=>a+b,0);
const firstFlight=(1-firstImpact)/flightWeight;
const contacts=[firstImpact];
for(let i=0;i<bounces;i++)contacts.push(contacts[i]+firstFlight*restitution**i);
contacts[contacts.length-1]=1;
export const SPIN_CONTACTS:readonly number[]=Object.freeze(contacts);
export const SPIN_TIMING = Object.freeze({launch:650,landing:4400,drop:.30,join:contacts[1]});
export const POCKET_DIVIDER = Object.freeze({tipRadius:175,capRadius:1.25,width:.7});
export const BALL_RADIUS = 5;
const rimRadius=187,pocketRadius=148,pocketStep=360/37;
const pocketEdge=pocketStep/2-Math.asin((BALL_RADIUS+POCKET_DIVIDER.width/2)/pocketRadius)*180/Math.PI;
const deflectorRadius=POCKET_DIVIDER.tipRadius+POCKET_DIVIDER.capRadius+BALL_RADIUS;
const approachTime=(firstImpact-SPIN_TIMING.drop)*SPIN_TIMING.landing/1000;
const approachImpactSpeed=36;
const dragPower=8,dragMean=1/(dragPower+1);
const flightTime=(SPIN_TIMING.join-firstImpact)*SPIN_TIMING.landing/1000;
const pocketTime=(1-SPIN_TIMING.join)*SPIN_TIMING.landing/1000;
const pocketReboundSpeed=2*pocketEdge/pocketTime;
const pocketImpactSpeed=pocketReboundSpeed/.42;
export type SpinPhase = 'idle' | 'launch' | 'orbit' | 'coast' | 'drop' | 'pocket' | 'quiet';
export type SpinPose = {wheel:number; wheelVelocity:number; ball:number; ballVelocity:number; radius:number; hop:number; phase:SpinPhase};
export type LandingPlan = {
  start:SpinPose; pocket:number; distance:number;
  approach:{angle:number; speed:number; dragMix:number};
  pocketAngle:number; deflectorAngle:number; flightSpeed:number;
};
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
    radius:base.radius+(rimRadius-base.radius)*smooth(clamp(t/.28)),hop:0,phase:elapsedMs<SPIN_TIMING.launch?'launch':'orbit'};
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
  const delta=normalizeAngle(-pocket*pocketStep-start.wheel);
  let distance=delta+360*Math.ceil((min-delta)/360);
  if(distance+360<=max&&Math.abs(distance+360-start.wheelVelocity*duration/2)<Math.abs(distance-start.wheelVelocity*duration/2))distance+=360;
  if(distance<min-1e-8||distance>max+1e-8)throw Error('Wheel deceleration bounds are invalid');
  const dropping=coast(start,duration*SPIN_TIMING.drop),wheelAtDrop=wheelPose({start,distance},SPIN_TIMING.drop);
  const wheelAtImpact=wheelPose({start,distance},firstImpact);
  const angle=dropping.value,speed=-dropping.velocity;
  const lead=(2.5+Math.floor(normalizeAngle(angle-wheelAtDrop.value)/120))*pocketStep;
  // The drag curves span a full turn at launch speed. Pick the matching
  // separator closest to their midpoint in the stationary frame.
  const idealImpact=angle-wheelAtImpact.value-(speed+approachImpactSpeed)*approachTime/2;
  const pocketAngle=pocket*pocketStep+360*Math.round((idealImpact-pocket*pocketStep-lead)/360);
  const deflectorAngle=pocketAngle+lead;
  const meanSpeed=(angle-wheelAtImpact.value-deflectorAngle)/approachTime;
  const dragMix=((meanSpeed-approachImpactSpeed)/(speed-approachImpactSpeed)-dragMean)/(1-2*dragMean);
  const flightSpeed=2*(lead+pocketEdge)/flightTime-pocketImpactSpeed;
  return {start,pocket,distance,approach:{angle,speed,dragMix},pocketAngle,deflectorAngle,flightSpeed};
}
/** Ballistic flights lose height and duration with a constant restitution ratio. */
function bounce(t:number){
  for(let i=0;i<SPIN_CONTACTS.length-1;i++){
    const start=SPIN_CONTACTS[i],end=SPIN_CONTACTS[i+1];
    if(t>=start&&t<end){
      const u=(t-start)/(end-start),height=restitution**(2*i);
      return 4*u*(1-u)*height;
    }
  }
  return 0;
}
export function landingPose(plan:LandingPlan,elapsedMs:number):SpinPose {
  const t=clamp(elapsedMs/SPIN_TIMING.landing),w=wheelPose(plan,t),{drop,join}=SPIN_TIMING,duration=SPIN_TIMING.landing/1000;
  if(t>=1)return {wheel:w.value,wheelVelocity:0,ball:w.value+plan.pocketAngle,ballVelocity:0,radius:pocketRadius,hop:0,phase:'idle'};
  if(t<drop){const b=coast(plan.start,t*duration);return {wheel:w.value,wheelVelocity:w.velocity,ball:b.value,ballVelocity:b.velocity,radius:rimRadius,hop:0,phase:'coast'};}
  if(t<firstImpact){
    const u=(t-drop)/(firstImpact-drop),{angle,speed,dragMix}=plan.approach;
    // Apply drag in the stationary frame so the rotor can redirect the
    // ball only once it reaches the divider.
    const early=(1-(1-u)**(dragPower+1))*dragMean,late=u-u**(dragPower+1)*dragMean;
    const travel=approachTime*(approachImpactSpeed*u+(speed-approachImpactSpeed)*(early+(late-early)*dragMix));
    const drag=(1-dragMix)*(1-u)**dragPower+dragMix*(1-u**dragPower);
    const angularSpeed=approachImpactSpeed+(speed-approachImpactSpeed)*drag;
    return {wheel:w.value,wheelVelocity:w.velocity,ball:angle-travel,ballVelocity:-angularSpeed,
      radius:rimRadius+(deflectorRadius-rimRadius)*u*u,hop:0,phase:'drop'};
  }
  const hop=bounce(t);
  if(t<join){
    const u=(t-firstImpact)/(join-firstImpact);
    const speedLoss=plan.flightSpeed-pocketImpactSpeed;
    const travel=flightTime*u*(plan.flightSpeed-speedLoss*u/2);
    return {wheel:w.value,wheelVelocity:w.velocity,ball:w.value+plan.deflectorAngle-travel,ballVelocity:w.velocity-plan.flightSpeed+speedLoss*u,
      radius:deflectorRadius+(pocketRadius-deflectorRadius)*u*(.45+.55*u)+5.5*hop,hop,phase:'drop'};
  }
  // Contact with the far side of the pocket reverses the remaining slip. The
  // rebound decays to the center and comes to rest in the rotor's frame.
  const u=(t-join)/(1-join),remaining=1-u,angle=2*Math.PI*u;
  const offset=-pocketEdge*remaining**2*Math.cos(angle);
  const reboundVelocity=pocketReboundSpeed*remaining*(Math.cos(angle)+Math.PI*remaining*Math.sin(angle));
  return {wheel:w.value,wheelVelocity:w.velocity,ball:w.value+plan.pocketAngle+offset,ballVelocity:w.velocity+reboundVelocity,
    radius:pocketRadius+5.5*hop,hop,phase:'pocket'};
}
