import test from 'node:test';import assert from 'node:assert/strict';
import {stuntFrame,pickStunt,explosionAt,crashMotion,rolloverImpacts,patrolContact,helicopterMotion,type StuntVariant} from '../src/ui/lastExitStunts';
test('unconfirmed running and countdown never trigger any result stunt',()=>{
 for(const phase of ['idle','waiting','racing'] as const)for(const age of [0,.5,2,10,100000]){const f=stuntFrame(phase,age);assert.equal(f.helicopter,false);assert.equal(f.plane,false);assert.equal(f.explosion,false);assert.equal(f.debris,false);assert.equal(f.carRoll,0);assert.equal(f.lift,0);assert.equal(pickStunt('a',phase),'drive');}
});
test('loss IDs select sides and confirmed multipliers select win cinematics',()=>{
 const losses=new Set<string>(),wins=new Set<string>();for(let i=0;i<100;i++){const id='round-'+i;losses.add(pickStunt(id,'crashed'));for(const value of [1.01,2,2.01,100])wins.add(pickStunt(id,'escaped',value));assert.equal(pickStunt(id,'escaped'),pickStunt(id,'escaped'));}assert.deepEqual([...losses].sort(),['pit-left','pit-right']);assert.deepEqual([...wins].sort(),['cargo-plane','helicopter']);
});
test('side rollover makes several full turns before the delayed explosion',()=>{
 for(const v of ['pit-left','pit-right'] as StuntVariant[]){assert.equal(stuntFrame('crashed',.2,false,v).label,'intercept');const rolling=stuntFrame('crashed',2.8,false,v);assert(rolling.hit>.99&&rolling.rollTurns>2);assert.equal(rolling.carRoll,0);assert(rolling.debris&&!rolling.explosion);const landed=stuntFrame('crashed',explosionAt+.1,false,v);assert(landed.explosion&&landed.debris);assert.equal(landed.rollTurns,3.5);assert.equal(landed.carRoll,0);}
});
test('helicopter attaches cables before lifting; aircraft jump enters hold before departure',()=>{
 const rope=stuntFrame('escaped',1.8,false,'helicopter');assert(rope.cables>0&&rope.cables<1);assert.equal(rope.lift,0);const lift=stuntFrame('escaped',4.5,false,'helicopter');assert.equal(lift.cables,1);assert(lift.carY>.5&&lift.helicopter);assert.equal(lift.plane,false);
 const ramp=stuntFrame('escaped',3.1,false,'cargo-plane');assert(ramp.plane&&!ramp.helicopter);assert.equal(ramp.jump,0);assert.equal(ramp.cables,0);const jump=stuntFrame('escaped',4.0,false,'cargo-plane');assert(jump.jump>0&&jump.jump<1);assert.equal(jump.depart,0);assert.equal(stuntFrame('escaped',4.6,false,'cargo-plane').jump,1);assert(stuntFrame('escaped',5.5,false,'cargo-plane').depart>0);
});
test('reduced motion is fixed, and each cosmetic timeline remains finite',()=>{
 for(const phase of ['crashed','escaped'] as const)for(const variant of ['pit-left','pit-right','helicopter','cargo-plane'] as StuntVariant[]){assert.deepEqual(stuntFrame(phase,0,true,variant),stuntFrame(phase,100,true,variant));for(let i=0;i<=1000;i++){const f=stuntFrame(phase,i/100,false,variant);for(const v of Object.values(f))if(typeof v==='number')assert(Number.isFinite(v));assert(f.cables>=0&&f.cables<=1&&f.lift>=0&&f.lift<=1&&f.travel>=0&&f.travel<=1);}}
});

