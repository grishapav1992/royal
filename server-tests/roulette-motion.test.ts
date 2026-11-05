import test from 'node:test';
import assert from 'node:assert/strict';
import {BALL_RADIUS,POCKET_DIVIDER,landingPlan,landingPose,launchPose,normalizeAngle,SPIN_CONTACTS,SPIN_TIMING,type SpinPose} from '../games/royal-roulette/SpinTimeline';
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
test('visible impacts touch a divider and then rebound inside the confirmed pocket',()=>{
 const relative=(p:SpinPose)=>p.ballVelocity-p.wheelVelocity;
 const first=SPIN_CONTACTS[0]*SPIN_TIMING.landing,join=SPIN_TIMING.join*SPIN_TIMING.landing,step=360/37;
 for(const wait of [650,843,5000,30000])for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose({...base,wheel:90,ball:17},wait),pocket);
  for(const ms of [first,join]){
   const before=landingPose(plan,ms-.001),after=landingPose(plan,ms+.001);
   assert(Math.abs(before.ball-after.ball)<.001);
   assert(Math.abs(before.radius-after.radius)<.001);
   assert(Math.abs(relative(after))<Math.abs(relative(before)));
  }
  const divider=landingPose(plan,first),dividerAngle=divider.ball-divider.wheel;
  assert(Math.abs(divider.radius-(POCKET_DIVIDER.tipRadius+POCKET_DIVIDER.capRadius+BALL_RADIUS))<1e-8);
  assert(Math.abs(dividerAngle/step-.5-Math.round(dividerAngle/step-.5))<1e-8);
  assert(relative(landingPose(plan,first+.001))<0);
  const wallGap=(pose:SpinPose)=>{
   const offset=angleError(pose.ball-pose.wheel-pocket*step);
   return pose.radius*Math.sin((step/2-offset)*Math.PI/180)-BALL_RADIUS-POCKET_DIVIDER.width/2;
  };
  assert(Math.abs(wallGap(landingPose(plan,join)))<1e-8);
  assert(relative(landingPose(plan,join-.001))<0&&relative(landingPose(plan,join+.001))>0);
  for(let t=join;t<SPIN_TIMING.landing;t+=3){const p=landingPose(plan,t);assert(wallGap(p)>=-1e-8);assert(p.radius>=148&&p.radius<=153);}
 }
});
test('infinite poses, stationary landings and invalid pockets are rejected',()=>{
 const p=launchPose(base,650);
 for(const pocket of [-1,37,1.5,NaN])assert.throws(()=>landingPlan(p,pocket));
 for(const value of [0,NaN,Infinity])assert.throws(()=>landingPlan({...p,wheelVelocity:value},0));
});

test('rolling drag loses speed before the ball leaves the rim, including delayed replies',()=>{
 for(const wait of [650,5000,30000])for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose(base,wait),pocket);let previous=plan.start.ballVelocity;
  for(let ms=0;ms<SPIN_TIMING.drop*SPIN_TIMING.landing;ms+=12){
   const p=landingPose(plan,ms);assert.equal(p.phase,'coast');assert.equal(p.radius,187);
   assert(p.ballVelocity<0);assert(p.ballVelocity>=previous-1e-8);previous=p.ballVelocity;
  }
  const at=SPIN_TIMING.drop*SPIN_TIMING.landing,a=landingPose(plan,at-.001),b=landingPose(plan,at+.001);
  assert(Math.abs(a.ball-b.ball)<.001);assert(Math.abs(a.ballVelocity-b.ballVelocity)<.01);
  assert(Math.abs(a.radius-b.radius)<.001);
 }
});

test('the ball slows counterclockwise until the first hit, including after a previous spin',()=>{
 const drop=SPIN_TIMING.drop*SPIN_TIMING.landing,first=SPIN_CONTACTS[0]*SPIN_TIMING.landing;
 for(const wait of [650,1285,5000,30000])for(let previousPocket=0;previousPocket<37;previousPocket++){
  const start=launchPose({...base,wheel:normalizeAngle(-previousPocket*360/37)},wait);
  for(let pocket=0;pocket<37;pocket++){
   const plan=landingPlan(start,pocket);
   let previousVelocity=start.ballVelocity;
   for(let t=drop;t<first;t+=15){
    const pose=landingPose(plan,t);
    assert(pose.ballVelocity<0&&pose.ballVelocity>=previousVelocity-1e-8,`wait ${wait}, pockets ${previousPocket} to ${pocket}, time ${t}`);
    previousVelocity=pose.ballVelocity;
   }
  }
 }
});

test('reported angular velocities match the visible ball through deflections and pocket capture',()=>{
 for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose(base,650),pocket);
  for(let ms=2;ms<SPIN_TIMING.landing-2;ms+=13){
   const a=landingPose(plan,ms-.001),b=landingPose(plan,ms+.001),p=landingPose(plan,ms);
   assert(Math.abs((b.ball-a.ball)/.000002-p.ballVelocity)<.02);
   assert(Math.abs((b.wheel-a.wheel)/.000002-p.wheelVelocity)<.02);
  }
 }
});
