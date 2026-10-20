import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catBodyMotion,catSideCel,CAT_SIDE_CELS,CAT_CONTACTS,CAT_SIDE_SCALE,CAT_SIDE_STRIDE,CAT_SIDE_STANCE,catPaw,catSidePose} from '../src/game/CatSideGait';
import {CatWalkCycle} from '../src/game/CatWalkCycle';
const close=(a:number,b:number,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('all four paws swing, lift and return, including both hind paws',()=>{
  for(const name of Object.keys(CAT_CONTACTS) as (keyof typeof CAT_CONTACTS)[]) {
    const poses=Array.from({length:200},(_,i)=>catPaw(i/200,name));
    assert.ok(Math.max(...poses.map(p=>p.x))-Math.min(...poses.map(p=>p.x))>65,name);
    assert.ok(Math.max(...poses.map(p=>p.lift))>(name.endsWith('hind')?8.9:12.9),name);
    assert.ok(poses.some(p=>p.planted)&&poses.some(p=>!p.planted),name);
  }
});

test('four distinct contacts follow a lateral walk instead of simultaneous hind legs',()=>{
  assert.deepEqual(Object.entries(CAT_CONTACTS).sort((a,b)=>a[1]-b[1]).map(p=>p[0]),['near-hind','near-front','far-hind','far-front']);
  for(const [name,phase] of Object.entries(CAT_CONTACTS))assert.equal(catPaw(phase,name as keyof typeof CAT_CONTACTS).planted,true);
  for(let i=0;i<100;i++) {
    const supports=catSidePose(i/100).filter(p=>p.planted);
    assert.ok(supports.length>=2&&supports.length<=3);
  }
});

test('a planted paw stays fixed against the floor while the body advances',()=>{
  for(const name of Object.keys(CAT_CONTACTS) as (keyof typeof CAT_CONTACTS)[]) {
    const contact=CAT_CONTACTS[name];
    const footAt=(t:number)=>(contact+t)*CAT_SIDE_STRIDE+catPaw(contact+t,name).x*CAT_SIDE_SCALE;
    for(let i=0;i<60;i++)close(footAt(i/100),footAt(0));
  }
});

test('limb joints preserve bone lengths and never stretch or disappear at any phase',()=>{
  for(const side of ['left','right'] as const)for(let i=0;i<500;i++)for(const leg of catSidePose(i/500,side)) {
    for(const point of [leg.root,leg.knee,leg.hock,leg.ankle,leg.foot])assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
    close(Math.hypot(leg.knee.x-leg.root.x,leg.knee.y-leg.root.y),leg.hind?29:30);
    close(Math.hypot(leg.knee.x-leg.hock.x,leg.knee.y-leg.hock.y),leg.hind?34:33);
    if(leg.planted)close(leg.foot.y,side==='right'?166:160);
  }
});

test('loop and contact transitions are continuous in position and velocity',()=>{
  const e=1e-6;
  for(const [name,contact] of Object.entries(CAT_CONTACTS))for(const boundary of [contact,contact+CAT_SIDE_STANCE]) {
    const at=(phase:number)=>catPaw(phase,name as keyof typeof CAT_CONTACTS);
    const a=at(boundary-2*e),b=at(boundary-e),c=at(boundary+e),d=at(boundary+2*e);
    assert.ok(Math.abs(b.x-c.x)<.001&&Math.abs(b.lift-c.lift)<.001);
    assert.ok(Math.abs((b.x-a.x)-(d.x-c.x))<1e-7);
  }
});

test('side gait follows actual distance and holds its pose when paused',()=>{
  for(const hz of [20,60,144]) {
    const walk=new CatWalkCycle(CAT_SIDE_STRIDE);walk.update({x:0,y:0},true);
    for(let i=1;i<=hz;i++)walk.update({x:CAT_SIDE_STRIDE*.37*i/hz,y:0},true);
    close(walk.progress,.37);
    const before=walk.progress;
    for(let i=0;i<120;i++)walk.update({x:CAT_SIDE_STRIDE*.37,y:0},true);
    assert.equal(walk.progress,before);
  }
});

test('twelve complete cels have a single loop seam and no repeated endpoint',()=>{
  for(let i=0;i<CAT_SIDE_CELS;i++)assert.equal(catSideCel(i/CAT_SIDE_CELS),i);
  assert.equal(catSideCel(1),0);assert.equal(catSideCel(-1),0);
  assert.equal(catSideCel(1-1e-6),11);
});

test('weight passes between pelvis and shoulders while the head remains steadier',()=>{
  const values=Array.from({length:120},(_,i)=>catBodyMotion(i/120));
  for(const key of ['hip','shoulder','tail'] as const)assert.ok(Math.max(...values.map(v=>v[key]))-Math.min(...values.map(v=>v[key]))>2);
  assert.ok(Math.max(...values.map(v=>Math.abs(v.head)))<=1);
  assert.ok(values.every(v=>v.hip*v.shoulder<=1e-10));
});

test('forepaw peels off at the toe and rolls more than the hind paw',()=>{
  const front=catPaw(CAT_CONTACTS['near-front']+CAT_SIDE_STANCE-1e-4,'near-front');
  const hind=catPaw(CAT_CONTACTS['near-hind']+CAT_SIDE_STANCE-1e-4,'near-hind');
  assert.ok(front.roll>.4&&hind.roll<.11);
  assert.ok(front.planted&&hind.planted);
  for(const leg of catSidePose(CAT_CONTACTS['near-front']+CAT_SIDE_STANCE-.001)) {
    if(leg.name==='near-front')assert.ok(leg.ankle.y<leg.foot.y-14);
  }
});