test('depth roll recedes without ever rotating the car within the screen plane',()=>{
 const start=crashMotion(.72),end=crashMotion(explosionAt);assert(end.ground<start.ground);assert(end.scale<start.scale);assert.equal(end.hop,0);assert.equal(end.turns,3.5);
 let previousDepth=-1;for(let i=0;i<=400;i++){const m=crashMotion(i/100);assert.equal(m.screenAngle,0);assert(m.depth>=previousDepth);previousDepth=m.depth;assert(m.frame>=0&&m.frame<8);assert(m.hop>=0);assert(m.scale>=.4&&m.scale<=1);}
});
test('all seven roof or wheel impacts meet the road and the final one precedes fire',()=>{
 assert.equal(rolloverImpacts.length,7);for(let i=0;i<7;i++){const at=rolloverImpacts[i],m=crashMotion(at);assert(Math.abs(m.turns-(i+1)/2)<1e-8);assert.equal(m.hop,0);if(i>0)assert(at>rolloverImpacts[i-1]);assert(at<=explosionAt+1e-10);}
});

test('each loss has one side attacker and no above-car patrol rotation',()=>{
 for(let id=0;id<100;id++){const variant=pickStunt('loss-'+id,'crashed'),attacker=variant==='pit-left'?-1:1;
  for(const t of [0,.2,.4,.68,.76,1.2,4]){const cops=[-1,1].map(side=>patrolContact(t,side,attacker));assert.equal(cops.filter(c=>c.attacking).length,1);for(const c of cops)assert.equal(c.screenAngle,0);}
 }
 assert.equal(patrolContact(.4,-1,-1).contact,1);assert.equal(patrolContact(.4,-1,-1).push,0);assert.equal(patrolContact(.68,-1,-1).push,1);assert.equal(stuntFrame('crashed',.4).hit,0);
});

test('confirmed paid threshold is helicopter through 2.00x and aircraft from 2.01x',()=>{
 for(let i=0;i<100;i++)for(const [value,expected]of [[1,'helicopter'],[1.99,'helicopter'],[2,'helicopter'],[2+Number.EPSILON,'helicopter'],[2.01,'cargo-plane'],[3,'cargo-plane'],[100,'cargo-plane']] as const)assert.equal(pickStunt('winner-'+i,'escaped',value),expected);
});
test('suspended car stays below the helicopter and cables point downward across viewports',()=>{
 for(const [w,h]of [[320,310],[390,345],[683,314],[1021,475],[1280,480],[1400,580]])for(let t=1.25;t<7.1;t+=.04){const m=helicopterMotion(t,w,h);assert(m.clearance>h*.025);for(const rope of m.ropes)assert(rope.by>rope.ay);}
});
test('suspension spacing is fixed during lift, then the complete payload leaves the frame',()=>{
 for(const [w,h]of [[320,310],[390,345],[683,314],[1021,475],[1280,480],[1400,580]]){
  const attached=helicopterMotion(2.25,w,h),lifted=helicopterMotion(4.1,w,h);assert(Math.abs((attached.carY-attached.heliY)-(lifted.carY-lifted.heliY))<1e-8);assert(lifted.carY<attached.carY);assert(helicopterMotion(7,w,h).offscreen);assert(helicopterMotion(9,w,h).offscreen);assert.equal(stuntFrame('escaped',7,false,'helicopter').label,'extracted');assert.deepEqual(helicopterMotion(0,w,h,true),helicopterMotion(100,w,h,true));
 }
});

