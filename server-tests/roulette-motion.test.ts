import test from 'node:test';
import assert from 'node:assert/strict';
import {landingPlan,landingPose,launchPose,normalizeAngle,SPIN_TIMING,type SpinPose} from '../games/royal-roulette/SpinTimeline';
const base:SpinPose={wheel:0,wheelVelocity:0,ball:0,ballVelocity:0,radius:148,hop:0,phase:'idle'};
const angleError=(n:number)=>Math.min(normalizeAngle(n),360-normalizeAngle(n));
test('launch accelerates in opposite directions without an angle or speed jump',()=>{
 const a=launchPose(base,450-.001),b=launchPose(base,450+.001);
 assert(Math.abs(a.wheel-b.wheel)<.001);assert(Math.abs(a.ball-b.ball)<.003);
 assert(Math.abs(a.wheelVelocity-b.wheelVelocity)<.001);assert(Math.abs(a.ballVelocity-b.ballVelocity)<.001);
 for(const t of [1,100,450,650,15000]){const p=launchPose(base,t);assert(p.wheelVelocity>0&&p.ballVelocity<0);assert(p.radius>=148&&p.radius<=187);}
});
test('every pocket lands exactly with monotonic wheel deceleration from different rotations',()=>{
 for(const rotation of [0,121.4,1440,12425.7])for(let pocket=0;pocket<37;pocket++){
  const start=launchPose({...base,wheel:rotation,ball:-rotation*2},SPIN_TIMING.launch),plan=landingPlan(start,pocket);
  let previous=start;
  for(let ms=0;ms<=SPIN_TIMING.landing;ms+=8){
   const p=landingPose(plan,ms);
   assert(Object.values(p).filter(v=>typeof v==='number').every(Number.isFinite));
   assert(p.wheel>=previous.wheel-1e-8);assert(p.wheelVelocity>=-1e-8);assert(p.wheelVelocity<=previous.wheelVelocity+1e-7);
   assert(p.radius>=148-1e-8&&p.radius<193);previous=p;
  }
  const end=landingPose(plan,SPIN_TIMING.landing);
  assert(angleError(end.wheel+pocket*360/37)<1e-8);assert(angleError(end.ball)<1e-8);
  assert.equal(end.radius,148);assert.equal(end.hop,0);assert.equal(end.wheelVelocity,0);assert.equal(end.ballVelocity,0);
 }
});
test('ball joins the actual pocket continuously and its final hops stay inside it',()=>{
 for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose(base,650),pocket),join=SPIN_TIMING.landing*SPIN_TIMING.join;
  const before=landingPose(plan,join-.001),after=landingPose(plan,join+.001);
  assert(Math.abs(before.ball-after.ball)<.001);assert(Math.abs(before.ballVelocity-after.ballVelocity)<.01);assert(Math.abs(before.radius-after.radius)<.001);
  for(let t=join;t<SPIN_TIMING.landing;t+=3){const p=landingPose(plan,t);assert(angleError(p.ball-p.wheel-pocket*360/37)<=2.2+1e-8);assert(p.radius>=148&&p.radius<=153);}
 }
});
test('infinite poses, stationary landings and invalid pockets are rejected',()=>{
 const p=launchPose(base,650);
 for(const pocket of [-1,37,1.5,NaN])assert.throws(()=>landingPlan(p,pocket));
 for(const value of [0,NaN,Infinity])assert.throws(()=>landingPlan({...p,wheelVelocity:value},0));
});
