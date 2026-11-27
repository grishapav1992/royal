import test from 'node:test';
import assert from 'node:assert/strict';
import {BALL_RADIUS,PHYSICS,STEP,WHEEL,displayRotor,presentationRandom} from '../games/royal-roulette/BallPhysics';
import {landingPlan,landingPose,launchPose,normalizeAngle,restingPose,SPIN_TIMING,LAUNCH_SPEED,type SpinPose} from '../games/royal-roulette/SpinTimeline';
const pocketOf=(p:SpinPose)=>Math.round(normalizeAngle(p.ball-p.wheel)/(360/37))%37;
const angleError=(n:number)=>Math.min(normalizeAngle(n),360-normalizeAngle(n));
const idle=restingPose(),previous=restingPose(21);

test('launch accelerates in opposite directions without an angle or speed jump',()=>{
 for(const base of [idle,previous]){
  const a=launchPose(base,SPIN_TIMING.ramp-.001),b=launchPose(base,SPIN_TIMING.ramp+.001);
  assert(Math.abs(a.wheel-b.wheel)<.001);assert(Math.abs(a.ball-b.ball)<.003);
  assert(Math.abs(a.wheelVelocity-b.wheelVelocity)<.001);assert(Math.abs(a.ballVelocity-b.ballVelocity)<.001);
  for(const t of [1,100,450,650,15000]){const p=launchPose(base,t);assert(p.wheelVelocity>0&&p.ballVelocity<0);assert(p.radius>=WHEEL.rest-1e-9&&p.radius<=WHEEL.track+1e-9);assert(p.visible);}
  assert.equal(launchPose(base,650).radius,WHEEL.track);assert.equal(launchPose(base,650).wheelVelocity,LAUNCH_SPEED.wheel);
 }
});

test('the simulated ball rests in every confirmed pocket from different rotations, waits and seeds',()=>{
 let plans=0;const started=performance.now();
 for(const base of [idle,previous,{...previous,wheel:1440.7,ball:-912.3}])for(const wait of [650,1730,30000])for(let pocket=0;pocket<37;pocket++){
  const seed=(pocket*2654435761+wait)>>>0,plan=landingPlan(launchPose(base,wait),pocket,seed);plans++;
  const end=landingPose(plan,plan.duration);
  assert.equal(pocketOf(end),pocket,`pocket ${pocket} wait ${wait}`);
  assert(angleError(end.ball-end.wheel-pocket*360/37)<1e-6);
  assert(Math.abs(end.radius-WHEEL.rest)<1e-9);assert.equal(end.height,0);assert.equal(end.phase,'idle');
  assert.equal(end.wheelVelocity,0);assert.equal(end.ballVelocity,0);
  assert(plan.duration>=3000&&plan.duration<=SPIN_TIMING.maxLanding,`duration ${plan.duration}`);
 }
 assert((performance.now()-started)/plans<60,'planning a landing stays fast enough for one frame budget on desktops');
});

test('rotor speed is continuous and only decreases while the ball travels and settles',()=>{
 for(let pocket=0;pocket<37;pocket+=3){
  const start=launchPose(previous,650),plan=landingPlan(start,pocket,9000+pocket),first=landingPose(plan,0);
  assert(Math.abs(first.wheel-start.wheel)<1e-9);assert(Math.abs(first.wheelVelocity-start.wheelVelocity)<1e-6);
  assert(Math.abs(first.x-start.x)<1e-6&&Math.abs(first.y-start.y)<1e-6);
  let last=first;
  for(let ms=2;ms<plan.duration;ms+=2){
   const p=landingPose(plan,ms);
   assert(p.wheelVelocity<=last.wheelVelocity+1e-6,`rotor speeds up at ${ms} ms for pocket ${pocket}`);
   assert(p.wheelVelocity>=-1e-9);assert(p.wheel>=last.wheel-1e-9);
   assert(Math.abs(p.wheel-last.wheel)<1.4,'rotor angle is continuous');
   assert(Math.hypot(p.x-last.x,p.y-last.y)<9,`ball position jumps at ${ms} ms`);
   last=p;
  }
 }
});