test('consecutive new losses alternate attackers and revisiting a round keeps its side',async()=>{
 const {CrashStuntSequence}=await import('../src/ui/lastExitStunts');const sequence=new CrashStuntSequence();let previous='';
 for(let i=0;i<60;i++){const id='same-hash-parity-'+i,side=sequence.choose(id,'crashed');assert.notEqual(side,previous);assert.equal(sequence.choose(id,'crashed'),side);sequence.choose('win-'+i,'escaped',3);sequence.choose(id,'racing');assert.equal(sequence.choose(id,'crashed'),side);previous=side;}
 const first=sequence.choose('same-hash-parity-0','crashed');assert.equal(first,pickStunt('same-hash-parity-0','crashed'));
});
test('inward patrol nose reaches the side exactly at impact then pushes through the panel on the road',async()=>{
 const {ramGeometry}=await import('../src/ui/lastExitStunts');
 for(const [w,h]of [[320,310],[683,314],[1280,480]])for(const side of [-1,1]){
  const heroX=w*.5,width=w*.32,initialX=w*(.5+side*.30),foot=h*.90;
  for(const t of [0,.1,.2,.3,.39]){const m=ramGeometry(t,w,h,side,heroX,width,initialX,foot);assert(m.overlap<0);assert.equal(m.screenAngle,0);}
  const hit=ramGeometry(.4,w,h,side,heroX,width,initialX,foot);assert(Math.abs(hit.overlap)<1e-8);assert.equal(hit.pose,2);assert.equal(hit.foot,h*.965);
  const shove=ramGeometry(.68,w,h,side,heroX-side*w*.12,width*1.25,initialX,foot);assert(Math.abs(shove.overlap-width*1.25*.10)<1e-8);assert.equal(shove.foot,hit.foot);assert.equal(shove.screenAngle,0);
  assert(side===-1?shove.x>hit.x:shove.x<hit.x);
 }
});

test('patrol ram uses only the first three upright poses',async()=>{
 const {ramGeometry}=await import('../src/ui/lastExitStunts');const poses=new Set<number>();
 for(let t=0;t<2;t+=.01){const m=ramGeometry(t,683,314,-1,340,220,130,280);poses.add(m.pose);assert(m.pose>=0&&m.pose<=2);}assert.deepEqual([...poses].sort(),[0,1,2]);
});
test('ramp approaches before the aircraft, takeoff is continuous from the ramp lip',async()=>{
 const {cargoMotion,cargoTiming:k}=await import('../src/ui/lastExitStunts');
 for(const [w,h]of [[320,310],[390,345],[683,314],[1021,475],[1280,480],[1400,580]]){
  const distant=cargoMotion(.7,w,h),near=cargoMotion(k.rampNear,w,h),launch=cargoMotion(k.takeoff,w,h);
  assert(!distant.planeVisible);assert(distant.ramp.nearY<distant.carY-distant.carW/3);assert(distant.ramp.nearY<h*.65);assert(distant.ramp.nearHalf<near.ramp.nearHalf*.10);assert(near.ramp.nearY>h);assert(near.planeVisible);assert.equal(near.arrival,1);
  assert(Math.abs(launch.carY+launch.carW*.29-launch.ramp.lipY)<1e-8);
  const before=cargoMotion(k.takeoff-1e-7,w,h),after=cargoMotion(k.takeoff+1e-7,w,h);assert(Math.abs(before.carY-after.carY)<.001);assert(Math.abs(before.carW-after.carW)<.001);
 }
});
test('car fits the cargo doorway, stays in the hold, then complete aircraft exits',async()=>{
 const {cargoMotion,cargoTiming:k}=await import('../src/ui/lastExitStunts');
 for(const [w,h]of [[320,310],[390,345],[683,314],[1021,475],[1280,480],[1400,580]]){
  const landing=cargoMotion(k.landing,w,h);assert(landing.carX-landing.carW/2>landing.portalLeft);assert(landing.carX+landing.carW/2<landing.portalRight);assert(!landing.carHidden);assert.equal(landing.depart,0);
  const inside=cargoMotion(k.inside,w,h);assert(inside.inHold);assert(!inside.carHidden);assert(inside.carY-inside.carW/3>inside.portalTop);assert(inside.carW<landing.carW);assert.equal(inside.depart,0);const flying=cargoMotion(6.5,w,h);assert.equal(flying.carX,flying.planeX);assert(Math.abs((flying.carY-flying.planeY)/flying.planeW-.11)<1e-8);assert(cargoMotion(k.exit,w,h).offscreen);
  assert.deepEqual(cargoMotion(0,w,h,true),cargoMotion(100,w,h,true));
 }
});
