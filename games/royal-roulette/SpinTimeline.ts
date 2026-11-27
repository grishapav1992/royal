/** Presentation kinematics. None of these values select a game outcome. */
import {BALL_RADIUS,PHYSICS,WHEEL,angleOf,ballAt,displayRotor,simulateLanding,type BallSimulation,type Contact,type Surface} from './BallPhysics';

export {BALL_RADIUS,WHEEL};
export const SPIN_TIMING = Object.freeze({launch:650,ramp:450,brake:PHYSICS.brake*1000,glide:PHYSICS.glide*1000,maxLanding:8600});
export const LAUNCH_SPEED = Object.freeze({wheel:330,ball:-1080});
export type SpinPhase = 'idle' | 'launch' | 'orbit' | 'coast' | 'drop' | 'pocket' | 'quiet';
export type SpinPose = {
  wheel:number; wheelVelocity:number; ball:number; ballVelocity:number; radius:number; hop:number; height:number;
  x:number; y:number; ux:number; uy:number; surface:Surface; visible:boolean; phase:SpinPhase;
};
export type LandingPlan = {start:SpinPose; pocket:number; duration:number; simulation:BallSimulation; contacts:readonly Contact[]};

export const normalizeAngle = (value:number) => ((value%360)+360)%360;
const clamp = (value:number) => Math.max(0,Math.min(1,value));
const smooth = (t:number) => t*t*(3-2*t);
const degrees = (radians:number) => radians*180/Math.PI;

/** A ball resting in `pocket`, with the rotor turned so that pocket faces the viewer. */
export function restingPose(pocket?:number):SpinPose {
  const wheel=pocket===undefined?0:normalizeAngle(180-pocket*360/37);
  return {wheel,wheelVelocity:0,ball:180,ballVelocity:0,radius:WHEEL.rest,hop:0,height:0,x:0,y:WHEEL.rest,ux:0,uy:0,surface:'pocket',visible:pocket!==undefined,phase:'idle'};
}

function ramp(speed:number,seconds:number) {
  const duration=SPIN_TIMING.ramp/1000,t=Math.max(0,seconds);
  if(t>=duration)return {angle:speed*(t-duration/2),velocity:speed};
  return {angle:speed*(t-duration/Math.PI*Math.sin(Math.PI*t/duration))/2,velocity:speed*(1-Math.cos(Math.PI*t/duration))/2};
}
/** The croupier's launch: rotor and ball accelerate in opposite directions while the receipt is pending. */
export function launchPose(base:SpinPose,elapsedMs:number):SpinPose {
  const t=Math.max(0,elapsedMs)/1000,w=ramp(LAUNCH_SPEED.wheel,t),b=ramp(LAUNCH_SPEED.ball,t);
  const from=base.visible?base.radius:WHEEL.track,lift=smooth(clamp(t/.28));
  const radius=from+(WHEEL.track-from)*lift,ball=(base.visible?base.ball:135)+b.angle,a=ball*Math.PI/180,v=b.velocity*Math.PI/180;
  return {wheel:base.wheel+w.angle,wheelVelocity:w.velocity,ball,ballVelocity:b.velocity,radius,hop:0,height:0,
    x:radius*Math.sin(a),y:-radius*Math.cos(a),ux:v*radius*Math.cos(a),uy:v*radius*Math.sin(a),surface:'rim',visible:true,
    phase:elapsedMs<SPIN_TIMING.launch?'launch':'orbit'};
}

/** Simulates the rest of the spin so that the ball physically settles in the confirmed pocket. */
export function landingPlan(start:SpinPose,pocket:number,seed=0x5f3759df):LandingPlan {
  if(!Number.isInteger(pocket)||pocket<0||pocket>=37)throw Error('Invalid roulette pocket');
  if(!(start.wheelVelocity>=60)||![start.wheel,start.ball,start.radius,start.ballVelocity].every(Number.isFinite))throw Error('Invalid roulette presentation pose');
  const simulation=simulateLanding(start,pocket,seed);
  return {start,pocket,duration:simulation.duration*1000,simulation,contacts:simulation.contacts};
}

export function landingPose(plan:LandingPlan,elapsedMs:number):SpinPose {
  const sim=plan.simulation,t=Math.max(0,Math.min(sim.duration,elapsedMs/1000)),done=elapsedMs>=plan.duration;
  const rotor=displayRotor(sim.rotor,t),ball=ballAt(sim,t);
  const h=.002,a=ballAt(sim,Math.max(0,t-h)),b=ballAt(sim,Math.min(sim.duration,t+h)),span=Math.min(sim.duration,t+h)-Math.max(0,t-h);
  const turn=Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y);
  const phase:SpinPhase=done?'idle':t>=sim.lock?'pocket':ball.surface==='rim'?'coast':'drop';
  return {wheel:degrees(rotor.theta),wheelVelocity:done?0:degrees(rotor.omega),ball:degrees(angleOf(ball.x,ball.y)),
    ballVelocity:done||span<=0?0:degrees(turn/span),radius:Math.hypot(ball.x,ball.y),hop:clamp(ball.z/6),height:ball.z,
    x:ball.x,y:ball.y,ux:ball.ux,uy:ball.uy,surface:ball.surface,visible:true,phase};
}