test('the ball stays inside the bowl, above the surface and outside the frets',()=>{
 const reach=BALL_RADIUS+WHEEL.fretHalf;
 for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose(idle,800),pocket,77+pocket*13),sim=plan.simulation;
  let maxHeight=0,inPockets=0;
  for(let ms=0;ms<plan.duration;ms+=3){
   const p=landingPose(plan,ms),t=ms/1000;
   assert(p.radius<=WHEEL.track+1e-6,'outside the ball track');assert(p.radius>=WHEEL.pocketInner+BALL_RADIUS-.05,'inside the centre cone');
   assert(p.height>=0&&p.height<14);maxHeight=Math.max(maxHeight,p.height);
   if(t<sim.te||t>=sim.lock||p.height>=WHEEL.fretHeight||p.radius>WHEEL.pocketOuter+BALL_RADIUS)continue;
   inPockets++;
   const theta=displayRotor(sim.rotor,t).theta;
   for(let i=0;i<37;i++){
    const a=theta+(i+.5)*STEP,ex=Math.sin(a),ey=-Math.cos(a),along=Math.max(WHEEL.pocketInner,Math.min(WHEEL.pocketOuter,p.x*ex+p.y*ey));
    assert(Math.hypot(p.x-ex*along,p.y-ey*along)>=reach-.9,`fret penetration for pocket ${pocket} at ${ms} ms`);
   }
  }
  assert(inPockets>0,'the ball travels among the pockets before it settles');
  assert(maxHeight>.2,'impacts lift the ball');
 }
});

test('contacts are ordered, physical and end with the rest in the confirmed pocket',()=>{
 for(let pocket=0;pocket<37;pocket++){
  const plan=landingPlan(launchPose(previous,650),pocket,4242+pocket),c=plan.contacts;
  assert(c.length>=2);assert.equal(c.at(-1)!.kind,'rest');assert(Math.abs(c.at(-1)!.t-plan.simulation.settled)<1e-9);
  for(let i=1;i<c.length;i++)assert(c[i].t>=c[i-1].t);
  assert(c.every(x=>x.t>0&&x.t*1000<=plan.duration&&Number.isFinite(x.strength)&&x.strength>0));
  assert(c.some(x=>x.kind==='fret'||x.kind==='diamond'),'the ball strikes a fret or diamond');
  const settled=landingPose(plan,plan.simulation.settled*1000+1);assert.equal(settled.phase,'pocket');
 }
});

test('presentation physics is deterministic and independent from game randomness',()=>{
 const start=launchPose(previous,900),a=landingPlan(start,17,123456),b=landingPlan(start,17,123456);
 assert.deepEqual(Array.from(a.simulation.samples),Array.from(b.simulation.samples));assert.deepEqual(a.contacts,b.contacts);
 const c=landingPlan(start,17,654321);assert.notDeepEqual(Array.from(a.simulation.samples),Array.from(c.simulation.samples));
 const r=presentationRandom(1),s=presentationRandom(1);for(let i=0;i<20;i++){const v=r();assert.equal(v,s());assert(v>=0&&v<1);}
 assert.equal(PHYSICS.brake>0&&PHYSICS.glide<PHYSICS.brake,true);
});

test('invalid poses and pockets are rejected',()=>{
 const p=launchPose(idle,650);
 for(const pocket of [-1,37,1.5,NaN])assert.throws(()=>landingPlan(p,pocket));
 for(const value of [0,NaN,Infinity])assert.throws(()=>landingPlan({...p,wheelVelocity:value},0));
 assert.throws(()=>landingPlan({...p,ball:NaN},0));
});

test('the resting pose shows the confirmed pocket towards the viewer',()=>{
 for(let pocket=0;pocket<37;pocket++){
  const r=restingPose(pocket);assert.equal(pocketOf(r),pocket);assert(angleError(r.wheel+pocket*360/37-180)<1e-9);assert(r.visible);
 }
 assert.equal(restingPose().visible,false);
});
